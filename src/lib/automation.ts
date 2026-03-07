import type { AutomationLane, AutomationTarget, Track } from '../types/daw';
import { PARAM_RANGES } from './pluginParameterRanges';

export interface AutomationRange {
  min: number;
  max: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getAutomationRange(target: AutomationTarget, track: Track): AutomationRange {
  if (target.kind === 'trackVolume') return { min: 0, max: 1 };
  if (target.kind === 'trackPan') return { min: -1, max: 1 };

  const plugin = track.plugins.find((candidate) => candidate.id === target.pluginId);
  const pluginValue = plugin?.parameters[target.parameterId];
  const range = PARAM_RANGES[target.parameterId];
  if (range) return { min: range.min, max: range.max };
  if (typeof pluginValue === 'number') {
    const span = Math.max(1, Math.abs(pluginValue) * 2);
    return { min: pluginValue - span, max: pluginValue + span };
  }
  return { min: 0, max: 1 };
}

export function normalizeAutomationPoints(lane: AutomationLane, track: Track): AutomationLane {
  const { min, max } = getAutomationRange(lane.target, track);
  const points = lane.points
    .map((point) => ({
      time: Math.max(0, point.time),
      value: clamp(point.value, min, max),
    }))
    .sort((left, right) => left.time - right.time);

  return { ...lane, points };
}

export function evaluateAutomationValue(
  lane: AutomationLane,
  time: number,
  fallback: number,
): number {
  const points = lane.points;
  if (!points.length) return fallback;
  if (points.length === 1) return points[0].value;

  if (time <= points[0].time) return points[0].value;
  const lastPoint = points[points.length - 1];
  if (time >= lastPoint.time) return lastPoint.value;

  for (let i = 0; i < points.length - 1; i += 1) {
    const left = points[i];
    const right = points[i + 1];
    if (time >= left.time && time <= right.time) {
      const span = right.time - left.time;
      if (span <= 0) return right.value;
      const t = (time - left.time) / span;
      return left.value + (right.value - left.value) * t;
    }
  }
  return fallback;
}

export function resolveTrackAutomationAtTime(track: Track, time: number): Track {
  if (!track.automationLanes.length) return track;

  let volume = track.volume;
  let pan = track.pan;
  const pluginParamOverrides = new Map<string, Record<string, number>>();

  track.automationLanes.forEach((lane) => {
    if (!lane.points.length) return;
    if (lane.target.kind === 'trackVolume') {
      volume = evaluateAutomationValue(lane, time, volume);
      return;
    }
    if (lane.target.kind === 'trackPan') {
      pan = evaluateAutomationValue(lane, time, pan);
      return;
    }

    const target = lane.target;
    if (target.kind !== 'pluginParam') return;
    const plugin = track.plugins.find((candidate) => candidate.id === target.pluginId);
    if (!plugin) return;
    const fallbackValue = plugin.parameters[target.parameterId] ?? 0;
    const nextValue = evaluateAutomationValue(lane, time, fallbackValue);
    const existing = pluginParamOverrides.get(plugin.id) ?? { ...plugin.parameters };
    existing[target.parameterId] = nextValue;
    pluginParamOverrides.set(plugin.id, existing);
  });

  if (!pluginParamOverrides.size && volume === track.volume && pan === track.pan) {
    return track;
  }

  const plugins = pluginParamOverrides.size
    ? track.plugins.map((plugin) => {
      const parameters = pluginParamOverrides.get(plugin.id);
      return parameters ? { ...plugin, parameters } : plugin;
    })
    : track.plugins;

  return {
    ...track,
    volume,
    pan,
    plugins,
  };
}

export function automationTargetLabel(target: AutomationTarget, track: Track): string {
  if (target.kind === 'trackVolume') return 'Track Volume';
  if (target.kind === 'trackPan') return 'Track Pan';
  const plugin = track.plugins.find((candidate) => candidate.id === target.pluginId);
  const pluginLabel = plugin?.name ?? 'Plugin';
  return `${pluginLabel} · ${target.parameterId}`;
}

export function automationTargetKey(target: AutomationTarget): string {
  if (target.kind === 'trackVolume') return 'trackVolume';
  if (target.kind === 'trackPan') return 'trackPan';
  return `plugin:${target.pluginId}:${target.parameterId}`;
}
