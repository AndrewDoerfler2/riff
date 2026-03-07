import { useCallback, useEffect, useState } from 'react';
import { useDAW, PLUGIN_DEFINITIONS } from '../context/DAWContext';
import type { PluginInstance, PluginType } from '../types/daw';

const PARAM_RANGES: Record<string, { min: number; max: number; unit: string }> = {
  low: { min: -18, max: 18, unit: 'dB' },
  mid: { min: -18, max: 18, unit: 'dB' },
  high: { min: -18, max: 18, unit: 'dB' },
  lowFreq: { min: 20, max: 500, unit: 'Hz' },
  midFreq: { min: 200, max: 8000, unit: 'Hz' },
  highFreq: { min: 2000, max: 20000, unit: 'Hz' },
  threshold: { min: -60, max: 0, unit: 'dB' },
  ratio: { min: 1, max: 20, unit: ':1' },
  attack: { min: 0.1, max: 200, unit: 'ms' },
  release: { min: 1, max: 2000, unit: 'ms' },
  knee: { min: 0, max: 30, unit: 'dB' },
  makeupGain: { min: -12, max: 24, unit: 'dB' },
  roomSize: { min: 0, max: 1, unit: '' },
  dampening: { min: 0, max: 1, unit: '' },
  wet: { min: 0, max: 1, unit: '' },
  dry: { min: 0, max: 1, unit: '' },
  preDelay: { min: 0, max: 100, unit: 'ms' },
  time: { min: 0, max: 2, unit: 's' },
  feedback: { min: 0, max: 0.99, unit: '' },
  drive: { min: 0, max: 1, unit: '' },
  tone: { min: 0, max: 1, unit: '' },
  mix: { min: 0, max: 1, unit: '' },
  rate: { min: 0.1, max: 10, unit: 'Hz' },
  depth: { min: 0, max: 1, unit: '' },
  delay: { min: 0, max: 50, unit: 'ms' },
  phase: { min: 0, max: 360, unit: '°' },
  gain: { min: -40, max: 40, unit: 'dB' },
  trim: { min: -12, max: 12, unit: 'dB' },
  sync: { min: 0, max: 1, unit: '' },
  humFreq: { min: 50, max: 60, unit: 'Hz' },
  q: { min: 4, max: 30, unit: '' },
  reduction: { min: 6, max: 30, unit: 'dB' },
};

const EQ_PRESETS: Array<{ label: string; values: Record<string, number> }> = [
  { label: 'Singer + Instrument', values: { low: -2, mid: 2.5, high: 3, lowFreq: 100, midFreq: 2400, highFreq: 12000 } },
  { label: 'Singer + Band', values: { low: -4, mid: 3.5, high: 2, lowFreq: 120, midFreq: 3100, highFreq: 10000 } },
  { label: 'Pop', values: { low: 1.5, mid: 0.5, high: 2.5, lowFreq: 90, midFreq: 1800, highFreq: 12500 } },
  { label: 'Rock', values: { low: 2.5, mid: 1.5, high: 1, lowFreq: 110, midFreq: 2200, highFreq: 9000 } },
  { label: 'Jazz', values: { low: 0.5, mid: -1, high: 1.5, lowFreq: 80, midFreq: 1400, highFreq: 11000 } },
];

