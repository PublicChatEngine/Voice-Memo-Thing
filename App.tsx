
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TranscriptionSnippet, AppState, RecordingSession } from './types';
import { createLiveSession, formatTranscription, transcribeAudioFile } from './services/geminiService';
import { createBlob } from './utils/audio';
import TranscriptionCard from './components/TranscriptionCard';
import AudioVisualizer from './components/AudioVisualizer';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    isRecording: false,
    sessions: [],
    activeSessionId: null,
    error: null,
  });

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSession = state.sessions.find(s => s.id === state.activeSessionId);

  const updateSession = (id: string, updates: Partial<RecordingSession>) => {
    setState(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === id ? { ...s, ...updates } : s)
    }));
  };

  const startRecording = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(audioStream);

      const id = `live-${Date.now()}`;
      const session: RecordingSession = {
        id,
        name: `Voice Note ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        snippets: [],
        formattedText: null,
        status: 'transcribing',
        timestamp: Date.now(),
      };

      setState(prev => ({
        ...prev,
        isRecording: true,
        sessions: [session, ...prev.sessions],
        activeSessionId: id
      }));

      const sessionPromise = createLiveSession(
        (text, isFinal) => {
          setState(prev => {
            const sessions = [...prev.sessions];
            const idx = sessions.findIndex(s => s.id === id);
            if (idx === -1) return prev;
            
            const last = sessions[idx].snippets[sessions[idx].snippets.length - 1];
            if (last && !last.isFinal) {
              sessions[idx].snippets[sessions[idx].snippets.length - 1].text += " " + text;
              sessions[idx].snippets[sessions[idx].snippets.length - 1].isFinal = isFinal;
            } else {
              sessions[idx].snippets.push({ id: Math.random().toString(), text, timestamp: Date.now(), isFinal });
            }
            return { ...prev, sessions };
          });
        },
        () => setState(prev => ({ ...prev, error: "Recording failed." }))
      );

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(audioStream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        const blob = createBlob(e.inputBuffer.getChannelData(0));
        sessionPromise.then(s => s.sendRealtimeInput({ media: blob }));
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
    } catch (e) {
      setState(prev => ({ ...prev, error: "Microphone access denied." }));
    }
  };

  const stopRecording = () => {
    audioContextRef.current?.close();
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    if (state.activeSessionId) {
      updateSession(state.activeSessionId, { status: 'idle' });
      handleSmartFormat(state.activeSessionId);
    }
    setState(prev => ({ ...prev, isRecording: false }));
  };

  const processFiles = async (files: FileList) => {
    const sessions: RecordingSession[] = Array.from(files).map(f => ({
      id: `file-${Math.random().toString(36).substr(2, 9)}`,
      name: f.name,
      snippets: [],
      formattedText: null,
      status: 'transcribing',
      timestamp: Date.now(),
    }));

    setState(prev => ({ ...prev, sessions: [...sessions, ...prev.sessions], activeSessionId: sessions[0].id }));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const session = sessions[i];
      try {
        const base64 = await new Promise<string>(r => {
          const rd = new FileReader();
          rd.onload = () => r((rd.result as string).split(',')[1]);
          rd.readAsDataURL(file);
        });

        const raw = await transcribeAudioFile(base64, file.type);
        const formatted = await formatTranscription(raw);
        updateSession(session.id, { 
          snippets: [{ id: '1', text: raw, timestamp: Date.now(), isFinal: true }], 
          formattedText: formatted, 
          status: 'completed' 
        });
      } catch {
        updateSession(session.id, { status: 'error' });
      }
    }
  };

  const handleSmartFormat = async (id: string) => {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    updateSession(id, { status: 'formatting' });
    try {
      const text = session.snippets.map(s => s.text).join(" ");
      const formatted = await formatTranscription(text);
      updateSession(id, { formattedText: formatted, status: 'completed' });
    } catch {
      updateSession(id, { status: 'error' });
    }
  };

  const download = (session: RecordingSession) => {
    const content = session.formattedText || session.snippets.map(s => s.text).join("\n");
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name.replace(/\.[^/.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bulkExport = () => {
    const completedSessions = state.sessions.filter(s => s.status === 'completed' || s.snippets.length > 0);
    if (completedSessions.length === 0) return;
    
    completedSessions.forEach((s, index) => {
      // Small delay to ensure browser handles multiple downloads correctly
      setTimeout(() => download(s), index * 300);
    });
  };

  return (
    <div className="flex h-screen bg-[#000000] text-zinc-100 overflow-hidden font-sans">
      {/* Background Decor */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,_#0a0a0a_0%,_#000000_100%)] pointer-events-none" />

      {/* Side Library */}
      <aside className="w-80 border-r border-zinc-900/50 flex flex-col p-8 space-y-10 bg-black/40 backdrop-blur-xl relative z-20">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-white">VocalCanvas</h1>
          <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-600 font-bold">Studio Edition</p>
        </div>

        <div className="space-y-3">
          <button 
            onClick={state.isRecording ? stopRecording : startRecording}
            className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 text-sm font-bold transition-all active:scale-[0.97] shadow-2xl ${
              state.isRecording ? 'bg-red-500 text-white' : 'bg-white text-black hover:bg-zinc-200'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${state.isRecording ? 'bg-white animate-pulse' : 'bg-red-500'}`} />
            {state.isRecording ? 'Stop Recording' : 'Capture Live'}
          </button>

          <div 
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) processFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border border-zinc-900 rounded-2xl p-6 text-center transition-all bg-zinc-900/20 hover:bg-zinc-900/40 ${
              isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'hover:border-zinc-800'
            }`}
          >
            <input type="file" ref={fileInputRef} multiple className="hidden" accept="audio/*" onChange={(e) => e.target.files && processFiles(e.target.files)} />
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Drop Files</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-6 px-1">
            <h3 className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest">Library</h3>
            {state.sessions.length > 0 && (
              <button 
                onClick={bulkExport}
                className="text-[10px] font-bold text-indigo-500 hover:text-indigo-400 uppercase tracking-widest flex items-center gap-1 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                Export All
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            {state.sessions.map(s => (
              <div 
                key={s.id} 
                onClick={() => setState(prev => ({ ...prev, activeSessionId: s.id }))}
                className={`group flex flex-col p-4 rounded-2xl cursor-pointer transition-all border ${
                  state.activeSessionId === s.id 
                    ? 'bg-zinc-900/50 border-zinc-800 shadow-xl' 
                    : 'bg-transparent border-transparent hover:bg-zinc-900/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[13px] font-semibold truncate flex-1 ${state.activeSessionId === s.id ? 'text-white' : 'text-zinc-500'}`}>
                    {s.name}
                  </span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setState(prev => ({ ...prev, sessions: prev.sessions.filter(x => x.id !== s.id) })) }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-800 hover:text-red-500 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className={`w-1 h-1 rounded-full ${
                    s.status === 'completed' ? 'bg-emerald-500' : 
                    s.status === 'error' ? 'bg-red-500' : 'bg-indigo-500 animate-pulse'
                  }`} />
                  <span className="text-[9px] text-zinc-700 font-bold uppercase tracking-wider">{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Stage */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {activeSession ? (
          <div className="h-full flex flex-col px-12 lg:px-24 py-16 overflow-y-auto custom-scrollbar relative z-10">
            <header className="max-w-4xl w-full mx-auto flex flex-col md:flex-row md:items-end justify-between gap-8 mb-20">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                   <div className="px-2 py-0.5 rounded-md bg-zinc-900 text-zinc-600 text-[10px] font-bold uppercase tracking-widest border border-zinc-800">
                    {new Date(activeSession.timestamp).toLocaleDateString()}
                  </div>
                  <div className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border ${
                    activeSession.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/10' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/10'
                  }`}>
                    {activeSession.status}
                  </div>
                </div>
                <h2 className="text-5xl font-bold tracking-tight text-white leading-tight">{activeSession.name}</h2>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => download(activeSession)}
                  className="px-6 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-bold hover:bg-zinc-800 hover:text-white transition-all flex items-center gap-2"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download .txt
                </button>
              </div>
            </header>

            <div className="max-w-4xl w-full mx-auto space-y-16 pb-32">
              {state.isRecording && activeSession.id === state.activeSessionId && (
                <div className="py-12 flex items-center justify-center bg-zinc-900/10 rounded-[2.5rem] border border-zinc-900/50 backdrop-blur-3xl">
                  <AudioVisualizer isRecording={state.isRecording} stream={stream} />
                </div>
              )}

              <div className="space-y-12">
                {activeSession.formattedText ? (
                  <div className="animate-in fade-in duration-700">
                    <div className="text-zinc-200 leading-[1.9] text-[17px] font-light space-y-10 whitespace-pre-wrap">
                      {activeSession.formattedText.split('\n').map((line, i) => {
                        if (!line.trim()) return null;
                        
                        // Detect potential titles/headers from Gemini
                        const isHeader = line.length < 100 && (line.toUpperCase() === line || line.startsWith('Title:') || line.startsWith('**'));
                        
                        return (
                          <div key={i} className={`animate-in slide-in-from-bottom-2 duration-500 ${isHeader ? 'pt-8 first:pt-0' : ''}`}>
                            {line.split(/(\[.*?\])/g).map((part, j) => {
                              if (part.startsWith('[') && part.endsWith(']')) {
                                return <span key={j} className="text-indigo-400 font-bold opacity-70 px-2 py-0.5 rounded bg-indigo-500/5 border border-indigo-500/10 text-sm mx-1">{part}</span>;
                              }
                              return <span key={j} className={isHeader ? 'text-2xl font-bold text-white' : ''}>{part}</span>;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {activeSession.status === 'transcribing' && (
                      <div className="flex items-center gap-4 text-indigo-400 mb-12">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Listening Environment</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-6">
                      {activeSession.snippets.map(s => <TranscriptionCard key={s.id} snippet={s} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-20 space-y-6">
            <div className="w-32 h-32 rounded-full border-2 border-zinc-900 flex items-center justify-center">
              <svg className="w-10 h-10 text-zinc-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.4em] text-zinc-600">Select Recording</p>
          </div>
        )}
      </main>

      {state.error && (
        <div className="fixed bottom-12 right-12 px-6 py-3 bg-red-500 text-white rounded-2xl text-[11px] font-bold shadow-2xl z-[100] flex items-center gap-3 animate-in slide-in-from-right-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          {state.error}
          <button onClick={() => setState(prev => ({ ...prev, error: null }))} className="ml-2 underline opacity-80">Dismiss</button>
        </div>
      )}
    </div>
  );
};

export default App;
