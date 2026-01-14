
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TranscriptionSnippet, AppState, RecordingSession } from './types';
import { createLiveSession, formatTranscription, processAudioFileStream } from './services/geminiService';
import { createBlob } from './utils/audio';
import TranscriptionCard from './components/TranscriptionCard';
import AudioVisualizer from './components/AudioVisualizer';

const App: React.FC = () => {
  const [state, setState] = useState<AppState & { searchQuery: string }>({
    isRecording: false,
    sessions: [],
    activeSessionId: null,
    error: null,
    searchQuery: '',
  });

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeSession = state.sessions.find(s => s.id === state.activeSessionId);

  const updateSession = useCallback((id: string, updates: Partial<RecordingSession>) => {
    setState(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === id ? { ...s, ...updates, lastEdited: Date.now() } : s)
    }));
  }, []);

  const startRecording = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(audioStream);

      const id = `live-${Date.now()}`;
      const session: RecordingSession = {
        id,
        name: `Live Note ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        snippets: [],
        formattedText: null,
        status: 'transcribing',
        timestamp: Date.now(),
        lastEdited: Date.now(),
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
            sessions[idx].lastEdited = Date.now();
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
      // After stopping, format the accumulated raw snippets
      updateSession(state.activeSessionId, { status: 'idle' }); // Set to idle, then start formatting
      handleSmartFormat(state.activeSessionId);
    }
    setState(prev => ({ ...prev, isRecording: false }));
  };

  const processFiles = async (files: FileList) => {
    // Create new sessions with status 'transcribing' initially for raw audio processing
    const newSessions: RecordingSession[] = Array.from(files).map(f => ({
      id: `file-${Math.random().toString(36).substr(2, 9)}`,
      name: f.name,
      snippets: [],
      formattedText: null,
      status: 'transcribing', // First stage: raw transcription
      timestamp: Date.now(),
      lastEdited: Date.now(),
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
        const base64 = await new Promise<string>(r => {
          const rd = new FileReader();
          rd.onload = () => r((rd.result as string).split(',')[1]);
          rd.readAsDataURL(file);
        });

        let rawTranscriptionAccumulated = "";
        // processAudioFileStream will stream raw transcription
        await processAudioFileStream(base64, file.type, (currentRawText) => {
          rawTranscriptionAccumulated = currentRawText;
          // For file processing, we'll update snippets with a single final raw text
          // to then pass to formatTranscription.
          // Or, for streaming display, you could update snippets with chunks.
          // For simplicity and to match the live session's snippet structure,
          // we'll keep the snippets updated for potential raw view.
          // But the main goal here is to accumulate for final formatting.
        });
        
        // Once raw transcription is complete, update status and proceed to formatting
        updateSession(session.id, { 
          snippets: [{ id: 'raw-file-transcription', text: rawTranscriptionAccumulated, timestamp: Date.now(), isFinal: true }],
          status: 'formatting' 
        });
        
        // Now, pass the full raw text to the formatter
        const formatted = await formatTranscription(rawTranscriptionAccumulated);
        updateSession(session.id, { formattedText: formatted, status: 'completed' });

      } catch (err) {
        console.error(err);
        updateSession(session.id, { status: 'error' });
      }
    }
  };

  const handleSmartFormat = async (id: string) => {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;
    updateSession(id, { status: 'formatting' }); // Indicate that formatting is now in progress
    try {
      const text = session.snippets.map(s => s.text).join(" ");
      const formatted = await formatTranscription(text);
      updateSession(id, { formattedText: formatted, status: 'completed' });
    } catch {
      updateSession(id, { status: 'error' });
    }
  };

  const download = (session: RecordingSession) => {
    const mainContent = session.formattedText || session.snippets.map(s => s.text).join("\n");
    const downloadFileName = session.name.replace(/\.[^/.]+$/, ""); // Remove file extension if present

    let metadata = `Title: ${session.formattedText ? session.formattedText.split('\n')[0].replace('### ', '') : session.name}\n`;
    metadata += `Created: ${new Date(session.timestamp).toLocaleString()}\n`;
    metadata += `Last Modified: ${new Date(session.lastEdited).toLocaleString()}\n`;

    if (session.id.startsWith('live-')) {
      const durationMs = session.lastEdited - session.timestamp;
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      metadata += `Duration: ${minutes}m ${seconds}s\n`;
      metadata += `Source: Live Recording\n`;
    } else {
      metadata += `Source: File: ${session.name}\n`;
    }

    const fullContent = `${metadata}---\n\n${mainContent}`;

    const blob = new Blob([fullContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${downloadFileName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bulkExport = () => {
    const completedSessions = state.sessions.filter(s => s.status === 'completed' || s.snippets.length > 0);
    completedSessions.forEach((s, index) => {
      setTimeout(() => download(s), index * 300);
    });
  };

  const filteredSessions = [...state.sessions]
    .sort((a, b) => b.lastEdited - a.lastEdited)
    .filter(s => {
      const query = state.searchQuery.toLowerCase();
      if (!query) return true;
      return s.name.toLowerCase().includes(query) || 
             s.snippets.some(snip => snip.text.toLowerCase().includes(query)) ||
             s.formattedText?.toLowerCase().includes(query);
    });

  useEffect(() => {
    if (isSearchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchExpanded]);

  const getRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="flex h-screen bg-[#000000] text-zinc-100 overflow-hidden font-sans">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,_#0a0a0a_0%,_#000000_100%)] pointer-events-none" />

      <aside className="w-80 border-r border-zinc-900/50 flex flex-col bg-black/40 backdrop-blur-xl relative z-20 overflow-hidden">
        {/* Sidebar Header - Fixed overlap by keeping elements in vertical stack */}
        <div className="p-8 pb-4 flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0">
              <h1 className="text-xl font-bold tracking-tight text-white">VocalCanvas</h1>
              <p className="text-[8px] uppercase tracking-[0.2em] text-zinc-600 font-bold">Studio Edition</p>
            </div>
            
            <button 
              onClick={() => setIsSearchExpanded(!isSearchExpanded)}
              className={`p-2 rounded-full transition-all hover:bg-zinc-800 ${isSearchExpanded ? 'bg-indigo-500/10 text-indigo-500' : 'text-zinc-600'}`}
            >
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </button>
          </div>

          <div className={`transition-all duration-300 ease-in-out ${isSearchExpanded ? 'max-h-16 opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
            <div className="relative">
              <input 
                ref={searchInputRef}
                type="text" 
                placeholder="Search conversations..."
                value={state.searchQuery}
                onChange={(e) => setState(prev => ({ ...prev, searchQuery: e.target.value }))}
                className="w-full bg-zinc-900/60 border border-zinc-800 text-[11px] font-medium py-2 px-4 rounded-xl outline-none focus:border-indigo-500/50 text-white placeholder:text-zinc-700"
              />
              {state.searchQuery && (
                <button 
                  onClick={() => setState(prev => ({ ...prev, searchQuery: '' }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-8 space-y-3">
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
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Import Audio</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 px-8 pt-10">
          <div className="flex items-center justify-between mb-6 px-1">
            <h3 className="text-[10px] font-bold text-zinc-700 uppercase tracking-[0.2em]">Library</h3>
            {filteredSessions.length > 0 && (
              <button 
                onClick={bulkExport}
                className="text-[10px] font-bold text-indigo-500/80 hover:text-indigo-400 uppercase tracking-widest flex items-center gap-1 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                Export
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar pb-8">
            {filteredSessions.map(s => (
              <div 
                key={s.id} 
                onClick={() => setState(prev => ({ ...prev, activeSessionId: s.id }))}
                className={`group flex flex-col p-4 rounded-2xl cursor-pointer transition-all border ${
                  state.activeSessionId === s.id 
                    ? 'bg-zinc-900/50 border-zinc-800 shadow-xl scale-[1.02]' 
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
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-1 h-1 rounded-full ${
                      s.status === 'completed' ? 'bg-emerald-500' : 
                      s.status === 'error' ? 'bg-red-500' : 'bg-indigo-500 animate-pulse'
                    }`} />
                    <span className="text-[9px] text-zinc-700 font-bold uppercase tracking-wider">{s.status}</span>
                  </div>
                  <span className="text-[9px] text-zinc-600 font-medium">
                    {getRelativeTime(s.lastEdited)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {activeSession ? (
          <div className="h-full flex flex-col px-12 lg:px-24 py-16 overflow-y-auto custom-scrollbar relative z-10">
            <header className="max-w-4xl w-full mx-auto flex flex-col md:flex-row md:items-end justify-between gap-8 mb-20 animate-in fade-in duration-500">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                   <div className="px-2 py-0.5 rounded-md bg-zinc-900 text-zinc-600 text-[10px] font-bold uppercase tracking-widest border border-zinc-800">
                    {new Date(activeSession.timestamp).toLocaleDateString()}
                  </div>
                  <div className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                    activeSession.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/10' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/10'
                  }`}>
                    {activeSession.status}
                  </div>
                </div>
                {/* Dynamically update the header name based on formatted text or original name */}
                <h2 className="text-5xl font-bold tracking-tight text-white leading-tight">
                  {activeSession.formattedText ? activeSession.formattedText.split('\n')[0].replace('### ', '') : activeSession.name}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => download(activeSession)}
                  className="px-6 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-bold hover:bg-zinc-800 hover:text-white transition-all flex items-center gap-2 shadow-lg active:scale-95"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download .txt
                </button>
              </div>
            </header>

            <div className="max-w-4xl w-full mx-auto space-y-16 pb-32">
              {state.isRecording && activeSession.id === state.activeSessionId && (
                <div className="py-12 flex items-center justify-center bg-zinc-900/10 rounded-[2.5rem] border border-zinc-900/50 backdrop-blur-3xl animate-in zoom-in-95 duration-700">
                  <AudioVisualizer isRecording={state.isRecording} stream={stream} />
                </div>
              )}

              <div className="space-y-12">
                {activeSession.formattedText && (activeSession.status === 'completed' || activeSession.status === 'formatting') ? (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    <div className="text-zinc-200 leading-[1.9] text-[17px] font-light space-y-10 whitespace-pre-wrap">
                      {activeSession.formattedText.split('\n').map((line, i) => {
                        if (!line.trim()) return null;
                        const isHeader = line.length < 120 && (line.startsWith('### ') || line.startsWith('**') && !line.includes('['));
                        const isSummary = line.startsWith('**Summary**');
                        const isKeyPoint = line.startsWith('* ');
                        const isActionItem = line.startsWith('- [ ]');
                        const isTag = line.startsWith('**Tags:**');

                        return (
                          <div key={i} className={`animate-in slide-in-from-bottom-2 duration-500 ${isHeader ? 'pt-8 first:pt-0' : ''}`}>
                            {line.split(/(\*\*.*?\*\*)|(\[.*?\])|(\n)/g).map((part, j) => {
                              if (!part) return null;
                              if (part.startsWith('### ')) {
                                return <span key={j} className="text-3xl font-bold text-white block mb-4">{part.substring(4)}</span>;
                              }
                              if (part.startsWith('**') && part.endsWith('**') && part.length > 4) { // Bold text
                                return <span key={j} className="font-bold text-white">{part}</span>;
                              }
                              if (part.startsWith('[') && part.endsWith(']')) {
                                return (
                                  <span key={j} className="text-indigo-400 font-bold opacity-80 px-2 py-0.5 rounded bg-indigo-500/5 border border-indigo-500/10 text-[11px] mx-1 uppercase tracking-wider inline-block align-middle">
                                    {part.slice(1, -1)}
                                  </span>
                                );
                              }
                              if (isKeyPoint || isActionItem) {
                                return <span key={j} className="text-zinc-300 ml-4 block leading-tight">{part}</span>;
                              }
                              if (isTag) {
                                return <span key={j} className="text-zinc-500 text-sm">{part}</span>;
                              }
                              return <span key={j}>{part}</span>;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {activeSession.status === 'transcribing' && (
                      <div className="flex items-center gap-4 text-indigo-400 mb-12 animate-pulse">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)]" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.4em]">Capturing Environment</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-6">
                      {activeSession.snippets.map(s => <TranscriptionCard key={s.id} snippet={s} />)}
                      {activeSession.status === 'formatting' && (
                        <div className="py-24 text-center space-y-4">
                          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto opacity-50" />
                          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-500/50">Smart Formatting In Progress</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-20 space-y-6 animate-in fade-in duration-1000">
            <div className="w-32 h-32 rounded-full border border-zinc-900 flex items-center justify-center group hover:border-zinc-800 transition-colors">
              <svg className="w-10 h-10 text-zinc-800 group-hover:text-zinc-700 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-zinc-700">Select Studio Note</p>
          </div>
        )}
      </main>

      {state.error && (
        <div className="fixed bottom-12 right-12 px-6 py-3 bg-red-500 text-white rounded-2xl text-[11px] font-bold shadow-2xl z-[100] flex items-center gap-3 animate-in slide-in-from-right-8">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          {state.error}
          <button onClick={() => setState(prev => ({ ...prev, error: null }))} className="ml-2 underline opacity-80">Dismiss</button>
        </div>
      )}
    </div>
  );
};

export default App;
