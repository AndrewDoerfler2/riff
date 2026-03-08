import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track, AudioClip, AutomationLane, AutomationTarget } from '../../types/daw';
import { useDAW } from '../../context/DAWContext';
import LiveWaveform from '../LiveWaveform';
import { ClipBlock } from './ClipBlock';
import WaveformCanvas from '../WaveformCanvas';
import {
  automationTargetKey,
  automationTargetLabel,
  evaluateAutomationValue,
  getAutomationRange,
} from '../../lib/automation';
import { formatParameterLabel } from '../../lib/pluginParameterRanges';

const MIN_TRACK_H = 96;
const RECORD_FLASH_MS = 500;
const AUTOMATION_TOOLBAR_H = 32;
const AUTOMATION_LANE_H = 58;
const POINT_HIT_RADIUS = 9;

function getVisibleVideoPeaks(peaks: number[], trimIn: number, trimOut: number, duration: number): number[] {
  if (peaks.length === 0) return peaks;
  const safeDuration = Math.max(0.001, duration);
  const startRatio = Math.max(0, Math.min(1, trimIn / safeDuration));
  const endRatio = Math.max(startRatio, Math.min(1, (duration - trimOut) / safeDuration));
  const peakStart = Math.floor(startRatio * peaks.length);
  const peakEnd = Math.max(peakStart + 1, Math.ceil(endRatio * peaks.length));
  return peaks.slice(peakStart, peakEnd);
}

interface LaneOption {
  key: string;
  label: string;
  target: AutomationTarget;
}

interface AutomationLaneEditorProps {
  lane: AutomationLane;
  track: Track;
  zoom: number;
  contentWidth: number;
  currentTime: number;
  onUpdatePoint: (laneId: string, pointIndex: number, time: number, value: number) => void;
  onUpsertPoint: (laneId: string, time: number, value: number) => void;
  onRemovePoint: (laneId: string, pointIndex: number) => void;
  onRemoveLane: (laneId: string) => void;
}

