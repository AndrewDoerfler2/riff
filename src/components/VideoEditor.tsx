import { useRef, useState, useCallback, useEffect } from 'react';
import { useDAW } from '../context/DAWContext';
import type { VideoClip } from '../types/daw';

// ─── Video Editor Panel ────────────────────────────────────────────────────────

export default function VideoEditor() {
  const { state, dispatch } = useDAW();
  const { tracks, zoom, scrollLeft, currentTime } = state;

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [pendingImports, setPendingImports] = useState<VideoClip[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  const videoTracks = tracks.filter(t => t.type === 'video');

  useEffect(() => {
    const targetTrackId = videoTracks[0]?.id;
    if (!targetTrackId || pendingImports.length === 0) return;
    pendingImports.forEach((clip) => {
      dispatch({
        type: 'ADD_CLIP',
        payload: {
          trackId: targetTrackId,
          clip: { ...clip, audioBuffer: null, waveformPeaks: [], gain: 1, fadeIn: 0, fadeOut: 0, offset: 0 },
        },
      });
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
      const url = URL.createObjectURL(file);
      const vidEl = document.createElement('video');
      vidEl.src = url;
      vidEl.onloadedmetadata = () => {
        const duration = vidEl.duration;
        const clip: VideoClip = {
          id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          startTime: currentTime,
          duration,
          src: url,
          thumbnailUrl: '',
          color: '#ff9f0a',
        };

        if (targetTrackId) {
          dispatch({
            type: 'ADD_CLIP',
            payload: {
              trackId: targetTrackId,
              clip: { ...clip, audioBuffer: null, waveformPeaks: [], gain: 1, fadeIn: 0, fadeOut: 0, offset: 0 },
            },
          });
        } else {
          setPendingImports((prev) => [...prev, clip]);
        }
        setPreviewSrc(url);
      };
    });
  }, [currentTime, videoTracks, dispatch]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileImport(e.dataTransfer.files);
  }, [handleFileImport]);

  const allVideoClips = videoTracks.flatMap(t =>
    t.videoClips.map(vc => ({ clip: vc, trackId: t.id, track: t }))
  );

  const selectedClip = allVideoClips.find(x => x.clip.id === selectedClipId);

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
        {/* ── Left: Video preview ── */}
        <div className="video-preview-col">
          <div
            className={`video-preview-area ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {previewSrc ? (
              <video
                ref={videoPreviewRef}
                src={previewSrc}
                className="video-preview"
                controls
                onTimeUpdate={_e => {
                  // Sync video playback with DAW time (future feature)
                }}
              />
            ) : (
              <div className="video-drop-hint">
                <div className="video-drop-icon">🎬</div>
                <div>Drop video files here</div>
                <div className="video-drop-sub">or click Import Video</div>
                <div className="video-drop-sub">Supports MP4, WebM, MOV, AVI</div>
              </div>
            )}
          </div>

          {selectedClip && (
            <div className="video-clip-props">
              <div className="vid-prop-label">Clip Properties</div>
              <div className="vid-prop-row">
                <span>Name:</span>
                <span>{selectedClip.clip.name}</span>
              </div>
              <div className="vid-prop-row">
                <span>Start:</span>
                <span>{selectedClip.clip.startTime.toFixed(2)}s</span>
              </div>
              <div className="vid-prop-row">
                <span>Duration:</span>
                <span>{selectedClip.clip.duration.toFixed(2)}s</span>
              </div>
              <button
                className="vid-remove-btn"
                onClick={() => {
                  dispatch({ type: 'REMOVE_CLIP', payload: { trackId: selectedClip.trackId, clipId: selectedClip.clip.id } });
                  setSelectedClipId(null);
                }}
              >Remove Clip</button>
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
                      <div
                        key={clip.id}
                        className={`vid-clip ${selectedClipId === clip.id ? 'selected' : ''}`}
                        style={{
                          left: clip.startTime * zoom - scrollLeft,
                          width: Math.max(20, clip.duration * zoom),
                          background: track.color + '44',
                          borderLeft: `2px solid ${track.color}`,
                        }}
                        onClick={() => { setSelectedClipId(clip.id); setPreviewSrc(clip.src || null); }}
                      >
                        <span className="vid-clip-label">🎬 {clip.name}</span>
                        <span className="vid-clip-dur">{clip.duration.toFixed(1)}s</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))
          )}

          <div className="vid-features-note">
            <span>🛠 Coming in next iteration:</span> Trim handles, split/merge clips, opacity control,
            transitions, picture-in-picture, subtitle tracks, export to MP4.
          </div>
        </div>
      </div>
    </div>
  );
}
