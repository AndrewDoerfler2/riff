import React, { useEffect, useRef, useCallback } from 'react';
import { useDAW, useAudioEngineCtx, PLUGIN_DEFINITIONS } from '../context/DAWContext';
import type { Track, PluginType } from '../types/daw';
import MixAssistantPanel from './MixAssistantPanel';
import {
  estimatePluginPerformance,
  formatCpuPercent,
  formatLatency,
  sumPluginPerformance,
} from '../lib/pluginPerformance';

// ─── Meter animation constants ────────────────────────────────────────────────
const RISE = 1.0;   // instant rise
const DECAY = 0.88; // ~6 frames to drop by half

function meterColor(level: number): string {
  if (level > 0.85) return '#ff453a';
  if (level > 0.6)  return '#ffd60a';
  return '#30d158';
}

// ─── Channel Strip ────────────────────────────────────────────────────────────

interface StripProps {
  track: Track;
  meterLRef: React.RefObject<HTMLDivElement | null>;
  meterRRef: React.RefObject<HTMLDivElement | null>;
}

function ChannelStrip({ track, meterLRef, meterRRef }: StripProps) {
  const { state, dispatch } = useDAW();
  const hasSolo = state.tracks.some(t => t.soloed);
  const isAudible = !track.muted && (!hasSolo || track.soloed);
  const busTracks = state.tracks.filter(t => t.type === 'bus');

  return (
    <div
      className={`channel-strip ${!isAudible ? 'ch-muted' : ''} ${track.soloed ? 'ch-soloed' : ''}`}
      onClick={() => dispatch({ type: 'SELECT_TRACK', payload: track.id })}
      style={{ borderTop: `3px solid ${track.color}` }}
    >
      {/* Label + meter mode toggle */}
      <div className="ch-top-row">
        <div className="ch-label">{track.name}</div>
        <button
          className={`ch-mode-btn ${track.meterMode === 'pre' ? 'ch-mode-active' : ''}`}
          title="Toggle pre/post fader metering"
          onClick={e => {
            e.stopPropagation();
            dispatch({ type: 'SET_TRACK_METER_MODE', payload: { id: track.id, mode: track.meterMode === 'pre' ? 'post' : 'pre' } });
          }}
        >
          {track.meterMode === 'pre' ? 'PRE' : 'PST'}
        </button>
      </div>

      {/* Animated meters (L/R) */}
      <div className="ch-meters">
        <div className="meter-bar-wrap">
          <div ref={meterLRef} className="meter-bar" style={{ height: '0%', background: '#30d158' }} />
        </div>
        <div className="meter-bar-wrap">
          <div ref={meterRRef} className="meter-bar" style={{ height: '0%', background: '#30d158' }} />
        </div>
      </div>

      {/* Pan */}
      <div className="ch-pan-wrap">
        <span className="ch-control-label">Pan</span>
        <input
          type="range" className="ch-pan" min={-1} max={1} step={0.01}
          value={track.pan}
          onChange={e => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { pan: parseFloat(e.target.value) } } })}
          onClick={e => e.stopPropagation()}
        />
        <span className="ch-control-label">
          {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}
        </span>
      </div>

      {/* Arm / Mute / Solo */}
      <div className="ch-buttons">
        <button
          className={`ch-btn ch-arm ${track.armed ? 'armed' : ''}`}
          onClick={e => { e.stopPropagation(); dispatch({ type: 'ARM_TRACK', payload: { id: track.id, armed: !track.armed } }); }}
          title="Arm"
        >●</button>
        <button
          className={`ch-btn ch-mute ${track.muted ? 'muted' : ''}`}
          onClick={e => { e.stopPropagation(); dispatch({ type: 'MUTE_TRACK', payload: { id: track.id, muted: !track.muted } }); }}
          title="Mute"
        >M</button>
        <button
          className={`ch-btn ch-solo ${track.soloed ? 'soloed' : ''}`}
          onClick={e => { e.stopPropagation(); dispatch({ type: 'SOLO_TRACK', payload: { id: track.id, soloed: !track.soloed } }); }}
          title="Solo"
        >S</button>
      </div>

      {/* Bus route selector */}
      {track.type !== 'bus' && (
        <div className="ch-bus-wrap" onClick={e => e.stopPropagation()}>
          <span className="ch-control-label">Bus</span>
          <select
            className="ch-bus-select"
            value={track.busRouteId ?? ''}
            onChange={e => dispatch({
              type: 'SET_TRACK_BUS_ROUTE',
              payload: { id: track.id, busRouteId: e.target.value || undefined },
            })}
          >
            <option value="">Master</option>
            {busTracks.map(bt => (
              <option key={bt.id} value={bt.id}>{bt.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Fader */}
      <div className="ch-fader-wrap">
        <div className="ch-vol-display">{Math.round(track.volume * 100)}</div>
        <input
          type="range" className="ch-fader"
          min={0} max={1} step={0.01}
          value={track.volume}
          style={{ writingMode: 'vertical-lr' as React.CSSProperties['writingMode'] }}
          onChange={e => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, updates: { volume: parseFloat(e.target.value) } } })}
          onClick={e => e.stopPropagation()}
        />
      </div>

      <div className="ch-name-label" style={{ color: track.color }}>
        {track.name.length > 8 ? track.name.slice(0, 7) + '…' : track.name}
      </div>
    </div>
  );
}

