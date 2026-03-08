/**
 * Domain slice reducer for all video-clip and text-overlay actions.
 * Extracted from dawReducer.ts to keep each domain self-contained.
 */
import type { DAWState, DAWAction, VideoClip, VideoTextOverlay } from '../types/daw';
import { clamp, genId, updateTrackById } from './reducerUtils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clipVisibleDuration(clip: VideoClip): number {
  return Math.max(0.1, clip.duration - clip.trimIn - clip.trimOut);
}

function normalizeVideoTextOverlay(
  overlay: VideoTextOverlay,
  visibleDuration: number,
): VideoTextOverlay {
  const safeDuration = Math.max(0.1, visibleDuration);
  const safeStart = clamp(overlay.startOffset ?? 0, 0, Math.max(0, safeDuration - 0.1));
  const minEnd = Math.min(safeDuration, safeStart + 0.1);
  return {
    ...overlay,
    text: (overlay.text ?? '').slice(0, 240),
    startOffset: safeStart,
    endOffset: clamp(overlay.endOffset ?? minEnd, minEnd, safeDuration),
    x: clamp(overlay.x ?? 0.5, 0, 1),
    y: clamp(overlay.y ?? 0.85, 0, 1),
    fontSize: clamp(overlay.fontSize ?? 28, 12, 72),
    opacity: clamp(overlay.opacity ?? 1, 0, 1),
    bgOpacity: clamp(overlay.bgOpacity ?? 0.55, 0, 1),
  };
}