const PLUGIN_PRESETS: Partial<Record<PluginType, Array<{ label: string; values: Record<string, number> }>>> = {
  compressor: [
    { label: 'Vocal Glue', values: { threshold: -20, ratio: 3.5, attack: 18, release: 130, knee: 8, makeupGain: 2 } },
    { label: 'Drum Smash', values: { threshold: -26, ratio: 8, attack: 8, release: 90, knee: 4, makeupGain: 4 } },
    { label: 'Gentle Bus', values: { threshold: -14, ratio: 2, attack: 30, release: 220, knee: 10, makeupGain: 1 } },
  ],
  reverb: [
    { label: 'Tight Vocal Room', values: { roomSize: 0.28, dampening: 0.55, wet: 0.18, dry: 0.82, preDelay: 18 } },
    { label: 'Wide Plate', values: { roomSize: 0.62, dampening: 0.34, wet: 0.28, dry: 0.72, preDelay: 24 } },
    { label: 'Large Hall', values: { roomSize: 0.86, dampening: 0.22, wet: 0.34, dry: 0.66, preDelay: 34 } },
  ],
  delay: [
    { label: 'Slapback', values: { time: 0.11, feedback: 0.18, wet: 0.2, dry: 0.8, sync: 0 } },
    { label: 'Quarter Echo', values: { time: 0.32, feedback: 0.36, wet: 0.24, dry: 0.76, sync: 1 } },
    { label: 'Ambient Tail', values: { time: 0.48, feedback: 0.62, wet: 0.34, dry: 0.66, sync: 0 } },
  ],
  distortion: [
    { label: 'Edge', values: { drive: 0.28, tone: 0.68, mix: 0.24 } },
    { label: 'Crunch', values: { drive: 0.52, tone: 0.58, mix: 0.42 } },
    { label: 'Fuzz', values: { drive: 0.84, tone: 0.42, mix: 0.7 } },
  ],
  chorus: [
    { label: 'Subtle Width', values: { rate: 0.35, depth: 0.22, delay: 14, feedback: 0.08, mix: 0.18 } },
    { label: 'Shimmer', values: { rate: 0.62, depth: 0.38, delay: 18, feedback: 0.14, mix: 0.32 } },
    { label: 'Swirl', values: { rate: 1.3, depth: 0.65, delay: 24, feedback: 0.22, mix: 0.48 } },
  ],
  limiter: [
    { label: 'Safety', values: { threshold: -1.2, release: 120, gain: 0 } },
    { label: 'Loud Master', values: { threshold: -4, release: 80, gain: 2.5 } },
  ],
  gain: [
    { label: 'Lift', values: { gain: 2, trim: 0 } },
    { label: 'Pad', values: { gain: -6, trim: 0 } },
    { label: 'Drive Stage', values: { gain: 8, trim: -2 } },
  ],
  autopan: [
    { label: 'Slow Drift', values: { rate: 0.18, depth: 0.25, phase: 0, mix: 0.35 } },
    { label: 'Wide Motion', values: { rate: 0.54, depth: 0.58, phase: 90, mix: 0.5 } },
    { label: 'Spin', values: { rate: 1.6, depth: 0.85, phase: 180, mix: 0.72 } },
  ],
  humRemover: [
    { label: 'US 60Hz', values: { humFreq: 60, q: 16, reduction: 18 } },
    { label: 'EU 50Hz', values: { humFreq: 50, q: 16, reduction: 18 } },
    { label: 'Aggressive', values: { humFreq: 60, q: 22, reduction: 24 } },
  ],
};

const PLUGIN_CATEGORIES: Array<{ label: string; types: PluginType[] }> = [
  { label: 'Dynamics', types: ['compressor', 'limiter', 'gain'] },
  { label: 'EQ & Filter', types: ['eq', 'humRemover'] },
  { label: 'Time / Space', types: ['reverb', 'delay', 'chorus'] },
  { label: 'Distortion', types: ['distortion'] },
  { label: 'Modulation', types: ['autopan'] },
];

