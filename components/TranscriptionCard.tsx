
import React from 'react';
import { TranscriptionSnippet } from '../types';

interface TranscriptionCardProps {
  snippet: TranscriptionSnippet;
}

const TranscriptionCard: React.FC<TranscriptionCardProps> = ({ snippet }) => {
  // Simple regex to highlight bracketed noise markers
  const formatText = (text: string) => {
    const parts = text.split(/(\[.*?\])/g);
    return parts.map((part, i) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        return (
          <span key={i} className="px-2 py-0.5 mx-1 text-xs font-bold uppercase tracking-wider rounded bg-indigo-900/40 text-indigo-300 border border-indigo-500/30">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className={`p-4 mb-3 rounded-xl border transition-all duration-300 ${
      snippet.isFinal 
        ? 'bg-slate-800/40 border-slate-700/50 shadow-sm' 
        : 'bg-slate-800/20 border-indigo-500/20 animate-pulse'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-slate-500">
          {new Date(snippet.timestamp).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
        </span>
        {!snippet.isFinal && (
          <span className="flex h-2 w-2 rounded-full bg-indigo-500"></span>
        )}
      </div>
      <p className="text-slate-200 leading-relaxed font-medium">
        {formatText(snippet.text)}
      </p>
    </div>
  );
};

export default TranscriptionCard;
