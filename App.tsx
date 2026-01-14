
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
        () => setState(prev => ({ ...prev, error: "Recording interrupted." }))
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
  };

  return (
    <div className="flex h-screen bg-black text-zinc-100 overflow-hidden">
      {/* Library Sidebar */}
      <aside className="w-80 border-r border-zinc-900 flex flex-col p-6 space-y-8 bg-[#020202]">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tighter">VocalCanvas</h1>
          <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Transcription Engine</p>
        </div>

        <div className="space-y-3">
          <button 
            onClick={state.isRecording ? stopRecording : startRecording}
            className={`w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-95 ${
              state.isRecording ? 'bg-red-500 text-white' : 'bg-white text-black hover:bg-zinc-200'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${state.isRecording ? 'bg-white animate-pulse' : 'bg-red-500'}`} />
            {state.isRecording ? 'Stop Recording' : 'New Voice Note'}
          </button>

          <div 
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) processFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border border-dashed rounded-2xl p-6 text-center transition-all ${
              isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <input type="file" ref={fileInputRef} multiple className="hidden" accept="audio/*" onChange={(e) => e.target.files && processFiles(e.target.files)} />
            <p className="text-xs font-semibold text-zinc-500">Drop audio files</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
          <h3 className="text-[10px] font-bold text-zinc-700 mb-4 px-1 uppercase tracking-widest">Library</h3>
          {state.sessions.map(s => (
            <div 
              key={s.id} 
              onClick={() => setState(prev => ({ ...prev, activeSessionId: s.id }))}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${
                state.activeSessionId === s.id ? 'bg-zinc-900' : 'hover:bg-zinc-900/40'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold truncate ${state.activeSessionId === s.id ? 'text-white' : 'text-zinc-500'}`}>{s.name}</p>
                <p className="text-[10px] text-zinc-700 font-medium mt-0.5">{s.status}</p>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); setState(prev => ({ ...prev, sessions: prev.sessions.filter(x => x.id !== s.id) })) }}
                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-700 hover:text-red-400"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_#111111_0%,_#000000_100%)] pointer-events-none" />
        
        {activeSession ? (
          <div className="relative z-10 flex flex-col h-full p-12 lg:p-20 overflow-y-auto custom-scrollbar">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-16">
              <div className="space-y-2">
                <h2 className="text-4xl font-bold tracking-tighter text-white">{activeSession.name}</h2>
                <p className="text-zinc-600 text-sm font-medium uppercase tracking-widest">
                  {new Date(activeSession.timestamp).toLocaleDateString()} &bull; {activeSession.status}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {activeSession.status === 'idle' && (
                  <button 
                    onClick={() => handleSmartFormat(activeSession.id)}
                    className="px-6 py-2.5 rounded-full bg-indigo-600 text-white text-xs font-bold transition-all hover:bg-indigo-500"
                  >
                    Smart Format
                  </button>
                )}
                <button 
                  onClick={() => download(activeSession)}
                  className="px-6 py-2.5 rounded-full border border-zinc-800 text-zinc-400 text-xs font-bold hover:bg-zinc-900 transition-all flex items-center gap-2"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Export TXT
                </button>
              </div>
            </header>

            {state.isRecording && activeSession.id === state.activeSessionId && (
              <div className="mb-12 py-10 flex items-center justify-center bg-zinc-900/20 rounded-[3rem] border border-zinc-800/40">
                <AudioVisualizer isRecording={state.isRecording} stream={stream} />
              </div>
            )}

            <div className="max-w-3xl space-y-10">
              {activeSession.formattedText ? (
                <div className="animate-in fade-in duration-1000">
                  <div className="text-zinc-200 leading-[1.8] text-lg font-light space-y-8 whitespace-pre-wrap">
                    {activeSession.formattedText.split('\n').map((line, i) => (
                      <p key={i}>
                        {line.split(/(\[.*?\])/g).map((part, j) => {
                          if (part.startsWith('[') && part.endsWith(']')) {
                            return <span key={j} className="text-indigo-400 font-bold opacity-70 border-b border-indigo-500/20">{part}</span>;
                          }
                          return part;
                        })}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {activeSession.status === 'transcribing' && (
                    <div className="flex items-center gap-4 text-indigo-400/80 mb-8 animate-pulse">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Listening in real-time</span>
                    </div>
                  )}
                  {activeSession.snippets.map(s => <TranscriptionCard key={s.id} snippet={s} />)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-10">
            <svg className="w-20 h-20 mb-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
            <p className="text-sm font-medium tracking-tighter">Ready to capture.</p>
          </div>
        )}
      </main>

      {state.error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 px-6 py-2 bg-red-500/90 text-white rounded-full text-xs font-bold shadow-2xl z-50">
          {state.error}
        </div>
      )}
    </div>
  );
};

export default App;
