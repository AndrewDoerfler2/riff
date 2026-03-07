export const MIN_CLIP_DURATION_SECONDS = 0.05;

function beatDurationSeconds(bpm: number): number {
  return 60 / Math.max(1, bpm);
}

export function snapTimeToBeat(timeSeconds: number, bpm: number): number {
  const beatSeconds = beatDurationSeconds(bpm);
  return Math.round(timeSeconds / beatSeconds) * beatSeconds;
}

export function maybeSnapTime(timeSeconds: number, bpm: number, snapEnabled: boolean): number {
  if (!snapEnabled) return timeSeconds;
  return snapTimeToBeat(timeSeconds, bpm);
}