function normalizeVideoClip(clip: VideoClip): VideoClip {
  const merged = { ...clip };
  merged.trimIn = Math.max(0, merged.trimIn);
  merged.trimOut = Math.max(0, merged.trimOut);
  merged.opacity = clamp(merged.opacity, 0, 1);
  merged.volume = clamp(merged.volume, 0, 1);
  merged.layoutX = clamp(merged.layoutX ?? 0.5, 0, 1);
  merged.layoutY = clamp(merged.layoutY ?? 0.5, 0, 1);
  merged.layoutScale = clamp(merged.layoutScale ?? 1, 0.2, 2);
  merged.startTime = Math.max(0, merged.startTime);
  const visibleDuration = clipVisibleDuration(merged);
  merged.textOverlays = (merged.textOverlays ?? [])
    .map((overlay) => normalizeVideoTextOverlay(overlay, visibleDuration));
  return merged;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function videoReducer(state: DAWState, action: DAWAction): DAWState {
  switch (action.type) {
    case 'ADD_VIDEO_CLIP':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => ({
          ...track,
          videoClips: [...track.videoClips, normalizeVideoClip(action.payload.clip)],
        })),
      };

    case 'REMOVE_VIDEO_CLIP':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => ({
          ...track,
          videoClips: track.videoClips.filter((vc) => vc.id !== action.payload.clipId),
        })),
      };

    case 'UPDATE_VIDEO_CLIP':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => {
          let changed = false;
          const nextClips = track.videoClips.map((vc) => {
            if (vc.id !== action.payload.clipId) return vc;
            const merged = normalizeVideoClip({ ...vc, ...action.payload.updates });
            changed = true;
            return merged;
          });
          return changed ? { ...track, videoClips: nextClips } : track;
        }),
      };

    case 'MOVE_VIDEO_CLIP':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => {
          let changed = false;
          const nextClips = track.videoClips.map((vc) => {
            if (vc.id !== action.payload.clipId) return vc;
            changed = true;
            return { ...vc, startTime: Math.max(0, action.payload.startTime) };
          });
          return changed ? { ...track, videoClips: nextClips } : track;
        }),
      };

    case 'SPLIT_VIDEO_CLIP': {
      const { trackId, clipId, splitTime } = action.payload;
      const MIN_VID_DURATION = 0.1;
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id !== trackId) return track;
          const vc = track.videoClips.find((c) => c.id === clipId);
          if (!vc) return track;

          const visibleStart = vc.startTime;
          const visibleEnd = vc.startTime + (vc.duration - vc.trimIn - vc.trimOut);

          if (
            splitTime <= visibleStart + MIN_VID_DURATION
            || splitTime >= visibleEnd - MIN_VID_DURATION
          ) {
            return track;
          }

          const leftVisible = splitTime - visibleStart;
          const rightVisible = visibleEnd - splitTime;
          const sourceVisibleDuration = clipVisibleDuration(vc);

          const leftOverlays = (vc.textOverlays ?? [])
            .map((overlay) => {
              if (overlay.endOffset <= 0 || overlay.startOffset >= leftVisible) return null;
              return normalizeVideoTextOverlay({
                ...overlay,
                endOffset: Math.min(overlay.endOffset, leftVisible),
              }, leftVisible);
            })
            .filter((overlay): overlay is VideoTextOverlay => Boolean(overlay));

          const rightOverlays = (vc.textOverlays ?? [])
            .map((overlay) => {
              if (overlay.endOffset <= leftVisible || overlay.startOffset >= sourceVisibleDuration) return null;
              const shiftedStart = Math.max(0, overlay.startOffset - leftVisible);
              const shiftedEnd = Math.max(shiftedStart + 0.1, overlay.endOffset - leftVisible);
              return normalizeVideoTextOverlay({
                ...overlay,
                startOffset: shiftedStart,
                endOffset: shiftedEnd,
              }, rightVisible);
            })
            .filter((overlay): overlay is VideoTextOverlay => Boolean(overlay));

          const leftClip: typeof vc = {
            ...vc,
            id: genId(),
            trimOut: vc.duration - vc.trimIn - leftVisible,
            textOverlays: leftOverlays,
          };

          const rightClip: typeof vc = {
            ...vc,
            id: genId(),
            startTime: splitTime,
            trimIn: vc.trimIn + leftVisible,
            duration: vc.duration,
            textOverlays: rightOverlays,
          };

          if (leftClip.trimOut < 0 || rightVisible <= 0) return track;

          const nextVideoClips = track.videoClips.flatMap((c) =>
            c.id === clipId ? [leftClip, rightClip] : [c],
          );
          return { ...track, videoClips: nextVideoClips };
        }),
      };
    }

    case 'ADD_VIDEO_TEXT_OVERLAY':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => {
          let changed = false;
          const nextClips = track.videoClips.map((vc) => {
            if (vc.id !== action.payload.clipId) return vc;
            changed = true;
            const visibleDuration = clipVisibleDuration(vc);
            const normalizedOverlay = normalizeVideoTextOverlay(action.payload.overlay, visibleDuration);
            return normalizeVideoClip({
              ...vc,
              textOverlays: [...(vc.textOverlays ?? []), normalizedOverlay],
            });
          });
          return changed ? { ...track, videoClips: nextClips } : track;
        }),
      };

    case 'UPDATE_VIDEO_TEXT_OVERLAY':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => {
          let changed = false;
          const nextClips = track.videoClips.map((vc) => {
            if (vc.id !== action.payload.clipId) return vc;
            const existing = vc.textOverlays ?? [];
            const nextOverlays = existing.map((overlay) => {
              if (overlay.id !== action.payload.overlayId) return overlay;
              changed = true;
              return { ...overlay, ...action.payload.updates };
            });
            return changed ? normalizeVideoClip({ ...vc, textOverlays: nextOverlays }) : vc;
          });
          return changed ? { ...track, videoClips: nextClips } : track;
        }),
      };

    case 'REMOVE_VIDEO_TEXT_OVERLAY':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => {
          let changed = false;
          const nextClips = track.videoClips.map((vc) => {
            if (vc.id !== action.payload.clipId) return vc;
            const nextOverlays = (vc.textOverlays ?? []).filter((overlay) => overlay.id !== action.payload.overlayId);
            if (nextOverlays.length === (vc.textOverlays ?? []).length) return vc;
            changed = true;
            return { ...vc, textOverlays: nextOverlays };
          });
          return changed ? { ...track, videoClips: nextClips } : track;
        }),
      };

    default:
      return state;
  }
}
