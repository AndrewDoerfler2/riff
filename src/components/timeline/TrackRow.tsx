import { memo, useEffect, useState } from 'react';
import type { Track, AudioClip } from '../../types/daw';
import { useDAW } from '../../context/DAWContext';
import LiveWaveform from '../LiveWaveform';
import { ClipBlock } from './ClipBlock';

const MIN_TRACK_H = 96;
const RECORD_FLASH_MS = 500;

export interface TrackRowProps {
  track: Track;
  zoom: number;
  scrollLeft: number;
  isRecording: boolean;
  selected: boolean;
  bpm: number;
  snapEnabled: boolean;
  selectedClipIds: Set<string>;
  selectedCount: number;
  onTrackHeaderClick: (trackId: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onTrackHeaderContextMenu: (trackId: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onDeleteTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelectClip: (trackId: string, clipId: string, additive: boolean) => void;
  onClearClipSelection: () => void;
  onClipMove: (trackId: string, clipId: string, newStart: number) => void;
  onClipResize: (trackId: string, clipId: string, updates: Partial<AudioClip>) => void;
  onClipDelete: (trackId: string, clipId: string) => void;
  onClipSplit?: (trackId: string, clipId: string) => void;
  onSetTime: (time: number) => void;
  contentWidth: number;
  analyser: AnalyserNode | null;
}

export const TrackRow = memo(function TrackRow({
  track, zoom, scrollLeft, isRecording, selected, bpm, snapEnabled, selectedClipIds, selectedCount,
  onTrackHeaderClick, onTrackHeaderContextMenu, onDeleteTrack, onMoveTrack, canMoveUp, canMoveDown,
  onSelectClip, onClearClipSelection, onClipMove, onClipResize, onClipDelete, onClipSplit, onSetTime,
  contentWidth, analyser,
}: TrackRowProps) {
  const { dispatch } = useDAW();
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (isRecording && track.armed) {
      const interval = setInterval(() => setFlash(f => !f), RECORD_FLASH_MS);
      return () => clearInterval(interval);
    }
    setFlash(false);
  }, [isRecording, track.armed]);

  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onClearClipSelection();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    onSetTime(x / zoom);
  };

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(track.name);

