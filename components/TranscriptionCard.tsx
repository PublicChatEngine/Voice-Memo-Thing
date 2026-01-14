
import React from 'react';
import { TranscriptionSnippet } from '../types';

interface TranscriptionCardProps {
  snippet: TranscriptionSnippet;
}

const TranscriptionCard: React.FC<TranscriptionCardProps> = ({ snippet }) => {
  const formatText = (text: string) => {
    const parts = text.split(/(\[.*?\])/g);
    return parts.map((part, i) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        return (
          <span key={i} className="text-indigo-400 font-bold text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/10 mx-1 uppercase tracking-widest inline-block align-middle">
            {part.slice(1, -1)}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className={`group transition-all duration-500 border-l-2 ${snippet.isFinal ? 'opacity-100 border-indigo-500/50' : 'opacity-40 border-zinc-800 animate-pulse'} pl-6 py-2`}>
      <p className="text-zinc-300 font-normal leading-relaxed text-[15px] tracking-tight">
        {formatText(snippet.text)}
      </p>
      <span className="text-[9px] text-zinc-600 font-medium uppercase tracking-widest mt-2 block">
        {new Date(snippet.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
};

export default TranscriptionCard;