// ─── Master Strip ─────────────────────────────────────────────────────────────

interface MasterStripProps {
  meterLRef: React.RefObject<HTMLDivElement | null>;
  meterRRef: React.RefObject<HTMLDivElement | null>;
}

function MasterStrip({ meterLRef, meterRRef }: MasterStripProps) {
  const { state, dispatch, makePlugin } = useDAW();
  const masterPerf = sumPluginPerformance(state.masterPlugins);

  const addMasterPlugin = (type: PluginType) => {
    dispatch({ type: 'ADD_MASTER_PLUGIN', payload: makePlugin(type) });
  };

  return (
    <div className="channel-strip master-strip">
      <div className="ch-label" style={{ color: '#ffd60a' }}>MASTER</div>

      {/* Animated meters */}
      <div className="ch-meters">
        <div className="meter-bar-wrap">
          <div ref={meterLRef} className="meter-bar" style={{ height: '0%', background: '#30d158' }} />
        </div>
        <div className="meter-bar-wrap">
          <div ref={meterRRef} className="meter-bar" style={{ height: '0%', background: '#30d158' }} />
        </div>
      </div>

      {/* Pan */}
      <div className="ch-pan-wrap">
        <span className="ch-control-label">Pan</span>
        <input type="range" className="ch-pan" min={-1} max={1} step={0.01}
          value={state.masterPan ?? 0}
          onChange={e => dispatch({ type: 'SET_MASTER_PAN', payload: parseFloat(e.target.value) })}
        />
      </div>

      {/* Fader */}
      <div className="ch-fader-wrap">
        <div className="ch-vol-display">{Math.round(state.masterVolume * 100)}</div>
        <input
          type="range" className="ch-fader"
          min={0} max={1} step={0.01}
          value={state.masterVolume}
          style={{ writingMode: 'vertical-lr' as React.CSSProperties['writingMode'] }}
          onChange={e => dispatch({ type: 'SET_MASTER_VOLUME', payload: parseFloat(e.target.value) })}
        />
      </div>

      <div className="ch-name-label" style={{ color: '#ffd60a' }}>Out</div>

      {/* Master plugin chain */}
      <div className="master-chain-area">
        <div className="master-chain-title">Master Chain</div>
        <div className="master-chain-metrics">
          <span>{formatCpuPercent(masterPerf.cpuPercent)}</span>
          <span>{formatLatency(masterPerf.latencySamples)}</span>
        </div>
        {state.masterPlugins.map(plugin => (
          <div key={plugin.id} className="master-plugin-item">
            <span
              className="master-plugin-dot"
              style={{ background: PLUGIN_DEFINITIONS[plugin.type]?.color ?? '#666' }}
            />
            <span className="master-plugin-name">{plugin.name}</span>
            <span className="master-plugin-metric">
              {formatCpuPercent(estimatePluginPerformance(plugin).cpuPercent)}
            </span>
            <button
              className={`master-plugin-bypass ${!plugin.enabled ? 'bypassed' : ''}`}
              title={plugin.enabled ? 'Bypass' : 'Enable'}
              onClick={() => dispatch({
                type: 'UPDATE_MASTER_PLUGIN',
                payload: { pluginId: plugin.id, updates: { enabled: !plugin.enabled } },
              })}
            >{plugin.enabled ? '●' : '○'}</button>
            <button
              className="master-plugin-remove"
              title="Remove"
              onClick={() => dispatch({ type: 'REMOVE_MASTER_PLUGIN', payload: plugin.id })}
            >✕</button>
          </div>
        ))}

        {/* Add plugin dropdown */}
        <select
          className="master-add-plugin"
          value=""
          onChange={e => { if (e.target.value) addMasterPlugin(e.target.value as PluginType); }}
        >
          <option value="">+ Add plugin</option>
          {(Object.keys(PLUGIN_DEFINITIONS) as PluginType[]).map(type => (
            <option key={type} value={type}>{PLUGIN_DEFINITIONS[type].name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Mixer ────────────────────────────────────────────────────────────────────

export default function Mixer() {
  const { state } = useDAW();
  const engine = useAudioEngineCtx();
  const { tracks } = state;

  // ── Meter refs ──────────────────────────────────────────────────────────────
  const meterRefsMap = useRef<Map<string, [React.RefObject<HTMLDivElement | null>, React.RefObject<HTMLDivElement | null>]>>(new Map());
  const masterMeterL = useRef<HTMLDivElement | null>(null);
  const masterMeterR = useRef<HTMLDivElement | null>(null);
  const levelHistory = useRef<Map<string, [number, number]>>(new Map());
  const masterLevelHistory = useRef<[number, number]>([0, 0]);
  const rafRef = useRef<number>(0);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Ensure ref pairs exist for every track
  tracks.forEach(track => {
    if (!meterRefsMap.current.has(track.id)) {
      meterRefsMap.current.set(track.id, [
        React.createRef<HTMLDivElement>(),
        React.createRef<HTMLDivElement>(),
      ]);
    }
  });

  const animate = useCallback(() => {
    const { isPlaying } = stateRef.current;

    stateRef.current.tracks.forEach(track => {
      const refs = meterRefsMap.current.get(track.id);
      if (!refs) return;
      const [leftRef, rightRef] = refs;

      let [l, r] = isPlaying ? engine.getTrackLevel(track.id, track.meterMode) : [0, 0];
      l = Math.min(1, l * 4);
      r = Math.min(1, r * 4);

      const prev = levelHistory.current.get(track.id) ?? [0, 0];
      const nl = l > prev[0] ? l * RISE : prev[0] * DECAY;
      const nr = r > prev[1] ? r * RISE : prev[1] * DECAY;
      levelHistory.current.set(track.id, [nl, nr]);

      if (leftRef.current) {
        leftRef.current.style.height = `${nl * 100}%`;
        leftRef.current.style.background = meterColor(nl);
      }
      if (rightRef.current) {
        rightRef.current.style.height = `${nr * 100}%`;
        rightRef.current.style.background = meterColor(nr);
      }
    });

    let [ml, mr] = isPlaying ? engine.getMasterLevel() : [0, 0];
    ml = Math.min(1, ml * 4);
    mr = Math.min(1, mr * 4);
    const [pml, pmr] = masterLevelHistory.current;
    const nml = ml > pml ? ml * RISE : pml * DECAY;
    const nmr = mr > pmr ? mr * RISE : pmr * DECAY;
    masterLevelHistory.current = [nml, nmr];
    if (masterMeterL.current) {
      masterMeterL.current.style.height = `${nml * 100}%`;
      masterMeterL.current.style.background = meterColor(nml);
    }
    if (masterMeterR.current) {
      masterMeterR.current.style.height = `${nmr * 100}%`;
      masterMeterR.current.style.background = meterColor(nmr);
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [engine]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  return (
    <div className="mixer">
      <div className="panel-header">
        <span className="panel-title">🎚 Mixer</span>
        <span className="panel-subtitle">
          {tracks.length} tracks
          {tracks.filter(t => t.soloed).length > 0 ? ' · ⚡ Solo active' : ''}
          {tracks.some(t => t.busRouteId) ? ' · Bus routing' : ''}
        </span>
      </div>

      <MixAssistantPanel />

      <div className="mixer-strips">
        {tracks.map(track => {
          const refs = meterRefsMap.current.get(track.id)!;
          return (
            <ChannelStrip
              key={track.id}
              track={track}
              meterLRef={refs[0]}
              meterRRef={refs[1]}
            />
          );
        })}
        <MasterStrip meterLRef={masterMeterL as React.RefObject<HTMLDivElement | null>} meterRRef={masterMeterR as React.RefObject<HTMLDivElement | null>} />
      </div>
    </div>
  );
}