function ParamKnob({ name, value, min = 0, max = 1, unit = '', onChange }: {
  name: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const displayVal = Number.isInteger(value) ? value : value.toFixed(2);

  return (
    <div className="param-knob" title={`${name}: ${displayVal}${unit}`}>
      <input
        type="range"
        className="param-slider"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
      <div className="param-name">{name}</div>
      <div className="param-value">{displayVal}{unit}</div>
    </div>
  );
}

function EqCurve({ plugin }: { plugin: PluginInstance }) {
  const width = 520;
  const height = 170;
  const low = plugin.parameters.low ?? 0;
  const mid = plugin.parameters.mid ?? 0;
  const high = plugin.parameters.high ?? 0;
  const points = Array.from({ length: 64 }, (_, idx) => {
    const t = idx / 63;
    const bass = Math.exp(-Math.pow((t - 0.18) / 0.16, 2)) * low;
    const mids = Math.exp(-Math.pow((t - 0.52) / 0.18, 2)) * mid;
    const treble = Math.exp(-Math.pow((t - 0.82) / 0.14, 2)) * high;
    const db = bass + mids + treble;
    const y = height / 2 - db * 3.4;
    const x = t * width;
    return `${x},${Math.max(12, Math.min(height - 12, y))}`;
  }).join(' ');

  return (
    <div className="eq-curve-panel">
      <div className="eq-curve-labels">
        <span>30Hz</span>
        <span>120Hz</span>
        <span>1kHz</span>
        <span>8kHz</span>
        <span>18kHz</span>
      </div>
      <svg className="eq-curve-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="eq-axis-line" />
        {[0.2, 0.4, 0.6, 0.8].map(marker => (
          <line
            key={marker}
            x1={marker * width}
            y1="0"
            x2={marker * width}
            y2={height}
            className="eq-grid-line"
          />
        ))}
        <polyline points={points} className="eq-curve-path" />
      </svg>
    </div>
  );
}

/** Static per-plugin-type labels and optional fixed param lists.
 *  When `params` is omitted the editor falls back to `def.params`.
 *  The `eq` type is handled separately due to its custom EqCurve section. */
interface PluginEditorConfig {
  presetLabel: string;
  paramsLabel: string;
  params?: string[];
}
const PLUGIN_EDITOR_CONFIGS: Partial<Record<PluginType, PluginEditorConfig>> = {
  compressor:  { presetLabel: 'Compression Modes', paramsLabel: 'Dynamics', params: ['threshold', 'ratio', 'attack', 'release', 'knee', 'makeupGain'] },
  limiter:     { presetLabel: 'Limiter Modes',      paramsLabel: 'Dynamics', params: ['threshold', 'release', 'gain'] },
  reverb:      { presetLabel: 'Space Designer',     paramsLabel: 'Room Shape' },
  delay:       { presetLabel: 'Space Designer',     paramsLabel: 'Echo Shape' },
  chorus:      { presetLabel: 'Space Designer',     paramsLabel: 'Modulation Shape' },
  distortion:  { presetLabel: 'Character',          paramsLabel: 'Controls' },
  gain:        { presetLabel: 'Character',          paramsLabel: 'Controls' },
  autopan:     { presetLabel: 'Character',          paramsLabel: 'Controls' },
  humRemover:  { presetLabel: 'Character',          paramsLabel: 'Controls' },
};

function PluginEditor({ plugin, trackId }: { plugin: PluginInstance; trackId: string }) {
  const { state, dispatch } = useDAW();
  const def = PLUGIN_DEFINITIONS[plugin.type];
  const [customPresetName, setCustomPresetName] = useState('');
  const customPresets = state.pluginPresets[plugin.type] ?? [];

  useEffect(() => {
    setCustomPresetName('');
  }, [plugin.id, plugin.type]);

  const updatePlugin = useCallback((updates: Partial<PluginInstance>) => {
    dispatch({
      type: 'UPDATE_PLUGIN',
      payload: {
        trackId,
        pluginId: plugin.id,
        updates,
      },
    });
  }, [dispatch, plugin.id, trackId]);

  const updateParam = useCallback((paramId: string, value: number) => {
    updatePlugin({ parameters: { ...plugin.parameters, [paramId]: value } });
  }, [plugin.parameters, updatePlugin]);

  const applyPreset = useCallback((values: Record<string, number>) => {
    updatePlugin({ parameters: { ...plugin.parameters, ...values } });
  }, [plugin.parameters, updatePlugin]);

  const saveCustomPreset = useCallback(() => {
    const normalizedName = customPresetName.trim();
    if (!normalizedName) return;
    dispatch({
      type: 'SAVE_PLUGIN_PRESET',
      payload: {
        pluginType: plugin.type,
        name: normalizedName,
        parameters: { ...plugin.parameters },
      },
    });
    setCustomPresetName('');
  }, [customPresetName, dispatch, plugin.parameters, plugin.type]);

  const deleteCustomPreset = useCallback((presetId: string) => {
    dispatch({
      type: 'DELETE_PLUGIN_PRESET',
      payload: { pluginType: plugin.type, presetId },
    });
  }, [dispatch, plugin.type]);

  const renderParameter = useCallback((paramId: string) => {
    const range = PARAM_RANGES[paramId] ?? { min: 0, max: 1, unit: '' };
    return (
      <ParamKnob
        key={paramId}
        name={paramId.replace(/([A-Z])/g, ' $1').trim()}
        value={plugin.parameters[paramId] ?? range.min}
        min={range.min}
        max={range.max}
        unit={range.unit}
        onChange={value => updateParam(paramId, value)}
      />
    );
  }, [plugin.parameters, updateParam]);

  const presetButtons = PLUGIN_PRESETS[plugin.type];

  const renderPluginSpecificEditor = () => {
    // EQ gets a custom curve + fixed preset/param sections
    if (plugin.type === 'eq') {
      return (
        <>
          <EqCurve plugin={plugin} />
          <div className="plugin-editor-section">
            <div className="plugin-editor-label">Auto EQ</div>
            <div className="plugin-preset-grid">
              {EQ_PRESETS.map(preset => (
                <button key={preset.label} className="plugin-preset-btn" onClick={() => applyPreset(preset.values)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="plugin-editor-section">
            <div className="plugin-editor-label">Tone Stack</div>
            <div className="plugin-editor-controls">
              {['low', 'mid', 'high', 'lowFreq', 'midFreq', 'highFreq'].map(renderParameter)}
            </div>
          </div>
        </>
      );
    }

    // All other plugin types share the same preset-section + params-section layout.
    // Config drives the labels; params falls back to def.params when not specified.
    const cfg = PLUGIN_EDITOR_CONFIGS[plugin.type];
    const paramList = cfg?.params ?? def.params;
    return (
      <>
        {presetButtons && cfg && (
          <div className="plugin-editor-section">
            <div className="plugin-editor-label">{cfg.presetLabel}</div>
            <div className="plugin-preset-grid">
              {presetButtons.map(preset => (
                <button key={preset.label} className="plugin-preset-btn" onClick={() => applyPreset(preset.values)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="plugin-editor-section">
          <div className="plugin-editor-label">{cfg?.paramsLabel ?? 'Parameters'}</div>
          <div className="plugin-editor-controls">{paramList.map(renderParameter)}</div>
        </div>
      </>
    );
  };

  return (
    <div className="plugin-editor-pane">
      <div className="plugin-editor-head">
        <div className="plugin-editor-name">
          <div className="plugin-color-dot" style={{ background: def.color }} />
          <span>{plugin.name}</span>
        </div>
        <span className="plugin-editor-state">{plugin.enabled ? 'Live' : 'Bypassed'}</span>
      </div>

      {renderPluginSpecificEditor()}

      <div className="plugin-editor-section">
        <div className="plugin-editor-label">Saved Presets</div>
        <div className="plugin-custom-preset-save">
          <input
            className="plugin-custom-preset-input"
            value={customPresetName}
            onChange={(event) => setCustomPresetName(event.target.value)}
            placeholder={`Save ${def.name} preset`}
            maxLength={40}
          />
          <button
            className="plugin-custom-preset-save-btn"
            onClick={saveCustomPreset}
            disabled={!customPresetName.trim()}
          >
            Save Current
          </button>
        </div>
        {customPresets.length === 0 ? (
          <div className="plugin-custom-presets-empty">
            No saved presets yet
          </div>
        ) : (
          <div className="plugin-custom-presets-list">
            {customPresets.map((preset) => (
              <div key={preset.id} className="plugin-custom-preset-item">
                <span className="plugin-custom-preset-name">{preset.name}</span>
                <div className="plugin-custom-preset-actions">
                  <button className="plugin-custom-preset-load-btn" onClick={() => applyPreset(preset.parameters)}>
                    Load
                  </button>
                  <button className="plugin-custom-preset-delete-btn" onClick={() => deleteCustomPreset(preset.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PluginSlot({ plugin, active, index, total, onSelect, onRemove, onToggle, onMoveUp, onMoveDown }: {
  plugin: PluginInstance;
  active: boolean;
  index: number;
  total: number;
  onSelect: () => void;
  onRemove: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const def = PLUGIN_DEFINITIONS[plugin.type];

  return (
    <div className={`plugin-slot ${plugin.enabled ? 'enabled' : 'disabled'} ${active ? 'plugin-slot-active' : ''}`}>
      <div className="plugin-header" onClick={onSelect}>
        <div className="plugin-reorder-btns">
          <button
            className="plugin-reorder-btn"
            onClick={e => { e.stopPropagation(); onMoveUp(); }}
            disabled={index === 0}
            title="Move up in signal chain"
          >▲</button>
          <button
            className="plugin-reorder-btn"
            onClick={e => { e.stopPropagation(); onMoveDown(); }}
            disabled={index === total - 1}
            title="Move down in signal chain"
          >▼</button>
        </div>
        <div className="plugin-color-dot" style={{ background: def.color }} />
        <button
          className={`plugin-power ${plugin.enabled ? 'on' : 'off'}`}
          onClick={e => { e.stopPropagation(); onToggle(); }}
          title={plugin.enabled ? 'Bypass' : 'Enable'}
        >
          ⏻
        </button>
        <span className="plugin-name">{plugin.name}</span>
        <button
          className="plugin-edit-btn"
          onClick={e => { e.stopPropagation(); onSelect(); }}
        >
          Edit
        </button>
        <button
          className="plugin-remove"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="Remove plugin"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function PluginRack() {
  const { state, dispatch, makePlugin } = useDAW();
  const { pluginRackTrackId, tracks } = state;
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

  const track = tracks.find(t => t.id === pluginRackTrackId);
  const selectedPlugin = track?.plugins.find(plugin => plugin.id === selectedPluginId) ?? track?.plugins[0] ?? null;

  useEffect(() => {
    if (!track?.plugins.length) {
      setSelectedPluginId(null);
      return;
    }
    if (!selectedPluginId || !track.plugins.some(plugin => plugin.id === selectedPluginId)) {
      setSelectedPluginId(track.plugins[0]?.id ?? null);
    }
  }, [selectedPluginId, track]);

  const addPlugin = useCallback((type: PluginType) => {
    if (!pluginRackTrackId) return;
    const plugin = makePlugin(type);
    dispatch({ type: 'ADD_PLUGIN', payload: { trackId: pluginRackTrackId, plugin } });
    setSelectedPluginId(plugin.id);
    setShowAddMenu(false);
  }, [pluginRackTrackId, makePlugin, dispatch]);

  const removePlugin = useCallback((pluginId: string) => {
    if (!pluginRackTrackId) return;
    dispatch({ type: 'REMOVE_PLUGIN', payload: { trackId: pluginRackTrackId, pluginId } });
  }, [pluginRackTrackId, dispatch]);

  const togglePlugin = useCallback((plugin: PluginInstance) => {
    if (!pluginRackTrackId) return;
    dispatch({
      type: 'UPDATE_PLUGIN',
      payload: {
        trackId: pluginRackTrackId,
        pluginId: plugin.id,
        updates: { enabled: !plugin.enabled },
      },
    });
  }, [pluginRackTrackId, dispatch]);

  const movePlugin = useCallback((fromIndex: number, toIndex: number) => {
    if (!pluginRackTrackId) return;
    dispatch({
      type: 'REORDER_PLUGIN',
      payload: { trackId: pluginRackTrackId, fromIndex, toIndex },
    });
  }, [pluginRackTrackId, dispatch]);

  if (!track) {
    return (
      <div className="plugin-rack empty-rack">
        <div className="panel-header">
          <span className="panel-title">🎛 Plugin Rack</span>
        </div>
        <div className="rack-empty">
          <span>Click <strong>FX</strong> on any track to open its plugin rack</span>
        </div>
      </div>
    );
  }

  return (
    <div className="plugin-rack">
      <div className="panel-header">
        <span className="panel-title">🎛 Plugin Rack</span>
        <div className="rack-track-info">
          <div className="rack-track-dot" style={{ background: track.color }} />
          <span className="rack-track-name">{track.name}</span>
        </div>
        <span className="plugin-live-note">Live edits during playback</span>
        <button
          className="add-plugin-btn"
          onClick={() => setShowAddMenu(!showAddMenu)}
        >
          + Add Plugin
        </button>
      </div>

      {showAddMenu && (
        <div className="add-plugin-menu">
          {PLUGIN_CATEGORIES.map(cat => (
            <div key={cat.label} className="plugin-category">
              <div className="plugin-category-label">{cat.label}</div>
              <div className="plugin-category-items">
                {cat.types.map(type => (
                  <button
                    key={type}
                    className="add-plugin-item"
                    style={{ borderLeft: `3px solid ${PLUGIN_DEFINITIONS[type].color}` }}
                    onClick={() => addPlugin(type)}
                  >
                    {PLUGIN_DEFINITIONS[type].name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="plugin-rack-body">
        <div className="plugin-slots">
          {track.plugins.length === 0 ? (
            <div className="rack-empty">
              <span>No plugins inserted</span>
              <p>Click <strong>+ Add Plugin</strong> to insert effects</p>
            </div>
          ) : (
            track.plugins.map((plugin, idx) => (
              <PluginSlot
                key={plugin.id}
                plugin={plugin}
                active={selectedPlugin?.id === plugin.id}
                index={idx}
                total={track.plugins.length}
                onSelect={() => setSelectedPluginId(plugin.id)}
                onRemove={() => removePlugin(plugin.id)}
                onToggle={() => togglePlugin(plugin)}
                onMoveUp={() => movePlugin(idx, idx - 1)}
                onMoveDown={() => movePlugin(idx, idx + 1)}
              />
            ))
          )}
        </div>

        <div className="plugin-editor-shell">
          {selectedPlugin ? (
            <PluginEditor plugin={selectedPlugin} trackId={track.id} />
          ) : (
            <div className="plugin-editor-empty">
              <span>Select a plugin to edit it</span>
            </div>
          )}
        </div>
      </div>

      {track.plugins.length > 0 && (
        <div className="rack-chain-note">
          Signal chain: Input → {track.plugins.map(p => p.name).join(' → ')} → Output
        </div>
      )}
    </div>
  );
}
