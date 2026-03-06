import { memo } from 'react';
import type { AIConfig, Instrument } from '../types/daw';
import { instrumentColor } from '../lib/backingTrackRenderer';
import {
  formatRelativeTime,
  INSTRUMENT_GROUPS,
  INSTRUMENTS,
  KEYS,
  MAX_GENERATIONS,
  type AIGeneration,
  type AIGenerationTrack,
} from './aiPanelUtils';

const TIME_SIGNATURE_OPTIONS: AIConfig['timeSignature'][] = ['4/4', '3/4', '6/8', '5/4', '7/8'];
const BAR_OPTIONS = [4, 8, 16, 32, 64];

type GroupedInstruments = Array<{
  group: typeof INSTRUMENT_GROUPS[number];
  instruments: typeof INSTRUMENTS;
}>;

type AIPanelControlsProps = {
  aiConfig: AIConfig;
  genres: typeof import('./aiPanelUtils').GENRES;
  groupedInstruments: GroupedInstruments;
  onUpdateAI: (updates: Partial<AIConfig>) => void;
  onToggleInstrument: (instrument: Instrument) => void;
};

export const AIPanelControls = memo(function AIPanelControls({
  aiConfig,
  genres,
  groupedInstruments,
  onUpdateAI,
  onToggleInstrument,
}: AIPanelControlsProps) {
  return (
    <>
      <div className="ai-left-col">
        <div className="ai-section">
          <label className="ai-section-label">Genre</label>
          <div className="genre-grid">
            {genres.map(g => (
              <button
                key={g.id}
                className={`genre-btn ${aiConfig.genre === g.id ? 'selected' : ''}`}
                onClick={() => onUpdateAI({ genre: g.id })}
              >
                <span className="genre-emoji">{g.emoji}</span>
                <span>{g.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ai-settings-row">
          <div className="ai-setting">
            <label>BPM</label>
            <div className="bpm-control">
              <button onClick={() => onUpdateAI({ bpm: Math.max(40, aiConfig.bpm - 5) })}>−</button>
              <input
                type="number"
                min={40}
                max={240}
                value={aiConfig.bpm}
                onChange={e => onUpdateAI({ bpm: parseInt(e.target.value, 10) || 120 })}
              />
              <button onClick={() => onUpdateAI({ bpm: Math.min(240, aiConfig.bpm + 5) })}>+</button>
            </div>
          </div>

          <div className="ai-setting">
            <label>Key</label>
            <select value={aiConfig.key} onChange={e => onUpdateAI({ key: e.target.value })}>
              {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          <div className="ai-setting">
            <label>Time Sig</label>
            <select
              value={aiConfig.timeSignature}
              onChange={e => onUpdateAI({ timeSignature: e.target.value as AIConfig['timeSignature'] })}
            >
              {TIME_SIGNATURE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="ai-setting">
            <label>Bars</label>
            <select value={aiConfig.bars} onChange={e => onUpdateAI({ bars: parseInt(e.target.value, 10) })}>
              {BAR_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div className="ai-section">
          <label className="ai-section-label">Generation Source</label>
          <div className="ai-source-list">
            <label className={`ai-source-option ${aiConfig.useAiArrangement ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={aiConfig.useAiArrangement}
                onChange={e => onUpdateAI({ useAiArrangement: e.target.checked })}
              />
              <span className="ai-source-copy">
                <span className="ai-source-title">Use AI arrangement</span>
                <span className="ai-source-desc">OpenAI builds the arrangement first.</span>
              </span>
            </label>
            <label className={`ai-source-option ${aiConfig.useLocalPatterns ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={aiConfig.useLocalPatterns}
                onChange={e => onUpdateAI({ useLocalPatterns: e.target.checked })}
              />
              <span className="ai-source-copy">
                <span className="ai-source-title">Use local patterns</span>
                <span className="ai-source-desc">Browser builds instrument parts locally.</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="ai-center-col">
        <label className="ai-section-label">
          Instruments
          <span className="instrument-count">{aiConfig.instruments.length} selected</span>
        </label>
        <div className="instruments-grid">
          {groupedInstruments.map(({ group, instruments }) => (
            <div key={group} className="instrument-group">
              <div className="instrument-group-label">{group}</div>
              <div className="instrument-group-items">
                {instruments.map(inst => {
                  const selected = aiConfig.instruments.includes(inst.id);
                  return (
                    <button
                      key={inst.id}
                      className={`instrument-btn ${selected ? 'selected' : ''}`}
                      onClick={() => onToggleInstrument(inst.id)}
                      title={inst.label}
                    >
                      <span className="inst-emoji">{inst.emoji}</span>
                      <span className="inst-label">{inst.label}</span>
                      {selected && <span className="inst-check">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

type AIPanelSummaryProps = {
  aiConfig: AIConfig;
  selectedSourcesLabel: string;
  onGenerate: () => void;
  onCancel: () => void;
};

export const AIPanelSummary = memo(function AIPanelSummary({
  aiConfig,
  selectedSourcesLabel,
  onGenerate,
  onCancel,
}: AIPanelSummaryProps) {
  return (
    <>
      <div className="ai-section ai-summary">
        <label className="ai-section-label">Summary</label>
        <div className="ai-summary-row">
          <span className="ai-tag">{aiConfig.genre.toUpperCase()}</span>
          <span className="ai-tag">{aiConfig.bpm} BPM</span>
          <span className="ai-tag">{aiConfig.key}</span>
          <span className="ai-tag">{aiConfig.timeSignature}</span>
          <span className="ai-tag">{aiConfig.bars} bars</span>
          <span className="ai-tag">{selectedSourcesLabel || 'No source selected'}</span>
        </div>
        <div className="ai-instr-list">
          {aiConfig.instruments.length === 0
            ? <span style={{ color: '#666', fontStyle: 'italic' }}>No instruments selected</span>
            : aiConfig.instruments.map(i => {
                const instrument = INSTRUMENTS.find(x => x.id === i);
                return (
                  <span key={i} className="ai-instr-tag">
                    {instrument?.emoji} {instrument?.label}
                  </span>
                );
              })
          }
        </div>
      </div>

      {aiConfig.isGenerating ? (
        <div className="ai-progress-section">
          <div className="ai-progress-label">Generating via {selectedSourcesLabel || 'selected source'}…</div>
          <div className="ai-progress-bar-outer">
            <div className="ai-progress-bar-inner" style={{ width: `${aiConfig.progress}%` }} />
          </div>
          <div className="ai-progress-pct">{aiConfig.progress}%</div>
          <button className="ai-cancel-btn" onClick={onCancel}>Cancel</button>
        </div>
      ) : (
        <button className="generate-btn" onClick={onGenerate} disabled={aiConfig.instruments.length === 0}>
          ✨ Generate Take
        </button>
      )}
    </>
  );
});

type AIGenerationListProps = {
  aiIsGenerating: boolean;
  generations: AIGeneration[];
  previewingId: string | null;
  regeneratingTrackId: string | null;
  onStopPreview: () => void;
  onPreview: (generation: AIGeneration) => void;
  onUseGeneration: (generation: AIGeneration) => void;
  onUseGenerationAsMidi: (generation: AIGeneration) => void;
  onDeleteGeneration: (id: string) => void;
  onRegenerateTrack: (generationId: string, instrument: Instrument) => void;
  onUseTrackAsMidi: (generation: AIGeneration, track: AIGenerationTrack) => void;
};

export const AIGenerationList = memo(function AIGenerationList({
  aiIsGenerating,
  generations,
  previewingId,
  regeneratingTrackId,
  onStopPreview,
  onPreview,
  onUseGeneration,
  onUseGenerationAsMidi,
  onDeleteGeneration,
  onRegenerateTrack,
  onUseTrackAsMidi,
}: AIGenerationListProps) {
  if (generations.length === 0) {
    if (aiIsGenerating) return null;
    return (
      <div className="ai-note">
        <span>💡</span>
        <span>
          Generate multiple takes, preview each one, then hit <strong>Use</strong> to add linked audio + MIDI tracks to the timeline. Holds up to {MAX_GENERATIONS} takes.
        </span>
      </div>
    );
  }

  return (
    <div className="ai-takes-section">
      <div className="ai-takes-header">
        <span className="ai-section-label" style={{ marginBottom: 0 }}>
          Takes ({generations.length}/{MAX_GENERATIONS})
        </span>
        <span className="ai-takes-hint">Preview · compare · use audio or MIDI</span>
      </div>

      <div className="ai-takes-list">
        {generations.map(gen => {
          const isPreviewing = previewingId === gen.id;
          return (
            <div key={gen.id} className={`ai-take-item${isPreviewing ? ' previewing' : ''}`}>
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
                  onClick={() => onUseGeneration(gen)}
                  title="Add all tracks to timeline as linked audio + MIDI pairs"
                >
                  Use Link
                </button>
                <button
                  className="ai-take-midi-btn"
                  onClick={() => onUseGenerationAsMidi(gen)}
                  title="Add all tracks to timeline as MIDI clips"
                >
                  MIDI
                </button>
                <button
                  className="ai-take-del-btn"
                  onClick={() => onDeleteGeneration(gen.id)}
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
                      disabled={isRegenerating || aiIsGenerating}
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
                      disabled={!hasMidiData || aiIsGenerating}
                    >
                      MIDI {track.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
