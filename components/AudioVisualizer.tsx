
import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isRecording: boolean;
  stream: MediaStream | null;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isRecording, stream }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Fix: Provide initial value to useRef to resolve "Expected 1 arguments, but got 0" error.
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!isRecording || !stream || !canvasRef.current) return;

    // Fix: Pass an options object to AudioContext constructor to resolve "Expected 1 arguments, but got 0" error.
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const draw = () => {
      if (!ctx) return;
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        ctx.fillStyle = `rgb(${barHeight + 100}, 50, 255)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      audioContext.close();
    };
  }, [isRecording, stream]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-12 rounded-lg opacity-60" 
      width={600} 
      height={48}
    />
  );
};

export default AudioVisualizer;
