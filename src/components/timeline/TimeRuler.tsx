import { memo, useRef, useEffect } from 'react';

const RULER_H = 32;

interface TimeRulerProps {
  zoom: number;
  scrollLeft: number;
  bpm: number;
  timeSignature: string;
  width: number;
}

export const TimeRuler = memo(function TimeRuler({
  zoom, scrollLeft, bpm, timeSignature, width,
}: TimeRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = RULER_H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, RULER_H);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, RULER_H);

    const secPerBeat = 60 / bpm;
    const pxPerBeat = zoom * secPerBeat;
    const beatsPerBar = Number.parseInt(timeSignature, 10) || 4;
    const pxPerBar = pxPerBeat * beatsPerBar;

    let tickInterval = pxPerBar;
    if (tickInterval < 20) tickInterval = pxPerBar * 4;
    if (tickInterval < 10) tickInterval = pxPerBar * 8;

    const firstBar = Math.floor(scrollLeft / pxPerBar);
    const lastBar = Math.ceil((scrollLeft + width) / pxPerBar);

    ctx.font = '10px -apple-system, monospace';
    ctx.textAlign = 'left';

    for (let bar = firstBar; bar <= lastBar; bar++) {
      const x = bar * pxPerBar - scrollLeft;
      if (x < -10 || x > width + 10) continue;

      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();

      ctx.fillStyle = '#aaa';
      ctx.fillText(String(bar + 1), x + 3, RULER_H - 6);

      for (let beat = 1; beat < beatsPerBar; beat++) {
        const bx = x + beat * pxPerBeat;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(bx, RULER_H / 2);
        ctx.lineTo(bx, RULER_H);
        ctx.stroke();
      }
    }
  }, [zoom, scrollLeft, bpm, timeSignature, width]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height: RULER_H, display: 'block', cursor: 'pointer' }}
    />
  );
});
