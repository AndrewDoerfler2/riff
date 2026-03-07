import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useDAW, useAudioEngineCtx } from '../context/DAWContext';
import type { Track, AudioClip } from '../types/daw';
import { TimeRuler } from './timeline/TimeRuler';
import { TrackRow } from './timeline/TrackRow';
import MidiClipEditor from './MidiClipEditor';

// Re-export subcomponents for external consumers (e.g. tests)
export { TimeRuler } from './timeline/TimeRuler';
export { ClipBlock } from './timeline/ClipBlock';
export { TrackRow } from './timeline/TrackRow';

const HEADER_W = 222;

// Stable empty set so memoized TrackRow props don't break on tracks with no clips selected
const EMPTY_CLIP_SET = new Set<string>();

interface ImportStatus {
  kind: 'audio' | 'video';
  fileName: string;
  progress: number;
  stage: string;
}

interface ClipRef {
  trackId: string;
  clipId: string;
}

function clipKey(ref: ClipRef): string {
  return `${ref.trackId}::${ref.clipId}`;
}

// ─── Main Timeline ─────────────────────────────────────────────────────────────

export default function Timeline() {
  const { state, dispatch, createTrack } = useDAW();
  const { analyserNode, createClipFromFile } = useAudioEngineCtx();
  const {
    tracks,
    zoom,
    scrollLeft,
    currentTime,
    isPlaying,
    isRecording,
    bpm,
    timeSignature,
    snapEnabled,
    selectedTrackId,
    autoScroll,
    loopEnabled,
    loopStart,
    loopEnd,
  } = state;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const audioImportRef = useRef<HTMLInputElement>(null);
  const videoImportRef = useRef<HTMLInputElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [selectedClips, setSelectedClips] = useState<ClipRef[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [trackAnchorId, setTrackAnchorId] = useState<string | null>(null);

  // Pre-compute per-track selected clip id sets so TrackRow memo is not broken
  // by inline `new Set(...)` creation every render.
  const selectedClipIdsByTrack = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { trackId, clipId } of selectedClips) {
      let set = map.get(trackId);
      if (!set) { set = new Set(); map.set(trackId, set); }
      set.add(clipId);
    }
    return map;
  }, [selectedClips]);

  // Observe container width
  useEffect(() => {
    if (!timelineRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w - HEADER_W);
    });
    ro.observe(timelineRef.current);
    return () => ro.disconnect();
  }, []);

  // Scroll sync
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    dispatch({ type: 'SET_SCROLL_LEFT', payload: e.currentTarget.scrollLeft });
  }, [dispatch]);

  // Auto-scroll during playback and recording.
  // Behaviour: page-turn style — when the playhead reaches 80% of the visible
  // width, advance so it lands at 15% (leaving most of the view as look-ahead).
  // Also handles loop-back / jump-back: if the playhead is completely off-screen
  // to the left we snap so it appears at 15%.
  useEffect(() => {
    const active = isPlaying || isRecording;
    if (!active || !autoScroll) return;
    const playheadX = currentTime * zoom - scrollLeft;
    const LEAD_IN_FRAC = 0.15;
    const TRIGGER_FRAC = 0.80;
    if (playheadX < 0) {
      // Playhead jumped behind visible area (e.g. loop restart) — snap to it.
      dispatch({ type: 'SET_SCROLL_LEFT', payload: Math.max(0, currentTime * zoom - containerWidth * LEAD_IN_FRAC) });
    } else if (playheadX > containerWidth * TRIGGER_FRAC) {
      // Playhead approaching right edge — page-turn forward.
      dispatch({ type: 'SET_SCROLL_LEFT', payload: currentTime * zoom - containerWidth * LEAD_IN_FRAC });
    }
  }, [currentTime, isPlaying, isRecording, autoScroll, zoom, scrollLeft, containerWidth, dispatch]);

  // Playhead drag
  const startPlayheadDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingPlayhead(true);
    const onMouseMove = (me: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = me.clientX - rect.left - HEADER_W + scrollLeft;
      dispatch({ type: 'SET_CURRENT_TIME', payload: Math.max(0, x / zoom) });
    };
    const onMouseUp = () => {
      setIsDraggingPlayhead(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [zoom, scrollLeft, dispatch]);

  // Loop region drag — 'start', 'end', or 'body' (move whole region)
  const startLoopDrag = useCallback((e: React.MouseEvent, handle: 'start' | 'end' | 'body') => {
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const origStart = loopStart;
    const origEnd = loopEnd;
    const origDuration = origEnd - origStart;

    const onMouseMove = (me: MouseEvent) => {
      const dx = (me.clientX - startClientX) / zoom;
      if (handle === 'start') {
        const newStart = Math.max(0, Math.min(origStart + dx, origEnd - 0.1));
        dispatch({ type: 'SET_LOOP_RANGE', payload: { start: newStart, end: origEnd } });
      } else if (handle === 'end') {
        const newEnd = Math.max(origStart + 0.1, origEnd + dx);
        dispatch({ type: 'SET_LOOP_RANGE', payload: { start: origStart, end: newEnd } });
      } else {
        const newStart = Math.max(0, origStart + dx);
        dispatch({ type: 'SET_LOOP_RANGE', payload: { start: newStart, end: newStart + origDuration } });
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [zoom, loopStart, loopEnd, dispatch]);

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    dispatch({ type: 'SET_CURRENT_TIME', payload: Math.max(0, x / zoom) });
  }, [zoom, scrollLeft, dispatch]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      dispatch({ type: 'SET_ZOOM', payload: zoom * factor });
    }
  }, [zoom, dispatch]);

  const handleClipMove = useCallback((trackId: string, clipId: string, newStart: number) => {
    dispatch({
      type: 'UPDATE_TRACK',
      payload: {
        id: trackId,
        updates: {
          clips: tracks.find(t => t.id === trackId)!.clips.map(c =>
            c.id === clipId ? { ...c, startTime: newStart } : c
          ),
        },
      },
    });
  }, [tracks, dispatch]);

  const handleClipResize = useCallback((trackId: string, clipId: string, updates: Partial<AudioClip>) => {
    dispatch({
      type: 'UPDATE_TRACK',
      payload: {
        id: trackId,
        updates: {
          clips: tracks.find(t => t.id === trackId)!.clips.map(c =>
            c.id === clipId ? { ...c, ...updates } : c
          ),
        },
      },
    });
  }, [tracks, dispatch]);

  const deleteClipRefs = useCallback((refs: ClipRef[]) => {
    refs.forEach(({ trackId, clipId }) => {
      dispatch({ type: 'REMOVE_CLIP', payload: { trackId, clipId } });
    });
    setSelectedClips([]);
  }, [dispatch]);

  const selectAllClips = useCallback(() => {
    const all = tracks.flatMap(track => track.clips.map(clip => ({ trackId: track.id, clipId: clip.id })));
    setSelectedClips(all);
  }, [tracks]);

  const handleSelectClip = useCallback((trackId: string, clipId: string, additive: boolean) => {
    setSelectedClips(current => {
      const key = clipKey({ trackId, clipId });
      const exists = current.some(ref => clipKey(ref) === key);
      if (!additive) return [{ trackId, clipId }];
      if (exists) return current.filter(ref => clipKey(ref) !== key);
      return [...current, { trackId, clipId }];
    });
  }, []);

  const clearClipSelection = useCallback(() => setSelectedClips([]), []);

  const handleDeleteSelection = useCallback((source: ClipRef) => {
    const selectedKeys = new Set(selectedClips.map(clipKey));
    const sourceKey = clipKey(source);
    const targets = selectedKeys.has(sourceKey) ? selectedClips : [source];
    if (!targets.length) return;
    deleteClipRefs(targets);
  }, [deleteClipRefs, selectedClips]);

  useEffect(() => {
    const validKeys = new Set(tracks.flatMap(track => track.clips.map(clip => `${track.id}::${clip.id}`)));
    setSelectedClips(current => current.filter(ref => validKeys.has(clipKey(ref))));
  }, [tracks]);

  useEffect(() => {
    const validTrackIds = new Set(tracks.map(track => track.id));
    setSelectedTrackIds(current => current.filter(trackId => validTrackIds.has(trackId)));
    setTrackAnchorId(current => (current && validTrackIds.has(current) ? current : null));
  }, [tracks]);

  const handleClipDelete = useCallback((trackId: string, clipId: string) => {
    handleDeleteSelection({ trackId, clipId });
  }, [handleDeleteSelection]);

  // Split a single clip at the current playhead position.
  const handleSplitClip = useCallback((trackId: string, clipId: string) => {
    dispatch({ type: 'SPLIT_CLIP', payload: { trackId, clipId, splitTime: currentTime } });
  }, [dispatch, currentTime]);

  // S-key shortcut: split all selected clips at the playhead.
  const splitSelectedClips = useCallback(() => {
    if (!selectedClips.length) return;
    selectedClips.forEach(({ trackId, clipId }) => {
      dispatch({ type: 'SPLIT_CLIP', payload: { trackId, clipId, splitTime: currentTime } });
    });
    setSelectedClips([]);
  }, [dispatch, currentTime, selectedClips]);

  const deleteTracks = useCallback((trackIds: string[]) => {
    if (!trackIds.length) return;
    trackIds.forEach((trackId) => dispatch({ type: 'REMOVE_TRACK', payload: trackId }));
    setSelectedTrackIds([]);
    setTrackAnchorId(null);
    if (trackIds.includes(selectedTrackId ?? '')) {
      dispatch({ type: 'SELECT_TRACK', payload: null });
    }
  }, [dispatch, selectedTrackId]);

  const deleteTrackSelection = useCallback((sourceTrackId: string) => {
    const targets = selectedTrackIds.includes(sourceTrackId) ? selectedTrackIds : [sourceTrackId];
    if (!targets.length) return;
    deleteTracks(targets);
  }, [deleteTracks, selectedTrackIds]);

  const handleMoveTrack = useCallback((trackId: string, direction: -1 | 1) => {
    const fromIndex = tracks.findIndex((track) => track.id === trackId);
    if (fromIndex < 0) return;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= tracks.length) return;
    dispatch({ type: 'MOVE_TRACK', payload: { fromIndex, toIndex } });
  }, [dispatch, tracks]);

  const handleTrackHeaderClick = useCallback((trackId: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setSelectedClips([]);
    const additive = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;
    const orderedIds = tracks.map(track => track.id);
    const clickedIndex = orderedIds.indexOf(trackId);
    if (clickedIndex === -1) return;

    if (range && trackAnchorId) {
      const anchorIndex = orderedIds.indexOf(trackAnchorId);
      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, clickedIndex);
        const end = Math.max(anchorIndex, clickedIndex);
        setSelectedTrackIds(orderedIds.slice(start, end + 1));
      } else {
        setSelectedTrackIds([trackId]);
      }
    } else if (additive) {
      setSelectedTrackIds((current) => (
        current.includes(trackId)
          ? current.filter((id) => id !== trackId)
          : [...current, trackId]
      ));
      setTrackAnchorId(trackId);
    } else {
      setSelectedTrackIds([trackId]);
      setTrackAnchorId(trackId);
    }

    dispatch({ type: 'SELECT_TRACK', payload: trackId });
  }, [dispatch, trackAnchorId, tracks]);

  const handleTrackHeaderContextMenu = useCallback((trackId: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedClips([]);
    if (!selectedTrackIds.includes(trackId)) {
      setSelectedTrackIds([trackId]);
      setTrackAnchorId(trackId);
      dispatch({ type: 'SELECT_TRACK', payload: trackId });
    }
    deleteTrackSelection(trackId);
  }, [deleteTrackSelection, dispatch, selectedTrackIds]);

  const handleDeleteTrackButton = useCallback((trackId: string) => {
    deleteTrackSelection(trackId);
  }, [deleteTrackSelection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inTextInput = target != null && (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      );
      if (inTextInput) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAllClips();
        return;
      }

      if (event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey && selectedClips.length > 0) {
        event.preventDefault();
        splitSelectedClips();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClips.length > 0) {
        event.preventDefault();
        deleteClipRefs(selectedClips);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTrackIds.length > 0) {
        event.preventDefault();
        deleteTracks(selectedTrackIds);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteClipRefs, deleteTracks, selectAllClips, selectedClips, selectedTrackIds, splitSelectedClips]);

  const contentWidth = Math.max(containerWidth, state.viewDuration * zoom);
  const playheadLeft = currentTime * zoom - scrollLeft;

  // Loop region pixel coordinates (relative to visible ruler area)
  const loopStartPx = loopStart * zoom - scrollLeft;
  const loopEndPx = loopEnd * zoom - scrollLeft;
  const loopWidthPx = loopEndPx - loopStartPx;
  const selectedTrack = tracks.find(track => track.id === selectedTrackId) ?? null;
  const selectedMidiClip = useMemo(() => {
    if (selectedClips.length !== 1) return null;
    const selected = selectedClips[0];
    const track = tracks.find(t => t.id === selected.trackId);
    if (!track || track.type !== 'midi') return null;
    const clip = track.clips.find(c => c.id === selected.clipId);
    if (!clip || !(clip.midiNotes?.length)) return null;
    return { track, clip };
  }, [selectedClips, tracks]);

  const ensureAudioTrack = useCallback(() => {
    if (selectedTrack && selectedTrack.type === 'audio') return selectedTrack.id;
    const track = createTrack('audio');
    dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: track });
    dispatch({ type: 'SELECT_TRACK', payload: track.id });
    return track.id;
  }, [createTrack, dispatch, selectedTrack]);

  const importFileToTrack = useCallback(async (file: File, clipColor: string, kind: ImportStatus['kind']) => {
    const trackId = ensureAudioTrack();
    const clip = await createClipFromFile(file, {
      startTime: currentTime,
      color: clipColor,
      onProgress: (progress, stage) => {
        setImportStatus({ kind, fileName: file.name, progress, stage });
      },
    });
    dispatch({ type: 'ADD_CLIP', payload: { trackId, clip } });
    setImportStatus({ kind, fileName: file.name, progress: 100, stage: 'Complete' });
    window.setTimeout(() => {
      setImportStatus(current => (current?.fileName === file.name ? null : current));
    }, 800);
  }, [createClipFromFile, currentTime, dispatch, ensureAudioTrack]);

  const handleAudioImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await importFileToTrack(file, '#64d2ff', 'audio');
    } catch (err) {
      setImportStatus(null);
      console.error('Failed to import audio file:', err);
      alert('Unable to import that audio file.');
    }
  }, [importFileToTrack]);

  const handleVideoAudioImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await importFileToTrack(file, '#ff9f0a', 'video');
    } catch (err) {
      setImportStatus(null);
      console.error('Failed to extract audio from video:', err);
      alert('Unable to extract audio from that video file.');
    }
  }, [importFileToTrack]);

  const trackTypes: Array<{ type: Track['type']; label: string; icon: string }> = [
    { type: 'audio', label: 'Audio', icon: '🎙' },
    { type: 'midi',  label: 'MIDI',  icon: '🎹' },
    { type: 'video', label: 'Video', icon: '🎬' },
    { type: 'bus',   label: 'Bus',   icon: '🔀' },
  ];

  return (
    <div className="timeline" ref={timelineRef} onWheel={handleWheel}>

      {/* ── Ruler row ── */}
      <div className="ruler-row">
        <div className="ruler-corner">
          <span style={{ fontSize: 10, color: '#666' }}>
            {zoom.toFixed(0)}px/s
          </span>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="zoom-btn" onClick={() => dispatch({ type: 'SET_ZOOM', payload: zoom * 1.25 })}>+</button>
            <button className="zoom-btn" onClick={() => dispatch({ type: 'SET_ZOOM', payload: zoom * 0.8 })}>−</button>
          </div>
        </div>

        <div
          className="ruler-content"
          style={{ width: containerWidth, overflow: 'hidden', position: 'relative' }}
          onClick={handleRulerClick}
        >
          <TimeRuler zoom={zoom} scrollLeft={scrollLeft} bpm={bpm} timeSignature={timeSignature} width={containerWidth} />

          {/* Loop region band on the ruler */}
          {loopWidthPx > 0 && (
            <div
              className={`loop-region${loopEnabled ? ' loop-region--active' : ''}`}
              style={{ left: loopStartPx, width: Math.max(4, loopWidthPx) }}
              onMouseDown={e => startLoopDrag(e, 'body')}
            >
              <div
                className="loop-region-handle loop-region-handle--start"
                onMouseDown={e => startLoopDrag(e, 'start')}
              />
              <div
                className="loop-region-handle loop-region-handle--end"
                onMouseDown={e => startLoopDrag(e, 'end')}
              />
            </div>
          )}

          {playheadLeft >= 0 && playheadLeft <= containerWidth && (
            <div
              className="playhead-ruler-triangle"
              style={{ left: playheadLeft }}
              onMouseDown={startPlayheadDrag}
            >▼</div>
          )}
        </div>
      </div>

      {/* ── Track area ── */}
      <div className="tracks-area">
        <div
          ref={scrollContainerRef}
          className="tracks-scroll"
          onScroll={handleScroll}
          style={{ width: '100%' }}
        >
          <div className="tracks-canvas" style={{ width: HEADER_W + contentWidth, position: 'relative' }}>
            {/* Loop region column overlay spanning all tracks */}
            {loopWidthPx > 0 && (
              <div
                className={`loop-region-column${loopEnabled ? ' loop-region-column--active' : ''}`}
                style={{ left: HEADER_W + loopStartPx, width: Math.max(4, loopWidthPx) }}
              />
            )}
            {tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                zoom={zoom}
                scrollLeft={scrollLeft}
                currentTime={currentTime}
                isRecording={isRecording}
                selected={selectedTrackIds.includes(track.id)}
                bpm={bpm}
                snapEnabled={snapEnabled}
                selectedClipIds={selectedClipIdsByTrack.get(track.id) ?? EMPTY_CLIP_SET}
                selectedCount={selectedClips.length}
                onTrackHeaderClick={handleTrackHeaderClick}
                onTrackHeaderContextMenu={handleTrackHeaderContextMenu}
                onDeleteTrack={handleDeleteTrackButton}
                onMoveTrack={handleMoveTrack}
                canMoveUp={index > 0}
                canMoveDown={index < tracks.length - 1}
                onSelectClip={handleSelectClip}
                onClearClipSelection={clearClipSelection}
                onClipMove={handleClipMove}
                onClipResize={handleClipResize}
                onClipDelete={handleClipDelete}
                onClipSplit={handleSplitClip}
                onSetTime={t => dispatch({ type: 'SET_CURRENT_TIME', payload: t })}
                contentWidth={contentWidth}
                analyser={analyserNode}
              />
            ))}

            {playheadLeft >= 0 && (
              <div
                className={`playhead-line ${isDraggingPlayhead ? 'dragging' : ''}`}
                style={{ left: HEADER_W + playheadLeft }}
                onMouseDown={startPlayheadDrag}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Add Track Bar ── */}
      <div className="add-track-bar">
        <span style={{ color: '#666', fontSize: 11, marginRight: 8 }}>Add Track:</span>
        {trackTypes.map(({ type, label, icon }) => (
          <button
            key={type}
            className="add-track-btn"
            onClick={() => dispatch({ type: 'ADD_TRACK', payload: type })}
          >
            {icon} {label}
          </button>
        ))}
        <button
          className="add-track-btn import-track-btn"
          onClick={() => audioImportRef.current?.click()}
        >
          ⤴ Upload Audio
        </button>
        <button
          className="add-track-btn import-track-btn"
          onClick={() => videoImportRef.current?.click()}
        >
          🎞 Extract Audio
        </button>
        <input
          ref={audioImportRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={handleAudioImport}
        />
        <input
          ref={videoImportRef}
          type="file"
          accept="video/*"
          hidden
          onChange={handleVideoAudioImport}
        />
      </div>

      {importStatus && (
        <div className="upload-progress-bar">
          <div className="upload-progress-meta">
            <span>
              {importStatus.kind === 'audio' ? 'Uploading audio' : 'Extracting audio'}: {importStatus.fileName}
            </span>
            <span>{Math.round(importStatus.progress)}%</span>
          </div>
          <div className="upload-progress-track">
            <div
              className="upload-progress-fill"
              style={{ width: `${Math.max(4, Math.min(100, importStatus.progress))}%` }}
            />
          </div>
          <div className="upload-progress-stage">{importStatus.stage}</div>
        </div>
      )}

      {selectedMidiClip && (
        <MidiClipEditor
          track={selectedMidiClip.track}
          clip={selectedMidiClip.clip}
          bpm={bpm}
          onClose={clearClipSelection}
        />
      )}
    </div>
  );
}
