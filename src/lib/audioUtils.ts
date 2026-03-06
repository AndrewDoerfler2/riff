// ─── Audio Utilities ────────────────────────────────────────────────────────────
// Pure utility functions for audio data, peak extraction, and time formatting.
// No React or Web Audio node dependencies — safe to import anywhere.

export function formatTime(seconds: number, bpm: number): string {
  const totalBars = Math.floor(seconds / (240 / bpm));
  const beatInBar = Math.floor((seconds % (240 / bpm)) / (60 / bpm));
  const ticks = Math.floor(((seconds % (60 / bpm)) / (60 / bpm)) * 100);
  return `${String(totalBars + 1).padStart(3, '0')}:${beatInBar + 1}:${String(ticks).padStart(2, '0')}`;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function computePeaks(buffer: AudioBuffer, numPoints: number): number[] {
  const data = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / numPoints));
  const stride = Math.max(1, Math.floor(blockSize / 48));
  const peaks: number[] = [];
  for (let i = 0; i < numPoints; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(data.length, start + blockSize);
    for (let j = start; j < end; j += stride) {
      const abs = Math.abs(data[j] || 0);
      if (abs > max) max = abs;
    }
    peaks.push(Math.min(1, max));
  }
  return peaks;
}

export function readFileAsArrayBuffer(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.onabort = () => reject(new Error('File read was aborted.'));
    reader.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.((event.loaded / event.total) * 100);
    };
    reader.onload = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error('Unexpected file read result.'));
        return;
      }
      onProgress?.(100);
      resolve(result);
    };
    reader.readAsArrayBuffer(file);
  });
}
