
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
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSession = state.sessions.find(s => s.id === state.activeSessionId);

  const updateSession = (id: string, updates: Partial<RecordingSession>) => {
    setState(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === id ? { ...s, ...updates } : s)
    }));
  };

  const handleLiveTranscription = useCallback((text: string, isFinal: boolean) => {
    setState(prev => {
      if (!prev.activeSessionId) return prev;
      const sessions = [...prev.sessions];
      const sessionIndex = sessions.findIndex(s => s.id === prev.activeSessionId);
      if (sessionIndex === -1) return prev;

      const session = sessions[sessionIndex];
      const lastSnippet = session.snippets[session.snippets.length - 1];

      if (lastSnippet && !lastSnippet.isFinal) {
        session.snippets[session.snippets.length - 1] = {
          ...lastSnippet,
          text: lastSnippet.text + " " + text,
          isFinal: isFinal,
        };
      } else {
        session.snippets.push({
          id: Math.random().toString(36).substr(2, 9),
          text,
          timestamp: Date.now(),
          isFinal,
        });
      }

      return { ...prev, sessions };
    });
  }, []);

  const startRecording = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(audioStream);

      const sessionId = `live-${Date.now()}`;
      const newSession: RecordingSession = {
        id: sessionId,
        name: `Live Note ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        snippets: [],
        formattedText: null,
        status: 'transcribing',
        timestamp: Date.now(),
      };

      setState(prev => ({
        ...prev,
        isRecording: true,
        sessions: [newSession, ...prev.sessions],
        activeSessionId: sessionId,
        error: null
      }));

      const sessionPromise = createLiveSession(
        handleLiveTranscription,
        (err) => setState(prev => ({ ...prev, error: "Connection error." }))
      );
      sessionPromiseRef.current = sessionPromise;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(audioStream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createBlob(inputData);
        sessionPromise.then((session) => {
          if (session) session.sendRealtimeInput({ media: pcmBlob });
        });
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
    } catch (err) {
      setState(prev => ({ ...prev, error: "Microphone access denied." }));
    }
  };

  const stopRecording = () => {
    if (audioContextRef.current) audioContextRef.current.close();
    if (stream) stream.getTracks().forEach(track => track.stop());
    setStream(null);
    if (state.activeSessionId) updateSession(state.activeSessionId, { status: 'idle' });
    setState(prev => ({ ...prev, isRecording: false }));
  };

  const processFiles = async (files: FileList) => {
    const newSessions: RecordingSession[] = Array.from(files).map(file => ({
      id: `file-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      snippets: [],
      formattedText: null,
      status: 'transcribing',
      timestamp: Date.now(),
    }));

    setState(prev => ({
      ...prev,
      sessions: [...newSessions, ...prev.sessions],
      activeSessionId: newSessions[0].id
    }));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const session = newSessions[i];
      
      try {
        const reader = new FileReader();
        const base64Data = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });

        const transcription = await transcribeAudioFile(base64Data, file.type);
        const rawSnippets = transcription.match(/[^\.!\?]+[\.!\?]+/g) || [transcription];
        const processedSnippets: TranscriptionSnippet[] = rawSnippets.map((text, idx) => ({
          id: `${session.id}-${idx}`,
          text: text.trim(),
          timestamp: Date.now(),
          isFinal: true
        }));

        updateSession(session.id, { 
          snippets: processedSnippets, 
          status: 'formatting' 
        });

        const formatted = await formatTranscription(transcription);
        updateSession(session.id, { 
          formattedText: formatted, 
          status: 'completed' 
        });
      } catch (err) {
        updateSession(session.id, { status: 'error' });
      }
    }
  };

  const smartFormat = async (sessionId: string) => {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session || session.snippets.length === 0) return;

    updateSession(sessionId, { status: 'formatting' });
    try {
      const rawText = session.snippets.map(s => s.text).join(" ");
      const formatted = await formatTranscription(rawText);
      updateSession(sessionId, { formattedText: formatted, status: 'completed' });
    } catch (err) {
      updateSession(sessionId, { status: 'error' });
    }
  };

  const downloadText = (session: RecordingSession) => {
    const content = session.formattedText || session.snippets.map(s => s.text).join("\n");
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name.replace(/\.[^/.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeSession = (id: string) => {
    setState(prev => ({
      ...prev,
      sessions: prev.sessions.filter(s => s.id !== id),
      activeSessionId: prev.activeSessionId === id ? (prev.sessions[0]?.id || null) : prev.activeSessionId
    }));
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] selection:bg-indigo-500/30">
      {/* Navigation Sidebar-ish Header */}
      <div className="max-w-6xl mx-auto px-6 pt-12 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        {/* Left: Controls & Session List */}
        <aside className="lg:col-span-4 space-y-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-white">VocalCanvas</h1>
            <p className="text-zinc-500 text-sm">Minimalist voice notes & smart formatting.</p>
          </div>

          <div className="space-y-4">
            {!state.isRecording ? (
              <button 
                onClick={startRecording}
                className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black rounded-xl font-medium transition-transform active:scale-[0.98] hover:bg-zinc-200"
              >
                <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
                Live Note
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-xl font-medium transition-transform active:scale-[0.98]"
              >
                Stop Recording
              </button>
            )}

            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) processFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              className={`group cursor-pointer border-2 border-dashed rounded-2xl p-8 transition-all flex flex-col items-center justify-center text-center space-y-2 ${
                isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <input type="file" ref={fileInputRef} multiple className="hidden" accept="audio/*" onChange={(e) => e.target.files && processFiles(e.target.files)} />
              <svg className="w-6 h-6 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm font-medium text-zinc-400">Dump files here</span>
              <span className="text-xs text-zinc-600">MP3, WAV, M4A</span>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 px-1">Recent Notes</h3>
            <div className="space-y-1">
              {state.sessions.map(s => (
                <div 
                  key={s.id}
                  onClick={() => setState(prev => ({ ...prev, activeSessionId: s.id }))}
                  className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                    state.activeSessionId === s.id ? 'bg-zinc-900 border border-zinc-800' : 'hover:bg-zinc-900/50'
                  }`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className={`text-sm font-medium truncate ${state.activeSessionId === s.id ? 'text-white' : 'text-zinc-400'}`}>
                      {s.name}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {s.status === 'completed' ? 'Ready' : s.status}
                    </span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {state.sessions.length === 0 && (
                <div className="py-8 text-center border border-zinc-900 rounded-xl border-dashed">
                  <span className="text-xs text-zinc-700">No notes yet</span>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Right: Focused View */}
        <main className="lg:col-span-8 space-y-8">
          {activeSession ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-xl font-medium text-white">{activeSession.name}</h2>
                  <p className="text-zinc-500 text-sm">Created {new Date(activeSession.timestamp).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeSession.status === 'idle' && (
                    <button 
                      onClick={() => smartFormat(activeSession.id)}
                      className="px-4 py-1.5 rounded-full border border-indigo-500/50 text-indigo-400 text-sm hover:bg-indigo-500/10 transition-colors"
                    >
                      Format Note
                    </button>
                  )}
                  <button 
                    onClick={() => downloadText(activeSession)}
                    className="px-4 py-1.5 rounded-full border border-zinc-800 text-zinc-400 text-sm hover:bg-zinc-800 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download .txt
                  </button>
                </div>
              </div>

              {state.isRecording && activeSession.id === state.activeSessionId && (
                <div className="mb-6 p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800/50 flex items-center justify-center">
                  <AudioVisualizer isRecording={state.isRecording} stream={stream} />
                </div>
              )}

              <div className="grid grid-cols-1 gap-12">
                {activeSession.formattedText ? (
                  <div className="prose prose-invert max-w-none">
                    <div className="bg-zinc-900/30 rounded-3xl p-8 border border-zinc-800/40 shadow-inner">
                      {activeSession.formattedText.split('\n').map((line, i) => (
                        <p key={i} className="mb-2 last:mb-0">
                          {line.split(/(\[.*?\])/g).map((part, j) => {
                            if (part.startsWith('[') && part.endsWith(']')) {
                              return <span key={j} className="text-indigo-400 font-bold opacity-80">{part}</span>;
                            }
                            return part;
                          })}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeSession.status === 'transcribing' && (
                      <div className="flex items-center gap-3 text-zinc-500 p-4 border border-zinc-900 rounded-2xl animate-pulse">
                        <div className="w-4 h-4 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
                        <span className="text-sm">Transcribing voice note...</span>
                      </div>
                    )}
                    {activeSession.snippets.map(s => (
                      <TranscriptionCard key={s.id} snippet={s} />
                    ))}
                    {activeSession.snippets.length === 0 && activeSession.status !== 'transcribing' && (
                      <div className="py-24 text-center border border-zinc-900 rounded-3xl border-dashed">
                        <p className="text-zinc-600">Start speaking or wait for upload...</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4 opacity-20">
              <svg className="w-16 h-16 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <h2 className="text-lg font-medium">Select or create a note</h2>
            </div>
          )}
        </main>
      </div>

      {state.error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-600/90 backdrop-blur px-4 py-2 rounded-full text-xs font-bold text-white shadow-2xl z-50 animate-bounce">
          {state.error}
        </div>
      )}
    </div>
  );
};

export default App;
