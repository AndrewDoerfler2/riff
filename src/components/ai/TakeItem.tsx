import { memo } from 'react';
import { instrumentColor } from '../../lib/backingTrackRenderer';
import { formatRelativeTime, type AIGeneration, type AIGenerationTrack } from '../aiPanelUtils';
import type { Instrument } from '../../types/daw';

interface TakeItemProps {
  gen: AIGeneration;
  isPreviewing: boolean;
  regeneratingTrackId: string | null;
  isGenerating: boolean;
  onPreview: (gen: AIGeneration) => void;
  onStopPreview: () => void;
  onUse: (gen: AIGeneration) => void;
  onUseAsMidi: (gen: AIGeneration) => void;
  onUseTrackAsMidi: (gen: AIGeneration, track: AIGenerationTrack) => void;
  onDelete: (id: string) => void;
  onRegenerateTrack: (genId: string, instrument: Instrument) => void;
}

const TakeItem = memo(function TakeItem({
  gen,
  isPreviewing,
  regeneratingTrackId,
  isGenerating,
  onPreview,
  onStopPreview,
  onUse,
  onUseAsMidi,
  onUseTrackAsMidi,
  onDelete,
  onRegenerateTrack,
}: TakeItemProps) {
  return (
    <div className={`ai-take-item${isPreviewing ? ' previewing' : ''}`}>
      <div className="ai-take-meta">
        <span className="ai-take-label">Take {gen.takeNumber}</span>
        <span className="ai-take-info">
          {gen.genre} · {gen.key} · {gen.bpm} bpm · {gen.timeSignature} · {gen.bars} bars
        </span>
        <span className="ai-take-age">{formatRelativeTime(gen.createdAt)}</span>
      </div>

      <div className="ai-take-instrument-dots">
        {gen.tracks.map(t => (
          <span
            key={t.instrument}
            className="ai-take-dot"
            style={{ background: instrumentColor(t.instrument) }}
            title={t.label}
          />
        ))}
      </div>

      <div className="ai-take-controls">
        <button
          className={`ai-take-preview-btn${isPreviewing ? ' active' : ''}`}
          onClick={() => isPreviewing ? onStopPreview() : onPreview(gen)}
          title={isPreviewing ? 'Stop preview' : 'Preview take'}
        >
          {isPreviewing ? '⏹' : '▶'}
        </button>
        <button
          className="ai-take-use-btn"
          onClick={() => onUse(gen)}
          title="Add all tracks to timeline"
        >
          Use
        </button>
        <button
          className="ai-take-midi-btn"
          onClick={() => onUseAsMidi(gen)}
          title="Add all tracks to timeline as MIDI clips"
        >
          MIDI
        </button>
        <button
          className="ai-take-del-btn"
          onClick={() => onDelete(gen.id)}
          title="Delete take"
        >
          ✕
        </button>
      </div>

      <div className="ai-take-regens">
        {gen.tracks.map(track => {
          const itemId = `${gen.id}:${track.instrument}`;
          const isRegenerating = regeneratingTrackId === itemId;
          return (
            <button
              key={track.instrument}
              className={`ai-track-regen-btn${isRegenerating ? ' active' : ''}`}
              onClick={() => onRegenerateTrack(gen.id, track.instrument)}
              title={`Regenerate only ${track.label}`}
              disabled={isRegenerating || isGenerating}
            >
              {isRegenerating ? 'Regenerating…' : `↻ ${track.label}`}
            </button>
          );
        })}
        {gen.tracks.map(track => {
          const hasMidiData = track.notes.length > 0 || track.drumHits.length > 0;
          return (
            <button
              key={`${track.instrument}_midi`}
              className="ai-track-midi-btn"
              onClick={() => onUseTrackAsMidi(gen, track)}
              title={`Use ${track.label} as MIDI clip`}
              disabled={!hasMidiData || isGenerating}
            >
              MIDI {track.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default TakeItem;
