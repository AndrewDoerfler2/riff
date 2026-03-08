import { memo, useRef } from 'react';
import type { Track, AudioClip, NoteEvent } from '../../types/daw';
import WaveformCanvas from '../WaveformCanvas';
import { MIN_CLIP_DURATION_SECONDS, maybeSnapTime } from '../../lib/timelineSnap';

// ── Mini piano-roll preview ───────────────────────────────────────────────────

interface MiniPianoRollProps {
  notes: NoteEvent[];
  clipStartBeats: number;
  clipDurationBeats: number;
  width: number;
  height: number;
  color: string;
}

function MiniPianoRoll({ notes, clipStartBeats, clipDurationBeats, width, height, color }: MiniPianoRollProps) {
  if (!notes.length) {
    return (
      <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: color + '88', fontSize: 10 }}>Empty — click Edit to add notes</span>
      </div>
    );
  }

  const midiValues = notes.map(n => n.midi);
  const minMidi = Math.min(...midiValues);
  const maxMidi = Math.max(...midiValues);
  const midiRange = Math.max(1, maxMidi - minMidi + 1);

  const totalBeats = Math.max(0.25, clipDurationBeats);

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'hidden' }}>
      {notes.map((note, i) => {
        const relStart = Math.max(0, note.startBeats - clipStartBeats);
        const x = (relStart / totalBeats) * width;
        const noteWidth = Math.max(2, (note.durationBeats / totalBeats) * width);
        const y = height - ((note.midi - minMidi + 1) / midiRange) * height;
        const barHeight = Math.max(1, height / midiRange);
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={noteWidth}
            height={barHeight}
            fill={color}
            opacity={Math.max(0.3, note.velocity)}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

const MIN_TRACK_H = 96;

interface ClipBlockProps {
  clip: AudioClip;
  track: Track;
  zoom: number;
  bpm: number;
  snapEnabled: boolean;
  selected: boolean;
  selectedCount: number;
  onSelect: (clipId: string, additive: boolean) => void;
  onMove: (clipId: string, newStart: number) => void;
  onResize: (clipId: string, updates: Partial<AudioClip>) => void;
  onDelete: (clipId: string) => void;
  onSplit?: (clipId: string) => void;
  onPitchChange?: (clipId: string, semitones: number) => void;
}

export const ClipBlock = memo(function ClipBlock({
  clip, track, zoom, bpm, snapEnabled, selected, selectedCount, onSelect, onMove, onResize, onDelete, onSplit, onPitchChange,
}: ClipBlockProps) {
  const left = clip.startTime * zoom;
  const width = Math.max(4, clip.duration * zoom);
  const dragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const sourceDuration = clip.audioBuffer?.duration ?? clip.duration;
  const peakCount = clip.waveformPeaks.length;
  const peakStart = peakCount > 0 ? Math.floor((clip.offset / sourceDuration) * peakCount) : 0;
  const peakEnd = peakCount > 0 ? Math.max(peakStart + 1, Math.ceil(((clip.offset + clip.duration) / sourceDuration) * peakCount)) : peakCount;
  const visiblePeaks = peakCount > 0 ? clip.waveformPeaks.slice(peakStart, peakEnd) : clip.waveformPeaks;

  // Fade dimensions (clamped so fadeIn + fadeOut <= duration)
  const maxFade = Math.max(0, clip.duration - MIN_CLIP_DURATION_SECONDS);
  const fadeInSec = Math.max(0, Math.min(clip.fadeIn ?? 0, maxFade));
  const fadeOutSec = Math.max(0, Math.min(clip.fadeOut ?? 0, maxFade - fadeInSec));
  const fadeInPx = fadeInSec * zoom;
  const fadeOutPx = fadeOutSec * zoom;

  // ── Clip drag ─────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startTime: clip.startTime };
    const onMove_ = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = me.clientX - dragRef.current.startX;
      const rawStart = Math.max(0, dragRef.current.startTime + dx / zoom);
      const newStart = Math.max(0, maybeSnapTime(rawStart, bpm, snapEnabled));
      onMove(clip.id, newStart);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove_);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  };

  // ── Trim handles ─────────────────────────────────────────────────────────
  const handleResizeLeft = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const origOffset = clip.offset;
    const maxOffset = Math.max(MIN_CLIP_DURATION_SECONDS, sourceDuration - MIN_CLIP_DURATION_SECONDS);
    const onMove_ = (me: MouseEvent) => {
      const dt = (me.clientX - startX) / zoom;
      const maxStart = origStart + origDuration - MIN_CLIP_DURATION_SECONDS;
      const rawStart = Math.max(0, Math.min(origStart + dt, maxStart));
      const snappedStart = maybeSnapTime(rawStart, bpm, snapEnabled);
      const newStart = Math.max(0, Math.min(maxStart, snappedStart));
      const newDuration = origDuration - (newStart - origStart);
      const newOffset = Math.max(0, Math.min(origOffset + (newStart - origStart), maxOffset));
      onResize(clip.id, { startTime: newStart, duration: newDuration, offset: newOffset });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove_);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  };

  const handleResizeRight = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = clip.startTime;
    const origEnd = clip.startTime + clip.duration;
    const maxEnd = clip.startTime + Math.max(MIN_CLIP_DURATION_SECONDS, sourceDuration - clip.offset);
    const onMove_ = (me: MouseEvent) => {
      const rawEnd = origEnd + (me.clientX - startX) / zoom;
      const snappedEnd = maybeSnapTime(rawEnd, bpm, snapEnabled);
      const boundedEnd = Math.max(origStart + MIN_CLIP_DURATION_SECONDS, Math.min(maxEnd, snappedEnd));
      const newDuration = Math.max(MIN_CLIP_DURATION_SECONDS, boundedEnd - origStart);
      onResize(clip.id, { duration: newDuration });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove_);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  };

  // ── Fade handles ─────────────────────────────────────────────────────────
  const handleFadeInDrag = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const origFadeIn = fadeInSec;
    const onMove_ = (me: MouseEvent) => {
      const dx = (me.clientX - startX) / zoom;
      const newFadeIn = Math.max(0, Math.min(clip.duration - Math.max(0, clip.fadeOut ?? 0) - MIN_CLIP_DURATION_SECONDS, origFadeIn + dx));
      onResize(clip.id, { fadeIn: newFadeIn });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove_);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  };

  const handleFadeOutDrag = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const origFadeOut = fadeOutSec;
    const onMove_ = (me: MouseEvent) => {
      // dragging left increases fade-out, dragging right decreases
      const dx = (me.clientX - startX) / zoom;
      const newFadeOut = Math.max(0, Math.min(clip.duration - Math.max(0, clip.fadeIn ?? 0) - MIN_CLIP_DURATION_SECONDS, origFadeOut - dx));
      onResize(clip.id, { fadeOut: newFadeOut });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove_);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  };

  // ── Context menu / delete ────────────────────────────────────────────────
  const requestDelete = () => onDelete(clip.id);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(clip.id, false);
    requestDelete();
  };

  // Unique gradient IDs for this clip
  const fadeInId = `fi-${clip.id}`;
  const fadeOutId = `fo-${clip.id}`;

  return (
    <div
      className="clip-block"
      style={{
        left,
        width,
        background: track.color + '33',
        borderLeft: `2px solid ${track.color}`,
        borderTop: `1px solid ${track.color}66`,
        borderBottom: `1px solid ${track.color}44`,
      }}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(clip.id, e.metaKey || e.ctrlKey);
      }}
      onContextMenu={handleContextMenu}
      data-selected={selected ? 'true' : 'false'}
    >
      {/* ── Trim resize handles ── */}
      <div
        className="clip-resize-handle clip-resize-left"
        onMouseDown={handleResizeLeft}
        title="Drag to trim start"
      />

      {/* ── Clip label ── */}
      <div className="clip-label" style={{ color: track.color }}>
        {clip.name}
        {(clip.pitchSemitones ?? 0) !== 0 && (
          <span className="clip-pitch-badge" title="Pitch shift (semitones — also affects speed)">
            {(clip.pitchSemitones ?? 0) > 0 ? '+' : ''}{clip.pitchSemitones}st
          </span>
        )}
      </div>

      {/* ── Waveform or MIDI piano-roll preview ── */}
      {clip.midiNotes !== undefined ? (
        <MiniPianoRoll
          notes={clip.midiNotes}
          clipStartBeats={clip.startTime * (bpm / 60)}
          clipDurationBeats={clip.duration * (bpm / 60)}
          width={Math.max(4, width - 4)}
          height={Math.max(20, MIN_TRACK_H - 24)}
          color={track.color}
        />
      ) : (
        <WaveformCanvas
          peaks={visiblePeaks}
          color={track.color}
          width={Math.max(4, width - 4)}
          height={Math.max(20, MIN_TRACK_H - 24)}
          gain={clip.gain}
        />
      )}

      {/* ── Fade overlay (SVG gradients) ── */}
      {(fadeInPx > 0 || fadeOutPx > 0) && (
        <svg
          className="clip-fade-overlay"
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={fadeInId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#000" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#000" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={fadeOutId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#000" stopOpacity="0" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          {fadeInPx > 0 && (
            <rect x={0} y={0} width={fadeInPx} height={100} fill={`url(#${fadeInId})`} />
          )}
          {fadeOutPx > 0 && (
            <rect x={width - fadeOutPx} y={0} width={fadeOutPx} height={100} fill={`url(#${fadeOutId})`} />
          )}
        </svg>
      )}

      {/* ── Fade-in handle (top-left area, draggable right) ── */}
      <div
        className="clip-fade-handle clip-fade-in-handle"
        style={{ left: fadeInPx }}
        onMouseDown={handleFadeInDrag}
        title={`Fade in: ${fadeInSec.toFixed(2)}s — drag to adjust`}
      />

      {/* ── Fade-out handle (top-right area, draggable left) ── */}
      <div
        className="clip-fade-handle clip-fade-out-handle"
        style={{ left: width - fadeOutPx }}
        onMouseDown={handleFadeOutDrag}
        title={`Fade out: ${fadeOutSec.toFixed(2)}s — drag to adjust`}
      />

      {/* ── Selected clip actions ── */}
      {selected && (
        <div className="clip-action-row">
          {onSplit && (
            <button
              type="button"
              className="clip-menu-split"
              onClick={(e) => {
                e.stopPropagation();
                onSplit(clip.id);
              }}
              title="Split at playhead (S)"
            >
              ✂ Split
            </button>
          )}
          {onPitchChange && (
            <>
              <button
                type="button"
                className="clip-pitch-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onPitchChange(clip.id, Math.max(-24, (clip.pitchSemitones ?? 0) - 1));
                }}
                title="Pitch down 1 semitone"
              >
                ♭−
              </button>
              <span
                className="clip-pitch-display"
                title="Current pitch offset in semitones (tape-style: also affects speed)"
              >
                {(clip.pitchSemitones ?? 0) > 0 ? '+' : ''}{clip.pitchSemitones ?? 0}st
              </span>
              <button
                type="button"
                className="clip-pitch-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onPitchChange(clip.id, Math.min(24, (clip.pitchSemitones ?? 0) + 1));
                }}
                title="Pitch up 1 semitone"
              >
                ♯+
              </button>
              {(clip.pitchSemitones ?? 0) !== 0 && (
                <button
                  type="button"
                  className="clip-pitch-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPitchChange(clip.id, 0);
                  }}
                  title="Reset pitch to 0"
                >
                  ↺
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="clip-menu-delete"
            onClick={(e) => {
              e.stopPropagation();
              requestDelete();
            }}
          >
            {selectedCount > 1 ? `Delete selected (${selectedCount})` : 'Delete'}
          </button>
        </div>
      )}

      <div
        className="clip-resize-handle clip-resize-right"
        onMouseDown={handleResizeRight}
        title="Drag to trim end"
      />
    </div>
  );
});