  const commitName = () => {
    dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { name: nameInput } } });
    setIsEditingName(false);
  };

  const isRecordingOnThis = isRecording && track.armed;
  const rowHeight = Math.max(MIN_TRACK_H, track.height);
  const beatWidth = Math.max(20, zoom * (60 / bpm));

  return (
    <div
      className="track-row"
      style={{ height: rowHeight, borderLeft: `3px solid ${track.color}` }}
    >
      {/* ── Track Header ── */}
      <div
        className="track-header"
        data-selected={selected ? 'true' : 'false'}
        style={{ background: isRecordingOnThis && flash ? '#ff453a22' : undefined }}
        onClick={(e) => onTrackHeaderClick(track.id, e)}
        onContextMenu={(e) => onTrackHeaderContextMenu(track.id, e)}
      >
        <div className="track-header-top">
          <div className="track-color-dot" style={{ background: track.color }} />
          {isEditingName ? (
            <input
              className="track-name-input"
              value={nameInput}
              autoFocus
              onChange={e => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') setIsEditingName(false);
              }}
            />
          ) : (
            <span className="track-name" onDoubleClick={() => setIsEditingName(true)}>{track.name}</span>
          )}
          <span className="track-type-badge">{track.type.toUpperCase()}</span>
        </div>

        <div className="track-controls-row">
          <button
            className={`trk-btn arm-btn ${track.armed ? 'armed' : ''}`}
            title="Arm for recording"
            onClick={e => { e.stopPropagation(); dispatch({ type: 'ARM_TRACK', payload: { id: track.id, armed: !track.armed } }); }}
          >
            {track.armed ? '●' : '○'}
          </button>
          <button
            className={`trk-btn mute-btn ${track.muted ? 'muted' : ''}`}
            title="Mute"
            onClick={e => { e.stopPropagation(); dispatch({ type: 'MUTE_TRACK', payload: { id: track.id, muted: !track.muted } }); }}
          >M</button>
          <button
            className={`trk-btn solo-btn ${track.soloed ? 'soloed' : ''}`}
            title="Solo"
            onClick={e => { e.stopPropagation(); dispatch({ type: 'SOLO_TRACK', payload: { id: track.id, soloed: !track.soloed } }); }}
          >S</button>
          <button
            className={`trk-btn monitor-btn ${track.inputMonitor ? 'monitor-on' : ''}`}
            title="Input Monitor"
            onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { inputMonitor: !track.inputMonitor } } }); }}
          >I</button>
        </div>

        <div className="track-fader-row">
          <span className="fader-label">Vol</span>
          <input
            type="range" className="track-fader vol-fader"
            min={0} max={1} step={0.01} value={track.volume}
            onClick={e => e.stopPropagation()}
            onChange={e => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { volume: parseFloat(e.target.value) } } })}
          />
          <span className="fader-label">Pan</span>
          <input
            type="range" className="track-fader pan-fader"
            min={-1} max={1} step={0.01} value={track.pan}
            onClick={e => e.stopPropagation()}
            onChange={e => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { pan: parseFloat(e.target.value) } } })}
          />
        </div>

        <div className="track-actions-row">
          <button
            className="trk-btn-sm reorder-btn"
            title="Move track up"
            disabled={!canMoveUp}
            onClick={e => { e.stopPropagation(); onMoveTrack(track.id, -1); }}
          >↑</button>
          <button
            className="trk-btn-sm reorder-btn"
            title="Move track down"
            disabled={!canMoveDown}
            onClick={e => { e.stopPropagation(); onMoveTrack(track.id, 1); }}
          >↓</button>
          <button
            className="trk-btn-sm"
            title="Plugins"
            onClick={e => { e.stopPropagation(); dispatch({ type: 'SET_PLUGIN_RACK_TRACK', payload: track.id }); }}
          >FX {track.plugins.length > 0 ? `(${track.plugins.length})` : ''}</button>
          <button
            className="trk-btn-sm delete-btn"
            title="Delete Track"
            onClick={e => { e.stopPropagation(); onDeleteTrack(track.id); }}
          >✕</button>
        </div>
      </div>

      {/* ── Track Content ── */}
      <div
        className="track-content"
        style={{
          width: contentWidth,
          cursor: 'crosshair',
          backgroundImage: `
            linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01)),
            repeating-linear-gradient(
              90deg,
              rgba(255,255,255,0.06) 0,
              rgba(255,255,255,0.06) 1px,
              transparent 1px,
              transparent ${beatWidth}px
            )
          `,
        }}
        onClick={handleContentClick}
      >
        {isRecordingOnThis && (
          analyser ? (
            <div className="live-waveform-container" style={{ opacity: flash ? 1 : 0.85 }}>
              <LiveWaveform
                analyser={analyser}
                color={track.color}
                width={Math.max(400, contentWidth)}
                height={Math.max(20, rowHeight - 8)}
              />
            </div>
          ) : (
            <div
              className="recording-bar"
              style={{ opacity: flash ? 0.5 : 0.25 }}
            />
          )
        )}

        {track.clips.length === 0 && !isRecordingOnThis && (
          <div className="track-empty-hint">
            {track.armed ? '● Arm • Press ● Record to capture' : 'Click to set playhead'}
          </div>
        )}

        {track.clips.map(clip => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            track={track}
            zoom={zoom}
            bpm={bpm}
            snapEnabled={snapEnabled}
            selected={selectedClipIds.has(clip.id)}
            selectedCount={selectedCount}
            onSelect={(clipId, additive) => onSelectClip(track.id, clipId, additive)}
            onMove={(clipId, newStart) => onClipMove(track.id, clipId, newStart)}
            onResize={(clipId, updates) => onClipResize(track.id, clipId, updates)}
            onDelete={(clipId) => onClipDelete(track.id, clipId)}
            onSplit={onClipSplit ? (clipId) => onClipSplit(track.id, clipId) : undefined}
          />
        ))}

        {track.videoClips.map(clip => (
          <div
            key={clip.id}
            className="video-clip-block"
            style={{
              left: clip.startTime * zoom,
              width: Math.max(4, clip.duration * zoom),
              background: track.color + '33',
              borderLeft: `2px solid ${track.color}`,
            }}
          >
            <span className="clip-label" style={{ color: track.color }}>🎬 {clip.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
