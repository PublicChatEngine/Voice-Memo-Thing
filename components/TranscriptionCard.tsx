
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
          <span key={i} className="text-indigo-400 font-medium text-[11px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 mx-1 uppercase tracking-tighter">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className={`transition-all duration-700 ${snippet.isFinal ? 'opacity-100' : 'opacity-40 animate-pulse'}`}>
      <p className="text-zinc-400 font-light leading-relaxed tracking-tight">
        {formatText(snippet.text)}
      </p>
    </div>
  );
};

export default TranscriptionCard;
