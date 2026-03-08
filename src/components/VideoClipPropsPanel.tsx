import { useState, useCallback, useEffect } from 'react';
import { useDAW } from '../context/DAWContext';
import type { VideoClip, VideoTextOverlay } from '../types/daw';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function makeTextOverlay(startOffset: number, visibleDuration: number): VideoTextOverlay {
  const safeDuration = Math.max(0.1, visibleDuration);
  const safeStart = clamp(startOffset, 0, Math.max(0, safeDuration - 0.1));
  const defaultEnd = Math.min(safeDuration, safeStart + Math.max(1, safeDuration * 0.2));
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    text: '',
    startOffset: safeStart,
    endOffset: defaultEnd,
    x: 0.5,
    y: 0.85,
    fontSize: 28,
    opacity: 1,
    bgOpacity: 0.55,
  };
}

interface VideoClipPropsPanelProps {
  clip: VideoClip;
  trackId: string;
  /** `clip.duration - clip.trimIn - clip.trimOut`, pre-computed by parent */
  visibleDuration: number;
  currentTime: number;
  /** Called after the user removes or splits the clip so the parent can clear selection */
  onDeselect: () => void;
}

export default function VideoClipPropsPanel({
  clip,
  trackId,
  visibleDuration,
  currentTime,
  onDeselect,
}: VideoClipPropsPanelProps) {
  const { dispatch } = useDAW();
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  // Auto-select first overlay when clip changes; clear if overlay was deleted.
  useEffect(() => {
    if (!clip) {
      setSelectedOverlayId(null);
      return;
    }
    if (selectedOverlayId && clip.textOverlays.some((o) => o.id === selectedOverlayId)) return;
    setSelectedOverlayId(clip.textOverlays[0]?.id ?? null);
  }, [clip, selectedOverlayId]);

  const selectedOverlay = clip.textOverlays.find((o) => o.id === selectedOverlayId) ?? null;

  const updateClip = useCallback((updates: Partial<VideoClip>) => {
    dispatch({ type: 'UPDATE_VIDEO_CLIP', payload: { trackId, clipId: clip.id, updates } });
  }, [dispatch, trackId, clip.id]);

  const addTextOverlay = useCallback(() => {
    const overlayStart = clamp(currentTime - clip.startTime, 0, visibleDuration);
    const overlay = makeTextOverlay(overlayStart, visibleDuration);
    dispatch({ type: 'ADD_VIDEO_TEXT_OVERLAY', payload: { trackId, clipId: clip.id, overlay } });
    setSelectedOverlayId(overlay.id);
  }, [currentTime, dispatch, clip.id, clip.startTime, trackId, visibleDuration]);

  const updateOverlay = useCallback((updates: Partial<VideoTextOverlay>) => {
    if (!selectedOverlayId) return;
    dispatch({
      type: 'UPDATE_VIDEO_TEXT_OVERLAY',
      payload: { trackId, clipId: clip.id, overlayId: selectedOverlayId, updates },
    });
  }, [dispatch, trackId, clip.id, selectedOverlayId]);

  const removeOverlay = useCallback(() => {
    if (!selectedOverlayId) return;
    dispatch({
      type: 'REMOVE_VIDEO_TEXT_OVERLAY',
      payload: { trackId, clipId: clip.id, overlayId: selectedOverlayId },
    });
    setSelectedOverlayId(null);
  }, [dispatch, trackId, clip.id, selectedOverlayId]);

  return (
    <div className="video-clip-props">
      <div className="vid-prop-label">Clip Properties — {clip.name}</div>

      <div className="vid-prop-row">
        <span>Start</span>
        <span>{clip.startTime.toFixed(2)}s</span>
      </div>
      <div className="vid-prop-row">
        <span>Source duration</span>
        <span>{clip.duration.toFixed(2)}s</span>
      </div>
      <div className="vid-prop-row">
        <span>Visible duration</span>
        <span>{Math.max(0, visibleDuration).toFixed(2)}s</span>
      </div>

      <div className="vid-prop-row">
        <label htmlFor="vid-trim-in">Trim in</label>
        <input
          id="vid-trim-in"
          type="range"
          min={0}
          max={Math.max(0, clip.duration - clip.trimOut - 0.1)}
          step={0.01}
          value={clip.trimIn}
          onChange={(e) => updateClip({ trimIn: parseFloat(e.target.value) })}
          className="vid-prop-slider"
        />
        <span>{clip.trimIn.toFixed(2)}s</span>
      </div>

      <div className="vid-prop-row">
        <label htmlFor="vid-trim-out">Trim out</label>
        <input
          id="vid-trim-out"
          type="range"
          min={0}
          max={Math.max(0, clip.duration - clip.trimIn - 0.1)}
          step={0.01}
          value={clip.trimOut}
          onChange={(e) => updateClip({ trimOut: parseFloat(e.target.value) })}
          className="vid-prop-slider"
        />
        <span>{clip.trimOut.toFixed(2)}s</span>
      </div>

      <div className="vid-prop-row">
        <label htmlFor="vid-opacity">Opacity</label>
        <input
          id="vid-opacity"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clip.opacity}
          onChange={(e) => updateClip({ opacity: parseFloat(e.target.value) })}
          className="vid-prop-slider"
        />
        <span>{Math.round(clip.opacity * 100)}%</span>
      </div>

      <div className="vid-prop-row">
        <label htmlFor="vid-layout-x">PiP X</label>
        <input
          id="vid-layout-x"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clip.layoutX ?? 0.5}
          onChange={(e) => updateClip({ layoutX: parseFloat(e.target.value) })}
          className="vid-prop-slider"
        />
        <span>{Math.round((clip.layoutX ?? 0.5) * 100)}%</span>
      </div>

      <div className="vid-prop-row">
        <label htmlFor="vid-layout-y">PiP Y</label>
        <input
          id="vid-layout-y"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clip.layoutY ?? 0.5}
          onChange={(e) => updateClip({ layoutY: parseFloat(e.target.value) })}
          className="vid-prop-slider"
        />
        <span>{Math.round((clip.layoutY ?? 0.5) * 100)}%</span>
      </div>

      <div className="vid-prop-row">
        <label htmlFor="vid-layout-scale">PiP scale</label>
        <input
          id="vid-layout-scale"
          type="range"
          min={0.2}
          max={2}
          step={0.01}
          value={clip.layoutScale ?? 1}
          onChange={(e) => updateClip({ layoutScale: parseFloat(e.target.value) })}
          className="vid-prop-slider"
        />
        <span>{(clip.layoutScale ?? 1).toFixed(2)}x</span>
      </div>

      <div className="vid-prop-row">
        <label htmlFor="vid-volume">Audio vol</label>
        <input
          id="vid-volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clip.volume}
          onChange={(e) => updateClip({ volume: parseFloat(e.target.value) })}
          className="vid-prop-slider"
        />
        <span>{Math.round(clip.volume * 100)}%</span>
      </div>

      {/* Subtitle overlays */}
      <div className="vid-prop-overlay-head">
        <span>Subtitle overlays ({clip.textOverlays.length})</span>
        <button className="vid-split-btn" onClick={addTextOverlay}>+ Add at playhead</button>
      </div>
      {clip.textOverlays.length > 0 ? (
        <>
          <div className="vid-overlay-list">
            {clip.textOverlays.map((overlay, index) => (
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
                  onChange={(e) => updateOverlay({ text: e.target.value })}
                  className="vid-text-input"
                />
              </div>
              <div className="vid-prop-row">
                <label htmlFor="vid-overlay-start">Start</label>
                <input
                  id="vid-overlay-start"
                  type="range"
                  min={0}
                  max={Math.max(0.1, visibleDuration - 0.1)}
                  step={0.01}
                  value={selectedOverlay.startOffset}
                  onChange={(e) => updateOverlay({ startOffset: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{selectedOverlay.startOffset.toFixed(2)}s</span>
              </div>
              <div className="vid-prop-row">
                <label htmlFor="vid-overlay-end">End</label>
                <input
                  id="vid-overlay-end"
                  type="range"
                  min={Math.min(visibleDuration, selectedOverlay.startOffset + 0.1)}
                  max={visibleDuration}
                  step={0.01}
                  value={selectedOverlay.endOffset}
                  onChange={(e) => updateOverlay({ endOffset: parseFloat(e.target.value) })}
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
                  onChange={(e) => updateOverlay({ x: parseFloat(e.target.value) })}
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
                  onChange={(e) => updateOverlay({ y: parseFloat(e.target.value) })}
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
                  onChange={(e) => updateOverlay({ fontSize: parseFloat(e.target.value) })}
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
                  onChange={(e) => updateOverlay({ opacity: parseFloat(e.target.value) })}
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
                  onChange={(e) => updateOverlay({ bgOpacity: parseFloat(e.target.value) })}
                  className="vid-prop-slider"
                />
                <span>{Math.round(selectedOverlay.bgOpacity * 100)}%</span>
              </div>
              <div className="vid-prop-actions">
                <button className="vid-remove-btn" onClick={removeOverlay}>
                  Remove subtitle
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="vid-overlay-empty">No subtitles yet. Add one at the playhead.</div>
      )}

      {/* Clip-level actions */}
      <div className="vid-prop-actions">
        <button
          className="vid-split-btn"
          onClick={() => updateClip({ layoutX: 0.5, layoutY: 0.5, layoutScale: 1 })}
        >
          Reset PiP
        </button>
        <button
          className="vid-split-btn"
          title="Split clip at playhead"
          onClick={() => {
            dispatch({
              type: 'SPLIT_VIDEO_CLIP',
              payload: { trackId, clipId: clip.id, splitTime: currentTime },
            });
            onDeselect();
          }}
        >
          ✂ Split at playhead
        </button>
        <button
          className="vid-remove-btn"
          onClick={() => {
            dispatch({ type: 'REMOVE_VIDEO_CLIP', payload: { trackId, clipId: clip.id } });
            onDeselect();
          }}
        >
          🗑 Remove
        </button>
      </div>
    </div>
  );
}
