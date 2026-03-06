import { useState, useCallback } from 'react';
import { useDAW } from '../context/DAWContext';
import type { LoudnessPreset, PluginInstance } from '../types/daw';
import {
  analyzeMixGainTargets,
  analyzeEqProblems,
  analyzeDynamicsSuggestions,
  analyzeMaskingConflicts,
  makeEqPluginFromSuggestion,
  makeDynamicsPluginFromSuggestion,
  buildLoudnessPresetMasterChain,
  inferAutoBusGroup,
  getAutoBusLabel,
  type AutoBusGroup,
  type MixAnalysisReport,
  type EqAnalysisReport,
  type DynamicsAnalysisReport,
  type MaskingAnalysisReport,
  type MaskingConflict,
} from '../lib/mixAssistant';
import {
  captureMixSnapshot,
  getAlternateSnapshotSlot,
  type MixSnapshotSlot,
  type MixSnapshotState,
} from '../lib/mixSnapshots';

// ─── Snapshot types (internal to mix assistant) ───────────────────────────────

interface TrackSnapshot {
  id: string;
  volume: number;
  plugins: PluginInstance[];
}

export interface AutoMixSnapshot {
  trackSnapshots: TrackSnapshot[];
  masterPlugins: PluginInstance[];
  appliedCounts: { gain: number; eq: number; dynamics: number };
}