function AutomationLaneEditor({
  lane,
  track,
  zoom,
  contentWidth,
  currentTime,
  onUpdatePoint,
  onUpsertPoint,
  onRemovePoint,
  onRemoveLane,
}: AutomationLaneEditorProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const range = getAutomationRange(lane.target, track);

  const pointToX = (time: number) => Math.max(0, time * zoom);
  const pointToY = (value: number) => {
    const norm = (value - range.min) / Math.max(0.0001, range.max - range.min);
    return (1 - Math.max(0, Math.min(1, norm))) * (AUTOMATION_LANE_H - 8) + 4;
  };

  const xToTime = (x: number) => Math.max(0, x / zoom);
  const yToValue = (y: number) => {
    const clampedY = Math.max(4, Math.min(AUTOMATION_LANE_H - 4, y));
    const norm = 1 - ((clampedY - 4) / Math.max(1, AUTOMATION_LANE_H - 8));
    return range.min + norm * (range.max - range.min);
  };

  useEffect(() => {
    if (dragIndex == null) return;
    const onMove = (event: MouseEvent) => {
      if (!laneRef.current) return;
      const rect = laneRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      onUpdatePoint(lane.id, dragIndex, xToTime(x), yToValue(y));
    };
    const onUp = () => setDragIndex(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragIndex, lane.id, onUpdatePoint, zoom, range.min, range.max]);

  const polylinePoints = lane.points
    .map((point) => `${pointToX(point.time)},${pointToY(point.value)}`)
    .join(' ');

  let fallbackValue = range.min;
  if (lane.target.kind === 'trackVolume') {
    fallbackValue = track.volume;
  } else if (lane.target.kind === 'trackPan') {
    fallbackValue = track.pan;
  } else {
    const target = lane.target;
    fallbackValue = track.plugins.find((plugin) => plugin.id === target.pluginId)
      ?.parameters[target.parameterId] ?? range.min;
  }

  const currentValue = evaluateAutomationValue(lane, currentTime, fallbackValue);

  const onLaneMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !laneRef.current) return;
    const rect = laneRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const hitIndex = lane.points.findIndex((point) => {
      const dx = pointToX(point.time) - x;
      const dy = pointToY(point.value) - y;
      return Math.hypot(dx, dy) <= POINT_HIT_RADIUS;
    });

    if (hitIndex >= 0) {
      setDragIndex(hitIndex);
      return;
    }

    onUpsertPoint(lane.id, xToTime(x), yToValue(y));
  };

  return (
    <div className="automation-lane-wrap">
      <div className="automation-lane-head">
        <span>{automationTargetLabel(lane.target, track)}</span>
        <span className="automation-lane-value">{currentValue.toFixed(2)}</span>
        <button
          className="trk-btn-sm automation-remove-btn"
          title="Remove automation lane"
          onClick={() => onRemoveLane(lane.id)}
        >✕</button>
      </div>
      <div
        className="automation-lane"
        ref={laneRef}
        onMouseDown={onLaneMouseDown}
      >
        <svg width={contentWidth} height={AUTOMATION_LANE_H}>
          <line
            x1={0}
            y1={pointToY(range.min + (range.max - range.min) / 2)}
            x2={contentWidth}
            y2={pointToY(range.min + (range.max - range.min) / 2)}
            className="automation-midline"
          />
          {lane.points.length > 1 && (
            <polyline points={polylinePoints} className="automation-polyline" />
          )}
          {lane.points.map((point, index) => (
            <circle
              key={`${point.time}_${point.value}_${index}`}
              cx={pointToX(point.time)}
              cy={pointToY(point.value)}
              r={4.5}
              className="automation-point"
              onContextMenu={(event) => {
                event.preventDefault();
                onRemovePoint(lane.id, index);
              }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

export interface TrackRowProps {
  track: Track;
  zoom: number;
  scrollLeft: number;
  currentTime: number;
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
  /** MIDI tracks only: create a blank MIDI clip at the given timeline time (seconds). */
  onCreateMidiClip?: (startTime: number, trackId?: string) => void;
  /** MIDI tracks only: trigger the file picker to import a .mid file onto this track. */
  onImportMidi?: () => void;
}

export const TrackRow = memo(function TrackRow({
  track,
  zoom,
  scrollLeft,
  currentTime,
  isRecording,
  selected,
  bpm,
  snapEnabled,
  selectedClipIds,
  selectedCount,
  onTrackHeaderClick,
  onTrackHeaderContextMenu,
  onDeleteTrack,
  onMoveTrack,
  canMoveUp,
  canMoveDown,
  onSelectClip,
  onClearClipSelection,
  onClipMove,
  onClipResize,
  onClipDelete,
  onClipSplit,
  onSetTime,
  contentWidth,
  analyser,
  onCreateMidiClip,
  onImportMidi,
}: TrackRowProps) {
  const { dispatch } = useDAW();
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (isRecording && track.armed) {
      const interval = setInterval(() => setFlash((f) => !f), RECORD_FLASH_MS);
      return () => clearInterval(interval);
    }
    setFlash(false);
  }, [isRecording, track.armed]);

  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    onClearClipSelection();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    onSetTime(x / zoom);
  }, [onClearClipSelection, onSetTime, scrollLeft, zoom]);

  const handleContentDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onCreateMidiClip) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    onCreateMidiClip(x / zoom, track.id);
  }, [onCreateMidiClip, scrollLeft, zoom, track.id]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(track.name);

  const commitName = useCallback(() => {
    dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { name: nameInput } } });
    setIsEditingName(false);
  }, [dispatch, track.id, nameInput]);

  const isRecordingOnThis = isRecording && track.armed;
  const beatWidth = Math.max(20, zoom * (60 / bpm));

  const automationOptions = useMemo<LaneOption[]>(() => {
    const pluginLaneOptions = track.plugins.flatMap((plugin) => (
      Object.keys(plugin.parameters).map((parameterId) => ({
        key: `plugin:${plugin.id}:${parameterId}`,
        label: `${plugin.name}: ${formatParameterLabel(parameterId)}`,
        target: { kind: 'pluginParam' as const, pluginId: plugin.id, parameterId },
      }))
    ));
    return [
      { key: 'track:volume', label: 'Track Volume', target: { kind: 'trackVolume' as const } },
      { key: 'track:pan', label: 'Track Pan', target: { kind: 'trackPan' as const } },
      ...pluginLaneOptions,
    ];
  }, [track.plugins]);

  const existingLaneTargets = useMemo(() => (
    new Set(track.automationLanes.map((lane) => automationTargetKey(lane.target)))
  ), [track.automationLanes]);

  const addableAutomationOptions = useMemo(() => (
    automationOptions.filter((option) => !existingLaneTargets.has(automationTargetKey(option.target)))
  ), [automationOptions, existingLaneTargets]);

  const [selectedAutomationKey, setSelectedAutomationKey] = useState<string>(addableAutomationOptions[0]?.key ?? 'track:volume');

  useEffect(() => {
    if (!addableAutomationOptions.length) return;
    if (addableAutomationOptions.some((option) => option.key === selectedAutomationKey)) return;
    setSelectedAutomationKey(addableAutomationOptions[0].key);
  }, [addableAutomationOptions, selectedAutomationKey]);

  const selectedAutomationOption = addableAutomationOptions.find((option) => option.key === selectedAutomationKey) ?? null;

  const addAutomationLane = useCallback(() => {
    if (!selectedAutomationOption) return;
    dispatch({
      type: 'ADD_AUTOMATION_LANE',
      payload: {
        trackId: track.id,
        target: selectedAutomationOption.target,
      },
    });
  }, [dispatch, track.id, selectedAutomationOption]);

  const upsertAutomationPoint = useCallback((laneId: string, time: number, value: number) => {
    dispatch({
      type: 'UPSERT_AUTOMATION_POINT',
      payload: { trackId: track.id, laneId, time, value },
    });
  }, [dispatch, track.id]);

  const updateAutomationPoint = useCallback((laneId: string, pointIndex: number, time: number, value: number) => {
    dispatch({
      type: 'UPDATE_AUTOMATION_POINT',
      payload: { trackId: track.id, laneId, pointIndex, time, value },
    });
  }, [dispatch, track.id]);

  const removeAutomationPoint = useCallback((laneId: string, pointIndex: number) => {
    dispatch({
      type: 'REMOVE_AUTOMATION_POINT',
      payload: { trackId: track.id, laneId, pointIndex },
    });
  }, [dispatch, track.id]);

  const removeAutomationLane = useCallback((laneId: string) => {
    dispatch({
      type: 'REMOVE_AUTOMATION_LANE',
      payload: { trackId: track.id, laneId },
    });
  }, [dispatch, track.id]);

  // Stable per-track clip callbacks — track.id is a fixed string for the lifetime of
  // this row, so these only change when the parent's stable handlers change.
  // This allows memo(ClipBlock) to skip re-renders on unrelated state changes
  // (playhead position updates, recording flash, automation changes, etc.).
  const handleClipSelect = useCallback(
    (clipId: string, additive: boolean) => onSelectClip(track.id, clipId, additive),
    [onSelectClip, track.id],
  );
  const handleClipMove = useCallback(
    (clipId: string, newStart: number) => onClipMove(track.id, clipId, newStart),
    [onClipMove, track.id],
  );
  const handleClipResize = useCallback(
    (clipId: string, updates: Partial<AudioClip>) => onClipResize(track.id, clipId, updates),
    [onClipResize, track.id],
  );
  const handleClipDelete = useCallback(
    (clipId: string) => onClipDelete(track.id, clipId),
    [onClipDelete, track.id],
  );
  const handleClipSplit = useMemo(
    () => onClipSplit ? (clipId: string) => onClipSplit(track.id, clipId) : undefined,
    [onClipSplit, track.id],
  );

  const handleClipPitch = useCallback(
    (clipId: string, semitones: number) => {
      dispatch({
        type: 'UPDATE_CLIP',
        payload: { trackId: track.id, clipId, updates: { pitchSemitones: semitones } },
      });
    },
    [dispatch, track.id],
  );

  const automationHeight = track.automationLaneExpanded
    ? AUTOMATION_TOOLBAR_H + Math.max(1, track.automationLanes.length) * AUTOMATION_LANE_H
    : 0;
  const rowHeight = Math.max(MIN_TRACK_H, track.height) + automationHeight;

  return (
    <div
      className="track-row"
      style={{ height: rowHeight, borderLeft: `3px solid ${track.color}` }}
    >
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
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
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
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'ARM_TRACK', payload: { id: track.id, armed: !track.armed } });
            }}
          >
            {track.armed ? '●' : '○'}
          </button>
          <button
            className={`trk-btn mute-btn ${track.muted ? 'muted' : ''}`}
            title="Mute"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'MUTE_TRACK', payload: { id: track.id, muted: !track.muted } });
            }}
          >M</button>
          <button
            className={`trk-btn solo-btn ${track.soloed ? 'soloed' : ''}`}
            title="Solo"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'SOLO_TRACK', payload: { id: track.id, soloed: !track.soloed } });
            }}
          >S</button>
          <button
            className={`trk-btn monitor-btn ${track.inputMonitor ? 'monitor-on' : ''}`}
            title="Input Monitor"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { inputMonitor: !track.inputMonitor } } });
            }}
          >I</button>
        </div>

        <div className="track-fader-row">
          <span className="fader-label">Vol</span>
          <input
            type="range"
            className="track-fader vol-fader"
            min={0}
            max={1}
            step={0.01}
            value={track.volume}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { volume: parseFloat(e.target.value) } } })}
          />
          <span className="fader-label">Pan</span>
          <input
            type="range"
            className="track-fader pan-fader"
            min={-1}
            max={1}
            step={0.01}
            value={track.pan}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { pan: parseFloat(e.target.value) } } })}
          />
        </div>

        <div className="track-actions-row">
          <button
            className="trk-btn-sm reorder-btn"
            title="Move track up"
            disabled={!canMoveUp}
            onClick={(e) => { e.stopPropagation(); onMoveTrack(track.id, -1); }}
          >↑</button>
          <button
            className="trk-btn-sm reorder-btn"
            title="Move track down"
            disabled={!canMoveDown}
            onClick={(e) => { e.stopPropagation(); onMoveTrack(track.id, 1); }}
          >↓</button>
          <button
            className="trk-btn-sm"
            title="Plugins"
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'SET_PLUGIN_RACK_TRACK', payload: track.id }); }}
          >FX {track.plugins.length > 0 ? `(${track.plugins.length})` : ''}</button>
          <button
            className={`trk-btn-sm ${track.automationLaneExpanded ? 'automation-toggle-active' : ''}`}
            title="Automation lanes"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'TOGGLE_TRACK_AUTOMATION_LANES', payload: { trackId: track.id } });
            }}
          >Auto</button>
          {onCreateMidiClip && (
            <button
              className="trk-btn-sm midi-new-clip-btn"
              title="New blank MIDI clip at playhead"
              onClick={(e) => { e.stopPropagation(); onCreateMidiClip(currentTime, track.id); }}
            >+ Clip</button>
          )}
          {onImportMidi && (
            <button
              className="trk-btn-sm midi-import-btn"
              title="Import .mid file onto this track"
              onClick={(e) => { e.stopPropagation(); onImportMidi(); }}
            >⤴ .mid</button>
          )}
          <button
            className="trk-btn-sm delete-btn"
            title="Delete Track"
            onClick={(e) => { e.stopPropagation(); onDeleteTrack(track.id); }}
          >✕</button>
        </div>
      </div>

      <div className="track-content" style={{ width: contentWidth }}>
        <div
          className="track-main-canvas"
          style={{
            cursor: track.type === 'midi' ? 'cell' : 'crosshair',
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
          onDoubleClick={handleContentDoubleClick}
        >
          {isRecordingOnThis && (
            analyser ? (
              <div className="live-waveform-container" style={{ opacity: flash ? 1 : 0.85 }}>
                <LiveWaveform
                  analyser={analyser}
                  color={track.color}
                  width={Math.max(400, contentWidth)}
                  height={Math.max(20, Math.max(MIN_TRACK_H, track.height) - 8)}
                />
              </div>
            ) : (
              <div className="recording-bar" style={{ opacity: flash ? 0.5 : 0.25 }} />
            )
          )}

          {track.clips.length === 0 && !isRecordingOnThis && (
            <div className="track-empty-hint">
              {track.type === 'midi'
                ? 'Double-click to create a MIDI clip · Use ⤴ .mid to import'
                : track.armed
                  ? '● Arm • Press ● Record to capture'
                  : 'Click to set playhead'}
            </div>
          )}

          {track.clips.map((clip) => (
            <ClipBlock
              key={clip.id}
              clip={clip}
              track={track}
              zoom={zoom}
              bpm={bpm}
              snapEnabled={snapEnabled}
              selected={selectedClipIds.has(clip.id)}
              selectedCount={selectedCount}
              onSelect={handleClipSelect}
              onMove={handleClipMove}
              onResize={handleClipResize}
              onDelete={handleClipDelete}
              onSplit={handleClipSplit}
              onPitchChange={handleClipPitch}
            />
          ))}

          {track.videoClips.map((clip) => {
            const visibleDur = Math.max(0.1, clip.duration - clip.trimIn - clip.trimOut);
            const visiblePeaks = getVisibleVideoPeaks(
              clip.audioWaveformPeaks ?? [],
              clip.trimIn,
              clip.trimOut,
              clip.duration,
            );
            return (
              <div
                key={clip.id}
                className="video-clip-block"
                style={{
                  left: clip.startTime * zoom,
                  width: Math.max(4, visibleDur * zoom),
                  background: track.color + '33',
                  borderLeft: `2px solid ${track.color}`,
                  opacity: clip.opacity,
                }}
              >
                <div className="video-clip-content">
                  <span className="clip-label" style={{ color: track.color }}>🎬 {clip.name}</span>
                  <WaveformCanvas
                    peaks={visiblePeaks}
                    color={track.color}
                    width={Math.max(8, visibleDur * zoom - 8)}
                    height={Math.max(14, Math.min(32, Math.max(MIN_TRACK_H, track.height) - 34))}
                    gain={clip.volume}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {track.automationLaneExpanded && (
          <div className="track-automation-panel">
            <div className="track-automation-toolbar">
              <select
                className="track-automation-select"
                value={selectedAutomationKey}
                onChange={(event) => setSelectedAutomationKey(event.target.value)}
                onClick={(event) => event.stopPropagation()}
              >
                {addableAutomationOptions.length === 0 && <option value="">All automation lanes added</option>}
                {addableAutomationOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
              <button
                className="trk-btn-sm"
                disabled={!selectedAutomationOption}
                onClick={addAutomationLane}
              >+ Lane</button>
              <span className="track-automation-hint">Click lane to add point. Drag points. Right-click point to remove.</span>
            </div>
            {track.automationLanes.length === 0 ? (
              <div className="track-automation-empty">No automation lanes on this track.</div>
            ) : (
              track.automationLanes.map((lane) => (
                <AutomationLaneEditor
                  key={lane.id}
                  lane={lane}
                  track={track}
                  zoom={zoom}
                  contentWidth={contentWidth}
                  currentTime={currentTime}
                  onUpdatePoint={updateAutomationPoint}
                  onUpsertPoint={upsertAutomationPoint}
                  onRemovePoint={removeAutomationPoint}
                  onRemoveLane={removeAutomationLane}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
});
