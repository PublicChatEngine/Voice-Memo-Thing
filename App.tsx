
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TranscriptionSnippet, AppState } from './types';
import { createLiveSession, formatTranscription, transcribeAudioFile } from './services/geminiService';
import { createBlob } from './utils/audio';
import TranscriptionCard from './components/TranscriptionCard';
import AudioVisualizer from './components/AudioVisualizer';

const App: React.FC = () => {
  const [state, setState] = useState<AppState & { isUploading: boolean }>({
    isRecording: false,
    isProcessing: false,
    isUploading: false,
    snippets: [],
    formattedText: null,
    error: null,
  });

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const snippetsEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    snippetsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [state.snippets]);

  const handleTranscription = useCallback((text: string, isFinal: boolean) => {
    setState(prev => {
      const lastSnippet = prev.snippets[prev.snippets.length - 1];
      
      if (lastSnippet && !lastSnippet.isFinal) {
        const updatedSnippets = [...prev.snippets];
        updatedSnippets[updatedSnippets.length - 1] = {
          ...lastSnippet,
          text: lastSnippet.text + " " + text,
          isFinal: isFinal,
        };
        return { ...prev, snippets: updatedSnippets };
      }

      const newSnippet: TranscriptionSnippet = {
        id: Math.random().toString(36).substr(2, 9),
        text,
        timestamp: Date.now(),
        isFinal,
      };
      return { ...prev, snippets: [...prev.snippets, newSnippet] };
    });
  }, []);

  const startRecording = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(audioStream);

      const sessionPromise = createLiveSession(
        handleTranscription,
        (err) => setState(prev => ({ ...prev, error: "Connection error. Please try again." }))
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
        }).catch(err => console.error("Error sending audio:", err));
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      setState(prev => ({ ...prev, isRecording: true, error: null, formattedText: null }));
    } catch (err) {
      console.error("Microphone access denied:", err);
      setState(prev => ({ ...prev, error: "Could not access microphone." }));
    }
  };

  const stopRecording = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    sessionPromiseRef.current = null;
    setState(prev => ({ ...prev, isRecording: false }));
  };

  const processAndFormat = async () => {
    if (state.snippets.length === 0) return;
    
    setState(prev => ({ ...prev, isProcessing: true }));
    try {
      const rawText = state.snippets.map(s => s.text).join(" ");
      const formatted = await formatTranscription(rawText);
      setState(prev => ({ ...prev, formattedText: formatted, isProcessing: false }));
    } catch (err) {
      console.error("Formatting failed:", err);
      setState(prev => ({ ...prev, isProcessing: false, error: "Formatting failed." }));
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('audio/')) {
      setState(prev => ({ ...prev, error: "Please upload an audio file (mp3, wav, etc.)" }));
      return;
    }

    setState(prev => ({ ...prev, isUploading: true, error: null, snippets: [], formattedText: null }));

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const transcription = await transcribeAudioFile(base64Data, file.type);
      
      // Split transcription into logical chunks (snippets) for the banner look
      // We'll split by sentences or punctuation to maintain the "snippets" feel
      const rawSnippets = transcription.match(/[^\.!\?]+[\.!\?]+/g) || [transcription];
      const processedSnippets: TranscriptionSnippet[] = rawSnippets.map((text, index) => ({
        id: `file-${index}-${Date.now()}`,
        text: text.trim(),
        timestamp: Date.now() + (index * 100),
        isFinal: true
      }));

      setState(prev => ({ 
        ...prev, 
        isUploading: false, 
        snippets: processedSnippets 
      }));
    } catch (err) {
      console.error("File transcription failed:", err);
      setState(prev => ({ ...prev, isUploading: false, error: "Failed to transcribe audio file." }));
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const clearSession = () => {
    setState({
      isRecording: false,
      isProcessing: false,
      isUploading: false,
      snippets: [],
      formattedText: null,
      error: null,
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col p-4 md:p-8">
      {/* Header */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
            VocalCanvas
          </h1>
          <p className="text-slate-400 text-sm">Voice Notes • Environmental Awareness • Smart AI</p>
        </div>
        <div className="flex gap-2">
          {state.snippets.length > 0 && !state.isRecording && !state.isUploading && (
            <button 
              onClick={clearSession}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-sm font-medium"
            >
              Reset
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-5xl w-full mx-auto flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start mb-24">
        
        {/* Left Side: Live Transcription & Upload */}
        <section 
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`flex flex-col h-[70vh] rounded-3xl border transition-all duration-300 overflow-hidden shadow-2xl relative ${
            isDragging ? 'bg-indigo-500/10 border-indigo-400' : 'bg-slate-900/50 border-slate-800/60'
          }`}
        >
          <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
            <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${state.isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`}></span>
              {state.isUploading ? 'Transcribing File...' : 'Transcription Canvas'}
            </h2>
            {state.isRecording && <AudioVisualizer isRecording={state.isRecording} stream={stream} />}
          </div>

          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {state.isUploading ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-6"></div>
                <h3 className="text-xl font-bold text-slate-200 mb-2">Analyzing Voice Note</h3>
                <p className="text-slate-400 max-w-xs">Gemini is listening through your audio file to capture every word and sound.</p>
              </div>
            ) : state.snippets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="mb-8 group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 transition-all duration-500 ${isDragging ? 'bg-indigo-500 scale-110' : 'bg-slate-800 group-hover:bg-slate-700'}`}>
                    <svg className={`w-10 h-10 ${isDragging ? 'text-white' : 'text-indigo-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-slate-200">Drop your voice notes here</h3>
                  <p className="text-slate-400 text-sm mt-2">Supports MP3, WAV, M4A</p>
                  <p className="text-indigo-400 text-xs mt-4 font-medium uppercase tracking-widest">or click to browse</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="audio/*" 
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} 
                />
              </div>
            ) : (
              state.snippets.map((snippet) => (
                <TranscriptionCard key={snippet.id} snippet={snippet} />
              ))
            )}
            <div ref={snippetsEndRef} />
          </div>

          {/* Drag Overlay Label */}
          {isDragging && (
            <div className="absolute inset-0 bg-indigo-600/20 backdrop-blur-sm pointer-events-none flex items-center justify-center">
              <span className="bg-indigo-600 text-white px-6 py-3 rounded-full font-bold shadow-xl animate-bounce">
                Release to Transcribe
              </span>
            </div>
          )}
        </section>

        {/* Right Side: AI Formatted Output */}
        <section className="flex flex-col h-[70vh] bg-indigo-950/20 rounded-3xl border border-indigo-500/10 overflow-hidden shadow-2xl relative">
          <div className="p-6 border-b border-indigo-900/30 flex items-center justify-between bg-indigo-950/40 backdrop-blur-md sticky top-0 z-10">
            <h2 className="text-lg font-semibold text-indigo-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Smart Formatting
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-900/20">
            {state.isProcessing ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-indigo-300 font-medium">Gemini is structuring your transcription...</p>
                <p className="text-slate-500 text-xs mt-2">Preserving every word while improving readability.</p>
              </div>
            ) : state.formattedText ? (
              <div className="prose prose-invert max-w-none text-slate-300 leading-relaxed whitespace-pre-wrap">
                {state.formattedText.split('\n').map((line, i) => (
                  <p key={i} className="mb-4">
                    {line.split(/(\[.*?\])/g).map((part, j) => {
                      if (part.startsWith('[') && part.endsWith(']')) {
                        return (
                          <span key={j} className="text-indigo-400 font-bold opacity-80 px-1 border border-indigo-500/20 rounded bg-indigo-500/5">
                            {part}
                          </span>
                        );
                      }
                      return part;
                    })}
                  </p>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                <svg className="w-16 h-16 mb-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16m-7 6h7" />
                </svg>
                <p>Formatted text will appear here after processing.</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Persistent Controls */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-slate-950/80 backdrop-blur-xl border-t border-slate-800/50 z-50">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {!state.isRecording ? (
              <button
                disabled={state.isUploading}
                onClick={startRecording}
                className="flex items-center gap-3 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
              >
                <div className="w-3 h-3 bg-white rounded-full animate-ping"></div>
                Live Recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-full font-bold shadow-lg shadow-red-500/20 transition-all hover:scale-105"
              >
                <div className="w-3 h-3 bg-white rounded-sm"></div>
                Finish & Stop
              </button>
            )}

            {state.snippets.length > 0 && !state.isRecording && !state.formattedText && !state.isUploading && (
              <button
                onClick={processAndFormat}
                disabled={state.isProcessing}
                className="flex items-center gap-2 px-6 py-4 bg-indigo-950 border border-indigo-500/50 text-indigo-100 rounded-full font-bold hover:bg-indigo-900 transition-all disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Smart Format Transcription
              </button>
            )}
          </div>

          <div className="text-slate-500 text-sm italic text-center md:text-right">
            {state.error && <span className="text-red-400 font-medium">Error: {state.error}</span>}
            {!state.error && state.isRecording && "Actively listening for speech and environment cues..."}
            {!state.error && state.isUploading && "Processing audio file... this may take a few moments."}
            {!state.error && !state.isRecording && !state.isUploading && state.snippets.length > 0 && "Voice note transcribed. Ready for smart formatting."}
            {!state.error && !state.isRecording && !state.isUploading && state.snippets.length === 0 && "Record live or drop an audio file to begin."}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