interface AutoBusSetupSummary {
  createdBuses: number;
  reusedBuses: number;
  routedTracks: number;
  pluginDefaultsAdded: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMixAssistant() {
  const { state, dispatch, createTrack, makePlugin } = useDAW();

  const [mixReport, setMixReport] = useState<MixAnalysisReport | null>(null);
  const [eqReport, setEqReport] = useState<EqAnalysisReport | null>(null);
  const [dynamicsReport, setDynamicsReport] = useState<DynamicsAnalysisReport | null>(null);
  const [maskingReport, setMaskingReport] = useState<MaskingAnalysisReport | null>(null);
  const [eqPanelOpen, setEqPanelOpen] = useState(false);
  const [dynamicsPanelOpen, setDynamicsPanelOpen] = useState(false);
  const [maskingPanelOpen, setMaskingPanelOpen] = useState(false);
  const [autoMixSnapshot, setAutoMixSnapshot] = useState<AutoMixSnapshot | null>(null);
  const [mixSnapshots, setMixSnapshots] = useState<Partial<Record<MixSnapshotSlot, MixSnapshotState>>>({});
  const [activeMixSnapshotSlot, setActiveMixSnapshotSlot] = useState<MixSnapshotSlot | null>(null);
  const [autoBusSummary, setAutoBusSummary] = useState<AutoBusSetupSummary | null>(null);

  // ── Gain ────────────────────────────────────────────────────────────────────

  const runMixAnalysis = useCallback(() => {
    setMixReport(analyzeMixGainTargets(state.tracks));
  }, [state.tracks]);

  const applyMixProposal = useCallback((trackId: string, volume: number) => {
    dispatch({ type: 'UPDATE_TRACK', payload: { id: trackId, updates: { volume } } });
  }, [dispatch]);

  const applyAllMixProposals = useCallback(() => {
    if (!mixReport) return;
    mixReport.trackProposals.forEach(proposal => {
      dispatch({
        type: 'UPDATE_TRACK',
        payload: { id: proposal.trackId, updates: { volume: proposal.suggestedVolume } },
      });
    });
  }, [dispatch, mixReport]);

  // ── EQ ─────────────────────────────────────────────────────────────────────

  const runEqAnalysis = useCallback(() => {
    setEqReport(analyzeEqProblems(state.tracks));
    setEqPanelOpen(true);
  }, [state.tracks]);

  const applyEqToTrack = useCallback((proposal: { trackId: string; pluginParams: Record<string, number> }) => {
    const track = state.tracks.find(t => t.id === proposal.trackId);
    const existingEq = track?.plugins.find(p => p.type === 'eq');
    if (existingEq) {
      dispatch({
        type: 'UPDATE_PLUGIN',
        payload: {
          trackId: proposal.trackId,
          pluginId: existingEq.id,
          updates: { parameters: { ...existingEq.parameters, ...proposal.pluginParams } },
        },
      });
    } else {
      const plugin = makeEqPluginFromSuggestion(proposal as Parameters<typeof makeEqPluginFromSuggestion>[0]);
      dispatch({ type: 'ADD_PLUGIN', payload: { trackId: proposal.trackId, plugin } });
    }
  }, [dispatch, state.tracks]);

  const applyAllEqProposals = useCallback(() => {
    if (!eqReport) return;
    eqReport.trackProposals.forEach(proposal => applyEqToTrack(proposal));
  }, [eqReport, applyEqToTrack]);

  // ── Masking ─────────────────────────────────────────────────────────────────

  const runMaskingAnalysis = useCallback(() => {
    setMaskingReport(analyzeMaskingConflicts(state.tracks));
    setMaskingPanelOpen(true);
  }, [state.tracks]);

  const applyMaskingCut = useCallback((trackId: string, cut: { freq: number; gainDb: number }) => {
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;
    const existingEq = track.plugins.find(p => p.type === 'eq');
    const base = existingEq?.parameters ?? {};
    const nextParams: Record<string, number> = {
      low: Number(base.low ?? 0),
      lowFreq: Number(base.lowFreq ?? 80),
      mid: Number(base.mid ?? 0),
      midFreq: Number(base.midFreq ?? 1000),
      high: Number(base.high ?? 0),
      highFreq: Number(base.highFreq ?? 10000),
    };
    if (cut.freq <= 260) {
      nextParams.low = Math.min(nextParams.low, cut.gainDb);
      nextParams.lowFreq = cut.freq;
    } else if (cut.freq <= 5000) {
      nextParams.mid = Math.min(nextParams.mid, cut.gainDb);
      nextParams.midFreq = cut.freq;
    } else {
      nextParams.high = Math.min(nextParams.high, cut.gainDb);
      nextParams.highFreq = cut.freq;
    }

    if (existingEq) {
      dispatch({
        type: 'UPDATE_PLUGIN',
        payload: {
          trackId,
          pluginId: existingEq.id,
          updates: { parameters: { ...existingEq.parameters, ...nextParams } },
        },
      });
      return;
    }

    dispatch({
      type: 'ADD_PLUGIN',
      payload: {
        trackId,
        plugin: {
          id: `eq-mask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'eq',
          name: 'AI Masking Cut',
          enabled: true,
          parameters: nextParams,
        },
      },
    });
  }, [dispatch, state.tracks]);

  const applyMaskingFix = useCallback((conflict: MaskingConflict) => {
    applyMaskingCut(conflict.suggestedCutTrackId, conflict.suggestedCut);
  }, [applyMaskingCut]);

  const applyAllMaskingFixes = useCallback(() => {
    if (!maskingReport) return;
    const bestPerTrack = new Map<string, MaskingConflict>();
    maskingReport.conflicts.forEach(conflict => {
      const existing = bestPerTrack.get(conflict.suggestedCutTrackId);
      if (!existing || conflict.severity > existing.severity) {
        bestPerTrack.set(conflict.suggestedCutTrackId, conflict);
      }
    });
    bestPerTrack.forEach(conflict => applyMaskingFix(conflict));
  }, [maskingReport, applyMaskingFix]);

  // ── Dynamics ────────────────────────────────────────────────────────────────

  const runDynamicsAnalysis = useCallback(() => {
    setDynamicsReport(analyzeDynamicsSuggestions(state.tracks));
    setDynamicsPanelOpen(true);
  }, [state.tracks]);

  const applyDynamicsToTrack = useCallback((
    trackId: string,
    plugins: { type: 'compressor' | 'limiter'; params: Record<string, number> }[],
  ) => {
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;
    plugins.forEach(suggestion => {
      const existing = track.plugins.find(p => p.type === suggestion.type);
      if (existing) {
        dispatch({
          type: 'UPDATE_PLUGIN',
          payload: {
            trackId,
            pluginId: existing.id,
            updates: { parameters: { ...existing.parameters, ...suggestion.params } },
          },
        });
      } else {
        dispatch({
          type: 'ADD_PLUGIN',
          payload: { trackId, plugin: makeDynamicsPluginFromSuggestion(suggestion.type, suggestion.params) },
        });
      }
    });
  }, [dispatch, state.tracks]);

  const applyMasterDynamics = useCallback((
    plugins: { type: 'compressor' | 'limiter'; params: Record<string, number> }[],
  ) => {
    plugins.forEach(suggestion => {
      const existing = state.masterPlugins.find(p => p.type === suggestion.type);
      if (existing) {
        dispatch({
          type: 'UPDATE_MASTER_PLUGIN',
          payload: {
            pluginId: existing.id,
            updates: { parameters: { ...existing.parameters, ...suggestion.params } },
          },
        });
      } else {
        dispatch({
          type: 'ADD_MASTER_PLUGIN',
          payload: makeDynamicsPluginFromSuggestion(suggestion.type, suggestion.params),
        });
      }
    });
  }, [dispatch, state.masterPlugins]);

  const applyAllDynamics = useCallback(() => {
    if (!dynamicsReport) return;
    dynamicsReport.trackProposals.forEach(proposal =>
      applyDynamicsToTrack(proposal.trackId, proposal.plugins),
    );
    applyMasterDynamics(dynamicsReport.masterProposal.plugins);
  }, [applyDynamicsToTrack, applyMasterDynamics, dynamicsReport]);

  // ── Loudness preset ─────────────────────────────────────────────────────────

  const applyLoudnessPreset = useCallback((preset: LoudnessPreset) => {
    const { compressor, limiter } = buildLoudnessPresetMasterChain(preset, state.tracks);
    dispatch({ type: 'APPLY_LOUDNESS_PRESET', payload: { preset, compressor, limiter } });
  }, [dispatch, state.tracks]);

  const clearLoudnessPreset = useCallback(() => {
    dispatch({ type: 'CLEAR_LOUDNESS_PRESET' });
  }, [dispatch]);

  // ── Auto bus setup ────────────────────────────────────────────────────────

  const makeBusCompressorPlugin = useCallback((group: AutoBusGroup) => {
    const plugin = makePlugin('compressor');
    plugin.name = `AI ${getAutoBusLabel(group)} Glue Comp`;
    plugin.parameters = {
      ...plugin.parameters,
      threshold: group === 'drums' ? -16 : (group === 'vocal' ? -18 : -20),
      ratio: group === 'drums' ? 3 : 2.4,
      attack: group === 'drums' ? 22 : 12,
      release: 120,
      knee: 8,
      makeupGain: 0,
    };
    return plugin;
  }, [makePlugin]);

  const makeBusEqPlugin = useCallback((group: AutoBusGroup) => {
    const plugin = makePlugin('eq');
    plugin.name = `AI ${getAutoBusLabel(group)} Tone EQ`;
    plugin.parameters = {
      ...plugin.parameters,
      low: group === 'vocal' ? -1.2 : (group === 'drums' ? 1 : -0.3),
      lowFreq: group === 'drums' ? 80 : 120,
      mid: group === 'drums' ? -0.5 : (group === 'vocal' ? 0.8 : 0.6),
      midFreq: group === 'vocal' ? 2400 : 1400,
      high: group === 'vocal' ? 1.2 : (group === 'drums' ? 0.6 : 0.4),
      highFreq: 9000,
    };
    return plugin;
  }, [makePlugin]);

  const applyAutoBusSetup = useCallback(() => {
    const existingBusTracks = state.tracks.filter(track => track.type === 'bus');
    const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
    let pluginDefaultsAdded = 0;
    let createdBuses = 0;
    let reusedBuses = 0;

    const busesByGroup = new Map<AutoBusGroup, { id: string }>();

    (['drums', 'vocal', 'music'] as const).forEach((group) => {
      const label = getAutoBusLabel(group);
      const existing = existingBusTracks.find(track => normalize(track.name) === normalize(label));
      if (existing) {
        busesByGroup.set(group, { id: existing.id });
        reusedBuses += 1;
        if (!existing.plugins.some(plugin => plugin.type === 'compressor')) {
          dispatch({ type: 'ADD_PLUGIN', payload: { trackId: existing.id, plugin: makeBusCompressorPlugin(group) } });
          pluginDefaultsAdded += 1;
        }
        if (!existing.plugins.some(plugin => plugin.type === 'eq')) {
          dispatch({ type: 'ADD_PLUGIN', payload: { trackId: existing.id, plugin: makeBusEqPlugin(group) } });
          pluginDefaultsAdded += 1;
        }
        return;
      }

      const newBus = createTrack('bus');
      const busTrack = {
        ...newBus,
        name: label,
        volume: 0.8,
        pan: 0,
        plugins: [makeBusCompressorPlugin(group), makeBusEqPlugin(group)],
      };
      dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: busTrack });
      busesByGroup.set(group, { id: busTrack.id });
      createdBuses += 1;
      pluginDefaultsAdded += 2;
    });

    let routedTracks = 0;
    state.tracks.forEach(track => {
      if (track.type === 'bus' || track.type === 'video') return;
      const group = inferAutoBusGroup(track);
      if (!group) return;
      const bus = busesByGroup.get(group);
      if (!bus || track.busRouteId === bus.id) return;
      dispatch({
        type: 'SET_TRACK_BUS_ROUTE',
        payload: { id: track.id, busRouteId: bus.id },
      });
      routedTracks += 1;
    });

    setAutoBusSummary({
      createdBuses,
      reusedBuses,
      routedTracks,
      pluginDefaultsAdded,
    });
  }, [createTrack, dispatch, makeBusCompressorPlugin, makeBusEqPlugin, state.tracks]);

  // ── Auto Mix ────────────────────────────────────────────────────────────────

  const previewAutoMix = useCallback(() => {
    if (autoMixSnapshot) return;

    const snapshot: AutoMixSnapshot = {
      trackSnapshots: state.tracks.map(t => ({
        id: t.id,
        volume: t.volume,
        plugins: t.plugins.map(p => ({ ...p, parameters: { ...p.parameters } })),
      })),
      masterPlugins: state.masterPlugins.map(p => ({ ...p, parameters: { ...p.parameters } })),
      appliedCounts: { gain: 0, eq: 0, dynamics: 0 },
    };

    // 1. Gain pass
    const gainReport = analyzeMixGainTargets(state.tracks);
    gainReport.trackProposals.forEach(p => {
      dispatch({ type: 'UPDATE_TRACK', payload: { id: p.trackId, updates: { volume: p.suggestedVolume } } });
    });
    snapshot.appliedCounts.gain = gainReport.trackProposals.length;

    // 2. EQ pass
    const freshEqReport = analyzeEqProblems(state.tracks);
    freshEqReport.trackProposals.forEach(proposal => {
      const track = state.tracks.find(t => t.id === proposal.trackId);
      const existingEq = track?.plugins.find(p => p.type === 'eq');
      if (existingEq) {
        dispatch({
          type: 'UPDATE_PLUGIN',
          payload: { trackId: proposal.trackId, pluginId: existingEq.id, updates: { parameters: { ...existingEq.parameters, ...proposal.pluginParams } } },
        });
      } else {
        dispatch({ type: 'ADD_PLUGIN', payload: { trackId: proposal.trackId, plugin: makeEqPluginFromSuggestion(proposal) } });
      }
    });
    snapshot.appliedCounts.eq = freshEqReport.trackProposals.length;

    // 3. Dynamics pass
    const freshDynReport = analyzeDynamicsSuggestions(state.tracks);
    freshDynReport.trackProposals.forEach(proposal => {
      proposal.plugins.forEach(suggestion => {
        const track = state.tracks.find(t => t.id === proposal.trackId);
        const existing = track?.plugins.find(p => p.type === suggestion.type);
        if (existing) {
          dispatch({
            type: 'UPDATE_PLUGIN',
            payload: { trackId: proposal.trackId, pluginId: existing.id, updates: { parameters: { ...existing.parameters, ...suggestion.params } } },
          });
        } else {
          dispatch({ type: 'ADD_PLUGIN', payload: { trackId: proposal.trackId, plugin: makeDynamicsPluginFromSuggestion(suggestion.type, suggestion.params) } });
        }
      });
    });
    freshDynReport.masterProposal.plugins.forEach(suggestion => {
      const existing = state.masterPlugins.find(p => p.type === suggestion.type);
      if (existing) {
        dispatch({ type: 'UPDATE_MASTER_PLUGIN', payload: { pluginId: existing.id, updates: { parameters: { ...existing.parameters, ...suggestion.params } } } });
      } else {
        dispatch({ type: 'ADD_MASTER_PLUGIN', payload: makeDynamicsPluginFromSuggestion(suggestion.type, suggestion.params) });
      }
    });
    snapshot.appliedCounts.dynamics = freshDynReport.trackProposals.length;

    setMixReport(gainReport);
    setEqReport(freshEqReport);
    setDynamicsReport(freshDynReport);
    setAutoMixSnapshot(snapshot);
  }, [state.tracks, state.masterPlugins, dispatch, autoMixSnapshot]);

  const acceptAutoMix = useCallback(() => {
    setAutoMixSnapshot(null);
  }, []);

  const revertAutoMix = useCallback(() => {
    if (!autoMixSnapshot) return;
    autoMixSnapshot.trackSnapshots.forEach(snap => {
      dispatch({ type: 'UPDATE_TRACK', payload: { id: snap.id, updates: { volume: snap.volume, plugins: snap.plugins } } });
    });
    state.masterPlugins.forEach(p => dispatch({ type: 'REMOVE_MASTER_PLUGIN', payload: p.id }));
    autoMixSnapshot.masterPlugins.forEach(p => dispatch({ type: 'ADD_MASTER_PLUGIN', payload: p }));
    setAutoMixSnapshot(null);
    setMixReport(null);
    setEqReport(null);
    setDynamicsReport(null);
  }, [autoMixSnapshot, dispatch, state.masterPlugins]);

  // ── Mix A/B snapshots ─────────────────────────────────────────────────────

  const saveMixSnapshot = useCallback((slot: MixSnapshotSlot) => {
    const snapshot = captureMixSnapshot(state);
    setMixSnapshots(previous => ({ ...previous, [slot]: snapshot }));
  }, [state]);

  const recallSnapshot = useCallback((snapshot: MixSnapshotState, activeSlot: MixSnapshotSlot) => {
    snapshot.trackSnapshots.forEach((trackSnapshot) => {
      dispatch({
        type: 'UPDATE_TRACK',
        payload: {
          id: trackSnapshot.id,
          updates: {
            volume: trackSnapshot.volume,
            pan: trackSnapshot.pan,
            muted: trackSnapshot.muted,
            soloed: trackSnapshot.soloed,
            busRouteId: trackSnapshot.busRouteId,
            plugins: trackSnapshot.plugins.map(plugin => ({
              ...plugin,
              parameters: { ...plugin.parameters },
            })),
          },
        },
      });
    });
    dispatch({ type: 'SET_MASTER_VOLUME', payload: snapshot.masterVolume });
    state.masterPlugins.forEach(plugin => {
      dispatch({ type: 'REMOVE_MASTER_PLUGIN', payload: plugin.id });
    });
    snapshot.masterPlugins.forEach(plugin => {
      dispatch({
        type: 'ADD_MASTER_PLUGIN',
        payload: { ...plugin, parameters: { ...plugin.parameters } },
      });
    });
    setActiveMixSnapshotSlot(activeSlot);
  }, [dispatch, state.masterPlugins]);

  const applyMixSnapshot = useCallback((slot: MixSnapshotSlot) => {
    const snapshot = mixSnapshots[slot];
    if (!snapshot) return;
    recallSnapshot(snapshot, slot);
  }, [mixSnapshots, recallSnapshot]);

  const toggleMixSnapshotAB = useCallback(() => {
    if (!mixSnapshots.A || !mixSnapshots.B) return;
    const nextSlot = getAlternateSnapshotSlot(activeMixSnapshotSlot, mixSnapshots);
    if (!nextSlot) return;
    const snapshot = mixSnapshots[nextSlot];
    if (!snapshot) return;
    recallSnapshot(snapshot, nextSlot);
  }, [activeMixSnapshotSlot, mixSnapshots, recallSnapshot]);

  const canToggleMixSnapshots = Boolean(mixSnapshots.A && mixSnapshots.B);

  return {
    // reports
    mixReport,
    eqReport,
    maskingReport,
    dynamicsReport,
    autoMixSnapshot,
    mixSnapshots,
    activeMixSnapshotSlot,
    canToggleMixSnapshots,
    snapshotControlsDisabled: Boolean(autoMixSnapshot),
    // panel visibility
    eqPanelOpen,
    setEqPanelOpen,
    maskingPanelOpen,
    setMaskingPanelOpen,
    dynamicsPanelOpen,
    setDynamicsPanelOpen,
    // gain
    runMixAnalysis,
    applyMixProposal,
    applyAllMixProposals,
    // eq
    runEqAnalysis,
    applyEqToTrack,
    applyAllEqProposals,
    // masking
    runMaskingAnalysis,
    applyMaskingFix,
    applyAllMaskingFixes,
    // dynamics
    runDynamicsAnalysis,
    applyDynamicsToTrack,
    applyMasterDynamics,
    applyAllDynamics,
    // loudness
    applyLoudnessPreset,
    clearLoudnessPreset,
    // buses
    autoBusSummary,
    applyAutoBusSetup,
    // auto mix
    previewAutoMix,
    acceptAutoMix,
    revertAutoMix,
    // mix snapshots
    saveMixSnapshot,
    applyMixSnapshot,
    toggleMixSnapshotAB,
  };
}
