import { useRef, useState, useCallback, useEffect } from 'react';
import { useDAW } from '../context/DAWContext';
import type { VideoClip, VideoTextOverlay } from '../types/daw';
import { computePeaksAsync, readFileAsArrayBuffer } from '../lib/audioUtils';
import WaveformCanvas from './WaveformCanvas';

const SCRUB_FPS = 30;
const FRAME_SECONDS = 1 / SCRUB_FPS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getVisibleVideoPeaks(clip: VideoClip): number[] {
  const peaks = clip.audioWaveformPeaks ?? [];
  if (peaks.length === 0) return peaks;
  const safeDuration = Math.max(0.001, clip.duration);
  const startRatio = clamp(clip.trimIn / safeDuration, 0, 1);
  const endRatio = clamp((clip.duration - clip.trimOut) / safeDuration, startRatio, 1);
  const peakStart = Math.floor(startRatio * peaks.length);
  const peakEnd = Math.max(peakStart + 1, Math.ceil(endRatio * peaks.length));
  return peaks.slice(peakStart, peakEnd);
}

async function extractVideoAudioPeaks(file: File, numPoints = 240): Promise<number[]> {
  if (typeof window === 'undefined') return [];
  const AudioContextCtor = window.AudioContext || (window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;
  if (!AudioContextCtor) return [];
  const ctx = new AudioContextCtor();
  try {
    const data = await readFileAsArrayBuffer(file);
    const decoded = await ctx.decodeAudioData(data.slice(0));
    return await computePeaksAsync(decoded, numPoints);
  } catch {
    return [];
  } finally {
    try {
      await ctx.close();
    } catch {
      // no-op
    }
  }
}

// ─── VidClipBlock ─────────────────────────────────────────────────────────────

type VidDragMode = 'move' | 'trim-in' | 'trim-out';

interface VidClipBlockProps {
  clip: VideoClip;
  trackColor: string;
  zoom: number;
  scrollLeft: number;
  selected: boolean;
  onSelect: () => void;
  onMoveClip: (startTime: number) => void;
  onUpdateClip: (updates: Partial<VideoClip>) => void;
}

function VidClipBlock({ clip, trackColor, zoom, scrollLeft, selected, onSelect, onMoveClip, onUpdateClip }: VidClipBlockProps) {
  const [activeDrag, setActiveDrag] = useState<VidDragMode | null>(null);
  const dragRef = useRef<{
    startX: number;
    origTrimIn: number;
    origTrimOut: number;
    origStart: number;
    origDuration: number;
  } | null>(null);
  const callbacksRef = useRef({ onMoveClip, onUpdateClip });
  useEffect(() => { callbacksRef.current = { onMoveClip, onUpdateClip }; });

  const visibleDuration = Math.max(0.1, clip.duration - clip.trimIn - clip.trimOut);
  const widthPx = Math.max(20, visibleDuration * zoom);
  const visiblePeaks = getVisibleVideoPeaks(clip);

  const startDrag = (mode: VidDragMode, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    setActiveDrag(mode);
    dragRef.current = {
      startX: e.clientX,
      origTrimIn: clip.trimIn,
      origTrimOut: clip.trimOut,
      origStart: clip.startTime,
      origDuration: clip.duration,
    };
  };

  useEffect(() => {
    if (!activeDrag || !dragRef.current) return;
    const d = dragRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      const dxSec = (e.clientX - d.startX) / zoom;
      const { onMoveClip: move, onUpdateClip: update } = callbacksRef.current;
      if (activeDrag === 'move') {
        move(Math.max(0, d.origStart + dxSec));
      } else if (activeDrag === 'trim-in') {
        const newTrimIn = Math.max(0, Math.min(d.origTrimIn + dxSec, d.origDuration - d.origTrimOut - 0.1));
        const trimDelta = newTrimIn - d.origTrimIn;
        update({ trimIn: newTrimIn, startTime: Math.max(0, d.origStart + trimDelta) });
      } else {
        // trim-out: dragging left (negative dxSec) increases trimOut
        const newTrimOut = Math.max(0, Math.min(d.origTrimOut - dxSec, d.origDuration - d.origTrimIn - 0.1));
        update({ trimOut: newTrimOut });
      }
    };

    const handleMouseUp = () => setActiveDrag(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, zoom]);

  return (
    <div
      className={`vid-clip ${selected ? 'selected' : ''} ${activeDrag ? 'dragging' : ''}`}
      style={{
        left: clip.startTime * zoom - scrollLeft,
        width: widthPx,
        background: trackColor + '44',
        borderLeft: `2px solid ${trackColor}`,
        opacity: clip.opacity,
        cursor: activeDrag === 'move' ? 'grabbing' : 'grab',
      }}
      onMouseDown={(e) => startDrag('move', e)}
    >
      <div
        className="vid-trim-handle vid-trim-in"
        title="Drag to trim start"
        onMouseDown={(e) => startDrag('trim-in', e)}
      />
      <div className="vid-clip-body">
        <div className="vid-clip-meta">
          <span className="vid-clip-label">🎬 {clip.name}</span>
          <span className="vid-clip-dur">{visibleDuration.toFixed(1)}s</span>
        </div>
        <div className="vid-clip-waveform">
          <WaveformCanvas
            peaks={visiblePeaks}
            color={trackColor}
            width={Math.max(12, widthPx - 12)}
            height={14}
            gain={1}
          />
        </div>
      </div>
      <div
        className="vid-trim-handle vid-trim-out"
        title="Drag to trim end"
        onMouseDown={(e) => startDrag('trim-out', e)}
      />
    </div>
  );
}

// ─── Video Editor Panel ────────────────────────────────────────────────────────

function makeVideoClip(
  file: File,
  startTime: number,
  src: string,
  duration: number,
  audioWaveformPeaks: number[],
): VideoClip {
  return {
    id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: file.name.replace(/\.[^.]+$/, ''),
    startTime,
    duration,
    src,
    thumbnailUrl: '',
    color: '#ff9f0a',
    audioWaveformPeaks,
    trimIn: 0,
    trimOut: 0,
    opacity: 1,
    volume: 1,
    layoutX: 0.5,
    layoutY: 0.5,
    layoutScale: 1,
    textOverlays: [],
  };
}

function makeTextOverlay(startOffset: number, visibleDuration: number): VideoTextOverlay {
  const safeStart = clamp(startOffset, 0, Math.max(0, visibleDuration - 0.1));
  return {
    id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    text: 'New subtitle',
    startOffset: safeStart,
    endOffset: Math.min(visibleDuration, safeStart + 1.5),
    x: 0.5,
    y: 0.85,
    fontSize: 28,
    opacity: 1,
    bgOpacity: 0.55,
  };
}

export default function VideoEditor() {
  const { state, dispatch } = useDAW();
  const { tracks, zoom, scrollLeft, currentTime } = state;

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [pendingImports, setPendingImports] = useState<{ clip: VideoClip; trackId: string | null }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoLayerRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const videoTracks = tracks.filter(t => t.type === 'video');

  // Flush pending imports once a video track exists
  useEffect(() => {
    const targetTrackId = videoTracks[0]?.id;
    if (!targetTrackId || pendingImports.length === 0) return;
    pendingImports.forEach(({ clip }) => {
      dispatch({ type: 'ADD_VIDEO_CLIP', payload: { trackId: targetTrackId, clip } });
    });
    setPendingImports([]);
  }, [dispatch, pendingImports, videoTracks]);

  const handleFileImport = useCallback((files: FileList | null) => {
    if (!files) return;
    const targetTrackId = videoTracks[0]?.id ?? null;
    if (!targetTrackId) {
      dispatch({ type: 'ADD_TRACK', payload: 'video' });
    }
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('video/')) return;
      const src = URL.createObjectURL(file);
      const vidEl = document.createElement('video');
      vidEl.src = src;
      vidEl.onloadedmetadata = async () => {
        const audioWaveformPeaks = await extractVideoAudioPeaks(file);
        const clip = makeVideoClip(file, currentTime, src, vidEl.duration, audioWaveformPeaks);
        if (targetTrackId) {
          dispatch({ type: 'ADD_VIDEO_CLIP', payload: { trackId: targetTrackId, clip } });
        } else {
          setPendingImports((prev) => [...prev, { clip, trackId: null }]);
        }
      };
    });
  }, [currentTime, videoTracks, dispatch]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileImport(e.dataTransfer.files);
  }, [handleFileImport]);

  const allVideoClips = videoTracks.flatMap((t, trackIndex) =>
    t.videoClips.map(vc => ({ clip: vc, trackId: t.id, track: t, trackIndex }))
  );

  const selectedEntry = allVideoClips.find(x => x.clip.id === selectedClipId);
  const selectedClip = selectedEntry?.clip ?? null;
  const selectedVisibleDuration = selectedClip
    ? Math.max(0.1, selectedClip.duration - selectedClip.trimIn - selectedClip.trimOut)
    : 0;
  const selectedOverlay = selectedClip?.textOverlays?.find((overlay) => overlay.id === selectedOverlayId) ?? null;
  const playheadEntry = allVideoClips.find(({ clip }) => {
    const visibleDuration = Math.max(0.1, clip.duration - clip.trimIn - clip.trimOut);
    return currentTime >= clip.startTime && currentTime <= clip.startTime + visibleDuration;
  });
  const previewEntry = selectedEntry ?? playheadEntry ?? null;
  const previewClip = previewEntry?.clip ?? null;
  const activePreviewEntries = allVideoClips
    .filter(({ clip }) => {
      const visibleDuration = Math.max(0.1, clip.duration - clip.trimIn - clip.trimOut);
      return currentTime >= clip.startTime && currentTime <= clip.startTime + visibleDuration;
    })
    .sort((a, b) => {
      if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
      return a.clip.startTime - b.clip.startTime;
    });
  const previewEntries = activePreviewEntries.length > 0
    ? activePreviewEntries
    : (selectedEntry ? [selectedEntry] : (previewEntry ? [previewEntry] : []));
  const previewVisibleDuration = previewClip
    ? Math.max(0.1, previewClip.duration - previewClip.trimIn - previewClip.trimOut)
    : 0;
  const previewMinTime = previewClip?.trimIn ?? 0;
  const previewMaxTime = previewClip
    ? Math.max(previewClip.trimIn, previewClip.duration - previewClip.trimOut)
    : 0;
  const previewMediaTime = previewClip
    ? clamp(currentTime - previewClip.startTime + previewClip.trimIn, previewMinTime, previewMaxTime)
    : 0;
  const scrubSeconds = previewClip ? clamp(previewMediaTime - previewClip.trimIn, 0, previewVisibleDuration) : 0;

  useEffect(() => {
    previewEntries.forEach(({ clip }) => {
      const video = videoLayerRefs.current[clip.id];
      if (!video) return;
      const layerMinTime = clip.trimIn;
      const layerMaxTime = Math.max(clip.trimIn, clip.duration - clip.trimOut);
      const layerMediaTime = clamp(currentTime - clip.startTime + clip.trimIn, layerMinTime, layerMaxTime);
      if (Math.abs(video.currentTime - layerMediaTime) < FRAME_SECONDS / 2) return;
      try {
        video.currentTime = layerMediaTime;
      } catch {
        // Ignore seeking errors while metadata is loading.
      }
    });
  }, [currentTime, previewEntries]);

  useEffect(() => {
    const activeIds = new Set(previewEntries.map(({ clip }) => clip.id));
    Object.keys(videoLayerRefs.current).forEach((key) => {
      if (!activeIds.has(key)) {
        delete videoLayerRefs.current[key];
      }
    });
  }, [previewEntries]);

  const setVideoLayerRef = useCallback((clipId: string, node: HTMLVideoElement | null) => {
    if (node) {
      videoLayerRefs.current[clipId] = node;
    } else {
      delete videoLayerRefs.current[clipId];
    }
  }, []);

  const updateSelected = useCallback((updates: Partial<VideoClip>) => {
    if (!selectedEntry) return;
    dispatch({
      type: 'UPDATE_VIDEO_CLIP',
      payload: { trackId: selectedEntry.trackId, clipId: selectedEntry.clip.id, updates },
    });
  }, [dispatch, selectedEntry]);

  const addTextOverlay = useCallback(() => {
    if (!selectedEntry || !selectedClip) return;
    const visibleDuration = Math.max(0.1, selectedClip.duration - selectedClip.trimIn - selectedClip.trimOut);
    const overlayStart = clamp(currentTime - selectedClip.startTime, 0, visibleDuration);
    const overlay = makeTextOverlay(overlayStart, visibleDuration);
    dispatch({
      type: 'ADD_VIDEO_TEXT_OVERLAY',
      payload: { trackId: selectedEntry.trackId, clipId: selectedClip.id, overlay },
    });
    setSelectedOverlayId(overlay.id);
  }, [currentTime, dispatch, selectedClip, selectedEntry]);

  const updateSelectedOverlay = useCallback((updates: Partial<VideoTextOverlay>) => {
    if (!selectedEntry || !selectedClip || !selectedOverlayId) return;
    dispatch({
      type: 'UPDATE_VIDEO_TEXT_OVERLAY',
      payload: {
        trackId: selectedEntry.trackId,
        clipId: selectedClip.id,
        overlayId: selectedOverlayId,
        updates,
      },
    });
  }, [dispatch, selectedClip, selectedEntry, selectedOverlayId]);

  const removeSelectedOverlay = useCallback(() => {
    if (!selectedEntry || !selectedClip || !selectedOverlayId) return;
    dispatch({
      type: 'REMOVE_VIDEO_TEXT_OVERLAY',
      payload: {
        trackId: selectedEntry.trackId,
        clipId: selectedClip.id,
        overlayId: selectedOverlayId,
      },
    });
    setSelectedOverlayId(null);
  }, [dispatch, selectedClip, selectedEntry, selectedOverlayId]);

  useEffect(() => {
    if (!selectedClipId) {
      setSelectedOverlayId(null);
      return;
    }
    if (!selectedClip) {
      setSelectedOverlayId(null);
      return;
    }
    if (selectedOverlayId && selectedClip.textOverlays.some((overlay) => overlay.id === selectedOverlayId)) return;
    setSelectedOverlayId(selectedClip.textOverlays[0]?.id ?? null);
  }, [selectedClip, selectedClipId, selectedOverlayId]);

  const scrubSelectedClip = useCallback((secondsFromVisibleStart: number) => {
    if (!previewClip) return;
    const clamped = clamp(secondsFromVisibleStart, 0, previewVisibleDuration);
    dispatch({
      type: 'SET_CURRENT_TIME',
      payload: Math.max(0, previewClip.startTime + clamped),
    });
  }, [dispatch, previewClip, previewVisibleDuration]);

  const stepFrame = useCallback((frames: number) => {
    scrubSelectedClip(scrubSeconds + (frames * FRAME_SECONDS));
  }, [scrubSeconds, scrubSelectedClip]);

  return (
    <div className="video-editor">
      <div className="panel-header">
        <span className="panel-title">🎬 Video Editor</span>
        <span className="panel-subtitle">
          {videoTracks.length} video tracks • {allVideoClips.length} clips
        </span>
        <div className="video-header-actions">
          <button className="vid-import-btn" onClick={() => fileInputRef.current?.click()}>
            📁 Import Video
          </button>
          {videoTracks.length === 0 && (
            <button
              className="vid-import-btn"
              onClick={() => dispatch({ type: 'ADD_TRACK', payload: 'video' })}
            >+ Video Track</button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFileImport(e.target.files)}
        />
      </div>

      <div className="video-editor-body">
        {/* ── Left: Video preview + clip properties ── */}
        <div className="video-preview-col">
          <div
            className={`video-preview-area ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {previewEntries.length > 0 ? (
              <div className="video-preview-stack">
                {previewEntries.map(({ clip }, index) => (
                  <div
                    key={clip.id}
                    className="video-preview-layer-wrap"
                    style={{
                      left: `${clamp(clip.layoutX ?? 0.5, 0, 1) * 100}%`,
                      top: `${clamp(clip.layoutY ?? 0.5, 0, 1) * 100}%`,
                      transform: `translate(-50%, -50%) scale(${clamp(clip.layoutScale ?? 1, 0.2, 2)})`,
                      opacity: clamp(clip.opacity, 0, 1),
                      zIndex: index + 1,
                    }}
                  >
                    <video
                      ref={(node) => setVideoLayerRef(clip.id, node)}
                      src={clip.src}
                      className="video-preview-layer"
                      controls={clip.id === previewClip?.id}
                      muted
                    />
                    {clip.textOverlays
                      .filter((overlay) => {
                        const clipVisibleTime = clamp(currentTime - clip.startTime, 0, Math.max(0.1, clip.duration - clip.trimIn - clip.trimOut));
                        return clipVisibleTime >= overlay.startOffset && clipVisibleTime <= overlay.endOffset;
                      })
                      .map((overlay) => (
                        <div
                          key={overlay.id}
                          className="video-text-overlay"
                          style={{
                            left: `${clamp(overlay.x, 0, 1) * 100}%`,
                            top: `${clamp(overlay.y, 0, 1) * 100}%`,
                            fontSize: `${clamp(overlay.fontSize, 12, 72)}px`,
                            opacity: clamp(overlay.opacity, 0, 1),
                            backgroundColor: `rgba(0, 0, 0, ${clamp(overlay.bgOpacity, 0, 1)})`,
                          }}
                        >
                          {overlay.text}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="video-drop-hint">
                <div className="video-drop-icon">🎬</div>
                <div>Drop video files here</div>
                <div className="video-drop-sub">or click Import Video</div>
                <div className="video-drop-sub">Supports MP4, WebM, MOV, AVI</div>
              </div>
            )}
          </div>

          {previewClip && (
            <div className="video-scrub-controls">
              <div className="video-scrub-header">
                <span>Frame scrub ({SCRUB_FPS}fps)</span>
                <span>{previewMediaTime.toFixed(2)}s</span>
              </div>
              <div className="video-scrub-row">
                <button
                  className="vid-import-btn"
                  title="Step backward one frame"
                  onClick={() => stepFrame(-1)}
                >
                  ◀ Frame
                </button>
                <input
                  aria-label="Video frame scrub"
                  type="range"
                  min={0}
                  max={previewVisibleDuration}
                  step={FRAME_SECONDS}
                  value={scrubSeconds}
                  onChange={(e) => scrubSelectedClip(parseFloat(e.target.value))}
                  className="vid-prop-slider video-scrub-slider"
                />
                <button
                  className="vid-import-btn"
                  title="Step forward one frame"
                  onClick={() => stepFrame(1)}
                >
                  Frame ▶
                </button>
              </div>
            </div>
          )}

          {selectedClip && selectedEntry && (
            <div className="video-clip-props">
              <div className="vid-prop-label">Clip Properties — {selectedClip.name}</div>

              <div className="vid-prop-row">
                <span>Start</span>
                <span>{selectedClip.startTime.toFixed(2)}s</span>
              </div>
              <div className="vid-prop-row">
                <span>Source duration</span>
                <span>{selectedClip.duration.toFixed(2)}s</span>
              </div>
              <div className="vid-prop-row">
                <span>Visible duration</span>
                <span>
                  {Math.max(0, selectedClip.duration - selectedClip.trimIn - selectedClip.trimOut).toFixed(2)}s
                </span>
              </div>

              {/* Trim In */}
              <div className="vid-prop-row">
                <label htmlFor="vid-trim-in">Trim in</label>
                <input
                  id="vid-trim-in"
                  type="range"
                  min={0}
                  max={Math.max(0, selectedClip.duration - selectedClip.trimOut - 0.1)}
                  step={0.01}
                  value={selectedClip.trimIn}
                  onChange={e => updateSelected({ trimIn: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{selectedClip.trimIn.toFixed(2)}s</span>
              </div>

              {/* Trim Out */}
              <div className="vid-prop-row">
                <label htmlFor="vid-trim-out">Trim out</label>
                <input
                  id="vid-trim-out"
                  type="range"
                  min={0}
                  max={Math.max(0, selectedClip.duration - selectedClip.trimIn - 0.1)}
                  step={0.01}
                  value={selectedClip.trimOut}
                  onChange={e => updateSelected({ trimOut: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{selectedClip.trimOut.toFixed(2)}s</span>
              </div>

              {/* Opacity */}
              <div className="vid-prop-row">
                <label htmlFor="vid-opacity">Opacity</label>
                <input
                  id="vid-opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedClip.opacity}
                  onChange={e => updateSelected({ opacity: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{Math.round(selectedClip.opacity * 100)}%</span>
              </div>

              <div className="vid-prop-row">
                <label htmlFor="vid-layout-x">PiP X</label>
                <input
                  id="vid-layout-x"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedClip.layoutX ?? 0.5}
                  onChange={e => updateSelected({ layoutX: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{Math.round((selectedClip.layoutX ?? 0.5) * 100)}%</span>
              </div>

              <div className="vid-prop-row">
                <label htmlFor="vid-layout-y">PiP Y</label>
                <input
                  id="vid-layout-y"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedClip.layoutY ?? 0.5}
                  onChange={e => updateSelected({ layoutY: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{Math.round((selectedClip.layoutY ?? 0.5) * 100)}%</span>
              </div>

              <div className="vid-prop-row">
                <label htmlFor="vid-layout-scale">PiP scale</label>
                <input
                  id="vid-layout-scale"
                  type="range"
                  min={0.2}
                  max={2}
                  step={0.01}
                  value={selectedClip.layoutScale ?? 1}
                  onChange={e => updateSelected({ layoutScale: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{(selectedClip.layoutScale ?? 1).toFixed(2)}x</span>
              </div>

              {/* Audio volume */}
              <div className="vid-prop-row">
                <label htmlFor="vid-volume">Audio vol</label>
                <input
                  id="vid-volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedClip.volume}
                  onChange={e => updateSelected({ volume: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{Math.round(selectedClip.volume * 100)}%</span>
              </div>

              <div className="vid-prop-overlay-head">
                <span>Subtitle overlays ({selectedClip.textOverlays.length})</span>
                <button className="vid-split-btn" onClick={addTextOverlay}>+ Add at playhead</button>
              </div>
              {selectedClip.textOverlays.length > 0 ? (
                <>
                  <div className="vid-overlay-list">
                    {selectedClip.textOverlays.map((overlay, index) => (
                      <button
                        key={overlay.id}
                        className={`vid-overlay-pill ${selectedOverlayId === overlay.id ? 'active' : ''}`}
                        onClick={() => setSelectedOverlayId(overlay.id)}
                        title={overlay.text}
                      >
                        {index + 1}. {overlay.text || '(empty)'}
                      </button>
                    ))}
                  </div>

                  {selectedOverlay && (
                    <>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-text">Text</label>
                        <input
                          id="vid-overlay-text"
                          type="text"
                          value={selectedOverlay.text}
                          maxLength={240}
                          onChange={(e) => updateSelectedOverlay({ text: e.target.value })}
                          className="vid-text-input"
                        />
                      </div>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-start">Start</label>
                        <input
                          id="vid-overlay-start"
                          type="range"
                          min={0}
                          max={Math.max(0.1, selectedVisibleDuration - 0.1)}
                          step={0.01}
                          value={selectedOverlay.startOffset}
                          onChange={(e) => updateSelectedOverlay({ startOffset: parseFloat(e.target.value) })}
                          className="vid-prop-slider"
                        />
                        <span>{selectedOverlay.startOffset.toFixed(2)}s</span>
                      </div>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-end">End</label>
                        <input
                          id="vid-overlay-end"
                          type="range"
                          min={Math.min(selectedVisibleDuration, selectedOverlay.startOffset + 0.1)}
                          max={selectedVisibleDuration}
                          step={0.01}
                          value={selectedOverlay.endOffset}
                          onChange={(e) => updateSelectedOverlay({ endOffset: parseFloat(e.target.value) })}
                          className="vid-prop-slider"
                        />
                        <span>{selectedOverlay.endOffset.toFixed(2)}s</span>
                      </div>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-x">X</label>
                        <input
                          id="vid-overlay-x"
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedOverlay.x}
                          onChange={(e) => updateSelectedOverlay({ x: parseFloat(e.target.value) })}
                          className="vid-prop-slider"
                        />
                        <span>{Math.round(selectedOverlay.x * 100)}%</span>
                      </div>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-y">Y</label>
                        <input
                          id="vid-overlay-y"
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedOverlay.y}
                          onChange={(e) => updateSelectedOverlay({ y: parseFloat(e.target.value) })}
                          className="vid-prop-slider"
                        />
                        <span>{Math.round(selectedOverlay.y * 100)}%</span>
                      </div>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-size">Size</label>
                        <input
                          id="vid-overlay-size"
                          type="range"
                          min={12}
                          max={72}
                          step={1}
                          value={selectedOverlay.fontSize}
                          onChange={(e) => updateSelectedOverlay({ fontSize: parseFloat(e.target.value) })}
                          className="vid-prop-slider"
                        />
                        <span>{Math.round(selectedOverlay.fontSize)}px</span>
                      </div>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-opacity">Text opac</label>
                        <input
                          id="vid-overlay-opacity"
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedOverlay.opacity}
                          onChange={(e) => updateSelectedOverlay({ opacity: parseFloat(e.target.value) })}
                          className="vid-prop-slider"
                        />
                        <span>{Math.round(selectedOverlay.opacity * 100)}%</span>
                      </div>
                      <div className="vid-prop-row">
                        <label htmlFor="vid-overlay-bg-opacity">BG opac</label>
                        <input
                          id="vid-overlay-bg-opacity"
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedOverlay.bgOpacity}
                          onChange={(e) => updateSelectedOverlay({ bgOpacity: parseFloat(e.target.value) })}
                          className="vid-prop-slider"
                        />
                        <span>{Math.round(selectedOverlay.bgOpacity * 100)}%</span>
                      </div>
                      <div className="vid-prop-actions">
                        <button className="vid-remove-btn" onClick={removeSelectedOverlay}>
                          Remove subtitle
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="vid-overlay-empty">No subtitles yet. Add one at the playhead.</div>
              )}

              <div className="vid-prop-actions">
                <button
                  className="vid-split-btn"
                  onClick={() => updateSelected({ layoutX: 0.5, layoutY: 0.5, layoutScale: 1 })}
                >
                  Reset PiP
                </button>
                <button
                  className="vid-split-btn"
                  title="Split clip at playhead"
                  onClick={() => {
                    dispatch({
                      type: 'SPLIT_VIDEO_CLIP',
                      payload: {
                        trackId: selectedEntry.trackId,
                        clipId: selectedClip.id,
                        splitTime: currentTime,
                      },
                    });
                    setSelectedClipId(null);
                  }}
                >
                  ✂ Split at playhead
                </button>
                <button
                  className="vid-remove-btn"
                  onClick={() => {
                    dispatch({
                      type: 'REMOVE_VIDEO_CLIP',
                      payload: { trackId: selectedEntry.trackId, clipId: selectedClip.id },
                    });
                    setSelectedClipId(null);
                  }}
                >
                  🗑 Remove
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Video timeline strips ── */}
        <div className="video-timeline-col">
          <div className="vid-timeline-header">Video Timeline</div>

          {videoTracks.length === 0 ? (
            <div className="vid-empty">
              <p>No video tracks. Import a video or add a video track to get started.</p>
              <button
                className="vid-import-btn"
                onClick={() => fileInputRef.current?.click()}
              >📁 Import Video</button>
            </div>
          ) : (
            videoTracks.map(track => (
              <div key={track.id} className="vid-track-row">
                <div className="vid-track-header">
                  <div className="vid-track-name">{track.name}</div>
                </div>
                <div className="vid-track-content">
                  {track.videoClips.length === 0 ? (
                    <div className="vid-track-empty">Drop video here</div>
                  ) : (
                    track.videoClips.map(clip => (
                      <VidClipBlock
                        key={clip.id}
                        clip={clip}
                        trackColor={track.color}
                        zoom={zoom}
                        scrollLeft={scrollLeft}
                        selected={selectedClipId === clip.id}
                        onSelect={() => setSelectedClipId(clip.id)}
                        onMoveClip={(startTime) => dispatch({
                          type: 'MOVE_VIDEO_CLIP',
                          payload: { trackId: track.id, clipId: clip.id, startTime },
                        })}
                        onUpdateClip={(updates) => dispatch({
                          type: 'UPDATE_VIDEO_CLIP',
                          payload: { trackId: track.id, clipId: clip.id, updates },
                        })}
                      />
                    ))
                  )}
                </div>
              </div>
            ))
          )}

          <div className="vid-features-note">
            <span>🛠 Tip:</span> Use subtitle overlays for titles, lyrics, and scene captions.
          </div>
        </div>
      </div>
    </div>
  );
}
