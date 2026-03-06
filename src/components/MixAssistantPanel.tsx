import React from 'react';
import { useDAW } from '../context/DAWContext';
import { LOUDNESS_PRESETS } from '../lib/mixAssistant';
import { useMixAssistant } from '../hooks/useMixAssistant';

// ─── MixAssistantPanel ────────────────────────────────────────────────────────
// Extracted from Mixer.tsx so the meter RAF loop in Mixer doesn't force this
// subtree to re-render. All AI assistant sections live here.

const MixAssistantPanel = React.memo(function MixAssistantPanel() {
  const { state } = useDAW();
  const mix = useMixAssistant();

  return (
    <div className="mix-assistant-panel">
      {/* ── Auto Mix ──────────────────────────────────────────────────────── */}
      <div className="mix-automix-row">
        <button
          className={`mix-automix-btn ${mix.autoMixSnapshot ? 'mix-automix-applied' : ''}`}
          onClick={mix.previewAutoMix}
          disabled={Boolean(mix.autoMixSnapshot)}
          title="Preview gain staging, EQ correction, and dynamics processing across the mix"
        >
          ✦ Preview Auto Mix
        </button>
        {mix.autoMixSnapshot && (
          <>
            <span className="mix-automix-summary">
              Preview applied:
              Gain <strong>{mix.autoMixSnapshot.appliedCounts.gain}</strong>
              {' · '} EQ <strong>{mix.autoMixSnapshot.appliedCounts.eq}</strong>
              {' · '} Dynamics <strong>{mix.autoMixSnapshot.appliedCounts.dynamics}</strong>
              {mix.autoMixSnapshot.appliedCounts.dynamics > 0 ? ' + master' : ''}
            </span>
            <button className="mix-automix-accept-btn" onClick={mix.acceptAutoMix} title="Keep Auto Mix changes">
              Accept
            </button>
            <button className="mix-automix-revert-btn" onClick={mix.revertAutoMix} title="Undo all Auto Mix changes">
              Revert
            </button>
          </>
        )}
      </div>
      <div className="mix-assistant-row mix-ab-row">
        <span className="mix-assistant-title">Mix A/B</span>
        <button
          className={`mix-assistant-btn mix-ab-slot-btn${mix.activeMixSnapshotSlot === 'A' ? ' active' : ''}`}
          onClick={() => mix.applyMixSnapshot('A')}
          disabled={!mix.mixSnapshots.A || mix.snapshotControlsDisabled}
          title="Recall snapshot A"
        >
          Load A
        </button>
        <button
          className="mix-assistant-btn mix-ab-save-btn"
          onClick={() => mix.saveMixSnapshot('A')}
          disabled={mix.snapshotControlsDisabled}
          title="Store current mix as snapshot A"
        >
          Save A
        </button>
        <button
          className={`mix-assistant-btn mix-ab-slot-btn${mix.activeMixSnapshotSlot === 'B' ? ' active' : ''}`}
          onClick={() => mix.applyMixSnapshot('B')}
          disabled={!mix.mixSnapshots.B || mix.snapshotControlsDisabled}
          title="Recall snapshot B"
        >
          Load B
        </button>
        <button
          className="mix-assistant-btn mix-ab-save-btn"
          onClick={() => mix.saveMixSnapshot('B')}
          disabled={mix.snapshotControlsDisabled}
          title="Store current mix as snapshot B"
        >
          Save B
        </button>
        <button
          className="mix-assistant-btn mix-ab-toggle-btn"
          onClick={mix.toggleMixSnapshotAB}
          disabled={!mix.canToggleMixSnapshots || mix.snapshotControlsDisabled}
          title="Toggle between snapshots A and B"
        >
          Swap A/B
        </button>
      </div>
      {(mix.mixSnapshots.A || mix.mixSnapshots.B) && (
        <div className="mix-ab-status">
          {mix.mixSnapshots.A ? `A ${formatSnapshotTime(mix.mixSnapshots.A.capturedAt)}` : 'A empty'}
          {' · '}
          {mix.mixSnapshots.B ? `B ${formatSnapshotTime(mix.mixSnapshots.B.capturedAt)}` : 'B empty'}
          {mix.activeMixSnapshotSlot ? ` · Active ${mix.activeMixSnapshotSlot}` : ''}
        </div>
      )}

      {/* ── Gain / LUFS ───────────────────────────────────────────────────── */}
      <div className="mix-assistant-row">
        <span className="mix-assistant-title">AI Mix Analysis</span>
        <button className="mix-assistant-btn" onClick={mix.runMixAnalysis}>Gain Levels</button>
        <button
          className="mix-assistant-btn"
          onClick={mix.applyAllMixProposals}
          disabled={!mix.mixReport || mix.mixReport.trackProposals.length === 0}
        >
          Apply All
        </button>
      </div>

      {mix.mixReport && (
        <div className="mix-assistant-results">
          <div className="mix-assistant-summary">
            Master est: {mix.mixReport.masterEstimatedLufs.toFixed(1)} LUFS · peak {mix.mixReport.masterPeakDbfs.toFixed(1)} dBFS
          </div>
          {mix.mixReport.trackProposals.length === 0 && (
            <div className="mix-assistant-empty">No analyzable audio tracks found.</div>
          )}
          {mix.mixReport.trackProposals.map(proposal => (
            <div key={proposal.trackId} className="mix-assistant-item">
              <div className="mix-assistant-item-main">
                <span className="mix-track-name">{proposal.trackName}</span>
                <span className="mix-track-role">{proposal.role}</span>
                <span className="mix-track-metric">{proposal.estimatedLufs.toFixed(1)} → {proposal.targetLufs.toFixed(1)} LUFS</span>
                <span className={`mix-track-delta ${proposal.deltaDb >= 0 ? 'up' : 'down'}`}>
                  {proposal.deltaDb >= 0 ? '+' : ''}{proposal.deltaDb.toFixed(1)} dB
                </span>
                <span className="mix-track-confidence">{Math.round(proposal.confidence * 100)}%</span>
              </div>
              <div className="mix-assistant-item-actions">
                <span className="mix-track-volume">
                  vol {Math.round(proposal.currentVolume * 100)} → {Math.round(proposal.suggestedVolume * 100)}
                </span>
                <button
                  className="mix-assistant-apply-btn"
                  onClick={() => mix.applyMixProposal(proposal.trackId, proposal.suggestedVolume)}
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── EQ Analysis ───────────────────────────────────────────────────── */}
      <div className="mix-assistant-row mix-eq-row">
        <span className="mix-assistant-title">AI EQ Assistant</span>
        <button className="mix-assistant-btn" onClick={mix.runEqAnalysis}>Analyze EQ</button>
        {mix.eqReport && mix.eqReport.trackProposals.length > 0 && (
          <>
            <button className="mix-assistant-btn" onClick={mix.applyAllEqProposals}>Apply All</button>
            <button
              className={`mix-assistant-btn mix-eq-toggle ${mix.eqPanelOpen ? 'active' : ''}`}
              onClick={() => mix.setEqPanelOpen(v => !v)}
            >
              {mix.eqPanelOpen ? 'Hide' : `Show (${mix.eqReport.trackProposals.length})`}
            </button>
          </>
        )}
      </div>

      {mix.eqReport && mix.eqPanelOpen && (
        <div className="mix-assistant-results mix-eq-results">
          {mix.eqReport.trackProposals.length === 0 && (
            <div className="mix-assistant-empty">No EQ issues detected — mix sounds clean.</div>
          )}
          {mix.eqReport.trackProposals.map(proposal => {
            const existingEq = state.tracks.find(t => t.id === proposal.trackId)?.plugins.find(p => p.type === 'eq');
            return (
              <div key={proposal.trackId} className="mix-assistant-item mix-eq-item">
                <div className="mix-assistant-item-main">
                  <span className="mix-track-name">{proposal.trackName}</span>
                  <span className="mix-track-role">{proposal.role}</span>
                  <span className="mix-eq-band-list">
                    {proposal.bands.map((b, i) => (
                      <span key={i} className={`mix-eq-band-tag mix-eq-kind-${b.kind}`} title={b.reason}>
                        {b.label} {b.gainDb.toFixed(1)} dB @ {b.freq >= 1000 ? `${(b.freq / 1000).toFixed(1)}k` : b.freq} Hz
                      </span>
                    ))}
                  </span>
                </div>
                <div className="mix-assistant-item-actions">
                  <span className="mix-track-confidence">{Math.round((proposal.bands[0] ? proposal.bands[0].confidence : 0) * 100)}%</span>
                  <button
                    className="mix-assistant-apply-btn"
                    title={existingEq ? 'Update existing EQ plugin' : 'Add EQ plugin with suggested cuts'}
                    onClick={() => mix.applyEqToTrack(proposal)}
                  >
                    {existingEq ? 'Update EQ' : 'Add EQ'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Masking Detector ──────────────────────────────────────────────── */}
      <div className="mix-assistant-row mix-masking-row">
        <span className="mix-assistant-title">Masking Detector</span>
        <button className="mix-assistant-btn" onClick={mix.runMaskingAnalysis}>Detect Conflicts</button>
        {mix.maskingReport && (
          <>
            <button
              className="mix-assistant-btn"
              onClick={mix.applyAllMaskingFixes}
              disabled={mix.maskingReport.conflicts.length === 0}
            >
              Apply All
            </button>
            <button
              className={`mix-assistant-btn mix-masking-toggle ${mix.maskingPanelOpen ? 'active' : ''}`}
              onClick={() => mix.setMaskingPanelOpen(v => !v)}
            >
              {mix.maskingPanelOpen ? 'Hide' : `Show (${mix.maskingReport.conflicts.length})`}
            </button>
          </>
        )}
      </div>

      {mix.maskingReport && mix.maskingPanelOpen && (
        <div className="mix-assistant-results mix-masking-results">
          {mix.maskingReport.conflicts.length === 0 && (
            <div className="mix-assistant-empty">No strong masking conflicts detected.</div>
          )}
          {mix.maskingReport.conflicts.map(conflict => (
            <div key={conflict.id} className="mix-assistant-item mix-masking-item">
              <div className="mix-assistant-item-main">
                <span className="mix-track-name">
                  {conflict.trackAName} × {conflict.trackBName}
                </span>
                <span className="mix-track-role">{conflict.bandLabel}</span>
                <span className="mix-track-metric">{conflict.centerHz} Hz</span>
                <span className="mix-track-confidence">{Math.round(conflict.confidence * 100)}%</span>
                <span className="mix-masking-cut-target">
                  cut {conflict.trackAId === conflict.suggestedCutTrackId ? conflict.trackAName : conflict.trackBName}
                </span>
              </div>
              <div className="mix-assistant-item-actions">
                <span className="mix-masking-cut-amount">{conflict.suggestedCut.gainDb.toFixed(1)} dB</span>
                <button
                  className="mix-assistant-apply-btn"
                  title={conflict.recommendation}
                  onClick={() => mix.applyMaskingFix(conflict)}
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dynamics Assistant ────────────────────────────────────────────── */}
      <div className="mix-assistant-row mix-dynamics-row">
        <span className="mix-assistant-title">AI Dynamics Assistant</span>
        <button className="mix-assistant-btn" onClick={mix.runDynamicsAnalysis}>Analyze Dynamics</button>
        {mix.dynamicsReport && (
          <>
            <button
              className="mix-assistant-btn"
              onClick={mix.applyAllDynamics}
              disabled={mix.dynamicsReport.trackProposals.length === 0}
            >
              Apply All
            </button>
            <button
              className={`mix-assistant-btn mix-dynamics-toggle ${mix.dynamicsPanelOpen ? 'active' : ''}`}
              onClick={() => mix.setDynamicsPanelOpen(v => !v)}
            >
              {mix.dynamicsPanelOpen ? 'Hide' : `Show (${mix.dynamicsReport.trackProposals.length + 1})`}
            </button>
          </>
        )}
      </div>

      {mix.dynamicsReport && mix.dynamicsPanelOpen && (
        <div className="mix-assistant-results mix-dynamics-results">
          {mix.dynamicsReport.trackProposals.map(proposal => (
            <div key={proposal.trackId} className="mix-assistant-item mix-dynamics-item">
              <div className="mix-assistant-item-main">
                <span className="mix-track-name">{proposal.trackName}</span>
                <span className="mix-track-role">{proposal.role}</span>
                <span className="mix-track-metric">intensity {Math.round(proposal.intensity * 100)}%</span>
                <span className="mix-track-confidence">{Math.round(proposal.confidence * 100)}%</span>
              </div>
              <div className="mix-assistant-item-actions">
                <DynamicsPluginList plugins={proposal.plugins} />
                <button
                  className="mix-assistant-apply-btn"
                  onClick={() => mix.applyDynamicsToTrack(proposal.trackId, proposal.plugins)}
                >
                  Apply
                </button>
              </div>
            </div>
          ))}

          <div className="mix-assistant-item mix-dynamics-item mix-dynamics-master">
            <div className="mix-assistant-item-main">
              <span className="mix-track-name">Master</span>
              <span className="mix-track-role">{mix.dynamicsReport.masterProposal.role}</span>
              <span className="mix-track-metric">peak {mix.dynamicsReport.masterProposal.estimatedPeakDbfs.toFixed(1)} dBFS</span>
              <span className="mix-track-confidence">{Math.round(mix.dynamicsReport.masterProposal.confidence * 100)}%</span>
            </div>
            <div className="mix-assistant-item-actions">
              <DynamicsPluginList plugins={mix.dynamicsReport.masterProposal.plugins} />
              <button
                className="mix-assistant-apply-btn"
                onClick={() => mix.applyMasterDynamics(mix.dynamicsReport!.masterProposal.plugins)}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Loudness Target Presets ───────────────────────────────────────── */}
      <div className="mix-assistant-row mix-loudness-row">
        <span className="mix-assistant-title">Loudness Target</span>
        {(Object.keys(LOUDNESS_PRESETS) as (keyof typeof LOUDNESS_PRESETS)[]).map(preset => (
          <button
            key={preset}
            className={`mix-loudness-preset-btn${state.loudnessPreset === preset ? ' active' : ''}`}
            onClick={() => mix.applyLoudnessPreset(preset)}
            title={LOUDNESS_PRESETS[preset].description}
          >
            {LOUDNESS_PRESETS[preset].label}
          </button>
        ))}
        {state.loudnessPreset && (
          <button
            className="mix-loudness-clear-btn"
            onClick={mix.clearLoudnessPreset}
            title="Remove loudness preset from master chain"
          >
            ✕ Clear
          </button>
        )}
      </div>
      {state.loudnessPreset && (
        <div className="mix-loudness-status">
          <span className="mix-loudness-active-label">
            ⊙ {LOUDNESS_PRESETS[state.loudnessPreset].description}
          </span>
          <span className="mix-loudness-hint">
            Compressor + limiter added to master chain
          </span>
        </div>
      )}

      {/* ── Auto Bus Setup ────────────────────────────────────────────────── */}
      <div className="mix-assistant-row mix-bussetup-row">
        <span className="mix-assistant-title">Auto Bus Setup</span>
        <button
          className="mix-assistant-btn"
          onClick={mix.applyAutoBusSetup}
          title="Create Drum/Vocal/Music buses, add glue defaults, and route tracks"
        >
          Create + Route
        </button>
        {mix.autoBusSummary && (
          <span className="mix-bussetup-summary">
            +{mix.autoBusSummary.createdBuses} buses · {mix.autoBusSummary.routedTracks} routed
          </span>
        )}
      </div>
      {mix.autoBusSummary && (
        <div className="mix-bussetup-status">
          Reused {mix.autoBusSummary.reusedBuses} existing buses · Added {mix.autoBusSummary.pluginDefaultsAdded} bus-default plugins
        </div>
      )}
    </div>
  );
});

// ─── DynamicsPluginList ───────────────────────────────────────────────────────
// Extracted sub-component — was duplicated inline for per-track and master rows.

interface DynamicsPlugin {
  type: string;
  params: Record<string, number>;
  reason: string;
}

function DynamicsPluginList({ plugins }: { plugins: DynamicsPlugin[] }) {
  return (
    <span className="mix-dynamics-plugin-list">
      {plugins.map(plugin => (
        <span
          key={plugin.type}
          className={`mix-dynamics-plugin-tag${plugin.type === 'limiter' ? ' limiter' : ''}`}
          title={plugin.reason}
        >
          {plugin.type}{' '}
          {plugin.type === 'compressor'
            ? `${(plugin.params['threshold'] ?? 0).toFixed(1)}dB / ${(plugin.params['ratio'] ?? 1).toFixed(1)}:1`
            : `${(plugin.params['threshold'] ?? 0).toFixed(1)}dB`}
        </span>
      ))}
    </span>
  );
}

export default MixAssistantPanel;

function formatSnapshotTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
