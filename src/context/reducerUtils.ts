/**
 * Shared low-level utilities used by dawReducer and its domain slice reducers.
 * Keep this file free of DAW business logic — only pure helpers.
 */
import type { Track } from '../types/daw';

export function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function updateTrackById(
  tracks: Track[],
  trackId: string,
  updateTrack: (track: Track) => Track,
): Track[] {
  let changed = false;
  const nextTracks = tracks.map((track) => {
    if (track.id !== trackId) return track;
    const nextTrack = updateTrack(track);
    changed = changed || nextTrack !== track;
    return nextTrack;
  });
  return changed ? nextTracks : tracks;
}

export function updateTrackClipById(
  tracks: Track[],
  trackId: string,
  clipId: string,
  updateClip: (clip: Track['clips'][number]) => Track['clips'][number],
): Track[] {
  return updateTrackById(tracks, trackId, (track) => {
    let changed = false;
    const nextClips = track.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const nextClip = updateClip(clip);
      changed = changed || nextClip !== clip;
      return nextClip;
    });
    return changed ? { ...track, clips: nextClips } : track;
  });
}
