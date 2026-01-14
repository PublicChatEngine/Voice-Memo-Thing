
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
          <span key={i} className="text-indigo-400 font-bold opacity-80 uppercase text-[10px] tracking-widest px-1">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className={`transition-opacity duration-500 ${snippet.isFinal ? 'opacity-100' : 'opacity-50 animate-pulse'}`}>
      <p className="text-zinc-300 leading-relaxed text-[15px]">
        {formatText(snippet.text)}
      </p>
    </div>
  );
};

export default TranscriptionCard;
