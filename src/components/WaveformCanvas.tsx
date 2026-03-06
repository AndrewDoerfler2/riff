import { useRef, useEffect } from 'react';

interface WaveformCanvasProps {
  peaks: number[];
  color: string;
  width: number;
  height: number;
  gain?: number;
}

export default function WaveformCanvas({ peaks, color, width, height, gain = 1 }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    if (!peaks.length) {
      // Empty track – draw center line
      ctx.strokeStyle = color + '44';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    const midY = height / 2;
    const barWidth = width / peaks.length;

    // Draw waveform
    ctx.fillStyle = color + 'cc';
    peaks.forEach((peak, i) => {
      const h = Math.max(1, peak * gain * midY * 0.9);
      const x = i * barWidth;
      ctx.fillRect(x, midY - h, Math.max(1, barWidth - 0.5), h * 2);
    });

    // Bright center line
    ctx.strokeStyle = color + 'ff';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
  }, [peaks, color, width, height, gain]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block' }}
    />
  );
}
