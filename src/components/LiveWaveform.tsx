import { useEffect, useRef } from 'react';

// ─── Live Waveform Canvas ──────────────────────────────────────────────────────
// Renders a real-time scrolling oscilloscope from an AnalyserNode.
// New samples appear on the right; older samples shift left — like a scrolling
// oscilloscope. Runs at ~60fps using requestAnimationFrame.

interface LiveWaveformProps {
  analyser: AnalyserNode | null;
  color: string;
  width: number;
  height: number;
}

export default function LiveWaveform({ analyser, color, width, height }: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  // Scrolling buffer: we keep a history of drawn columns to scroll left
  const historyRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const bufferLength = analyser.frequencyBinCount; // fftSize / 2 = 1024
    const dataArray = new Float32Array(bufferLength);

    // How many pixels we advance per frame
    const PIXELS_PER_FRAME = 2;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      analyser.getFloatTimeDomainData(dataArray);

      // Downsample to one column of pixels
      const samplesPerPixel = Math.floor(bufferLength / PIXELS_PER_FRAME);
      for (let col = 0; col < PIXELS_PER_FRAME; col++) {
        const slice = new Float32Array(height);
        // Compute the RMS/peak for this column's sample range
        for (let i = 0; i < height; i++) {
          const sampleIdx = Math.floor((col * samplesPerPixel + (i / height) * samplesPerPixel));
          slice[i] = dataArray[sampleIdx] ?? 0;
        }
        historyRef.current.push(slice);
      }

      // Keep only as many columns as fit the width
      const maxCols = Math.ceil(width / 1);
      if (historyRef.current.length > maxCols) {
        historyRef.current = historyRef.current.slice(historyRef.current.length - maxCols);
      }

      // Clear canvas
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.fillRect(0, 0, width, height);

      // Draw background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, 'rgba(0,0,0,0)');
      bg.addColorStop(0.5, 'rgba(0,0,0,0.1)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Draw waveform: one pixel column per history entry
      const histLen = historyRef.current.length;
      const startX = width - histLen;

      ctx.beginPath();
      let firstPoint = true;

      for (let col = 0; col < histLen; col++) {
        const x = startX + col;
        if (x < 0) continue;

        const slice = historyRef.current[col];
        // Average the samples in this slice for the y position
        let sum = 0;
        for (let s = 0; s < slice.length; s++) sum += slice[s];
        const avg = slice.length > 0 ? sum / slice.length : 0;

        const y = (height / 2) + avg * (height / 2) * 0.9;

        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 4;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw center line (dim)
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.strokeStyle = color + '22';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw recording indicator on right edge
      ctx.fillStyle = color + 'cc';
      ctx.fillRect(width - 3, 0, 3, height);
    };

    // Clear history on mount
    historyRef.current = [];
    draw();

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [analyser, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', borderRadius: 2 }}
    />
  );
}
