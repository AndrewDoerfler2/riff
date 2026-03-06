import { memo, useRef } from 'react';
import type { Track, AudioClip } from '../../types/daw';
import WaveformCanvas from '../WaveformCanvas';

const MIN_TRACK_H = 96;

interface ClipBlockProps {
  clip: AudioClip;
  track: Track;
  zoom: number;
  selected: boolean;
  selectedCount: number;
  onSelect: (clipId: string, additive: boolean) => void;
  onMove: (clipId: string, newStart: number) => void;
  onResize: (clipId: string, updates: Partial<AudioClip>) => void;
  onDelete: (clipId: string) => void;
}

export const ClipBlock = memo(function ClipBlock({
  clip, track, zoom, selected, selectedCount, onSelect, onMove, onResize, onDelete,
}: ClipBlockProps) {
  const left = clip.startTime * zoom;
  const width = Math.max(4, clip.duration * zoom);
  const dragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const sourceDuration = clip.audioBuffer?.duration ?? clip.duration;
  const peakCount = clip.waveformPeaks.length;
  const peakStart = peakCount > 0 ? Math.floor((clip.offset / sourceDuration) * peakCount) : 0;
  const peakEnd = peakCount > 0 ? Math.max(peakStart + 1, Math.ceil(((clip.offset + clip.duration) / sourceDuration) * peakCount)) : peakCount;
  const visiblePeaks = peakCount > 0 ? clip.waveformPeaks.slice(peakStart, peakEnd) : clip.waveformPeaks;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startTime: clip.startTime };
    const onMove_ = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = me.clientX - dragRef.current.startX;
      const newStart = Math.max(0, dragRef.current.startTime + dx / zoom);
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

  const handleResizeLeft = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const origOffset = clip.offset;
    const maxOffset = Math.max(0.05, sourceDuration - 0.05);
    const onMove_ = (me: MouseEvent) => {
      const dt = (me.clientX - startX) / zoom;
      const newStart = Math.max(0, Math.min(origStart + dt, origStart + origDuration - 0.05));
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
    const origDuration = clip.duration;
    const maxDuration = Math.max(0.05, sourceDuration - clip.offset);
    const onMove_ = (me: MouseEvent) => {
      const nextDuration = origDuration + (me.clientX - startX) / zoom;
      const newDuration = Math.max(0.05, Math.min(maxDuration, nextDuration));
      onResize(clip.id, { duration: newDuration });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove_);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  };

  const requestDelete = () => onDelete(clip.id);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(clip.id, false);
    requestDelete();
  };

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
      <div
        className="clip-resize-handle clip-resize-left"
        onMouseDown={handleResizeLeft}
        title="Drag to trim start"
      />
      <div className="clip-label" style={{ color: track.color }}>
        {clip.name}
      </div>
      <WaveformCanvas
        peaks={visiblePeaks}
        color={track.color}
        width={Math.max(4, width - 4)}
        height={Math.max(20, MIN_TRACK_H - 24)}
        gain={clip.gain}
      />
      {selected && (
        <button
          type="button"
          className="clip-menu-delete"
          onClick={(e) => {
            e.stopPropagation();
            requestDelete();
          }}
        >
          {selectedCount > 1 ? `Delete selected (${selectedCount})` : 'Delete recording'}
        </button>
      )}
      <div
        className="clip-resize-handle clip-resize-right"
        onMouseDown={handleResizeRight}
        title="Drag to trim end"
      />
    </div>
  );
});
