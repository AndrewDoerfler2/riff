import type { PluginInstance, PluginType } from '../types/daw';

interface PluginCostProfile {
  cpuPercent: number;
  latencySamples: number;
}

const BASE_COST: Record<PluginType, PluginCostProfile> = {
  eq: { cpuPercent: 0.6, latencySamples: 0 },
  compressor: { cpuPercent: 1.2, latencySamples: 0 },
  reverb: { cpuPercent: 2.2, latencySamples: 0 },
  delay: { cpuPercent: 1.0, latencySamples: 0 },
  distortion: { cpuPercent: 2.1, latencySamples: 48 },
  chorus: { cpuPercent: 1.1, latencySamples: 24 },
  limiter: { cpuPercent: 1.4, latencySamples: 64 },
  gain: { cpuPercent: 0.2, latencySamples: 0 },
  autopan: { cpuPercent: 0.5, latencySamples: 0 },
  humRemover: { cpuPercent: 0.8, latencySamples: 32 },
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function estimatePluginPerformance(plugin: PluginInstance): PluginCostProfile {
  if (!plugin.enabled) return { cpuPercent: 0, latencySamples: 0 };

  const base = BASE_COST[plugin.type];
  let cpuPercent = base.cpuPercent;
  let latencySamples = base.latencySamples;

  switch (plugin.type) {
    case 'reverb':
      cpuPercent += (plugin.parameters.roomSize ?? 0.5) * 1.2;
      cpuPercent += (plugin.parameters.wet ?? 0.3) * 0.5;
      break;
    case 'delay':
      cpuPercent += (plugin.parameters.feedback ?? 0.3) * 0.8;
      cpuPercent += (plugin.parameters.wet ?? 0.3) * 0.4;
      break;
    case 'distortion':
      cpuPercent += (plugin.parameters.drive ?? 0.5) * 1.0;
      latencySamples += Math.round((plugin.parameters.mix ?? 0.5) * 16);
      break;
    case 'chorus':
      cpuPercent += (plugin.parameters.depth ?? 0.5) * 0.7;
      cpuPercent += (plugin.parameters.feedback ?? 0.2) * 0.3;
      latencySamples += Math.round((plugin.parameters.delay ?? 12) * 0.8);
      break;
    case 'compressor':
      cpuPercent += clamp(((plugin.parameters.ratio ?? 4) - 1) / 10, 0, 1) * 0.6;
      break;
    case 'limiter':
      cpuPercent += clamp(((plugin.parameters.gain ?? 0) + 6) / 12, 0, 1.5) * 0.5;
      break;
    case 'humRemover':
      cpuPercent += clamp((plugin.parameters.q ?? 12) / 24, 0.1, 1.5) * 0.3;
      latencySamples += Math.round(clamp((plugin.parameters.q ?? 12) / 24, 0.1, 1.5) * 28);
      break;
    default:
      break;
  }

  return {
    cpuPercent: round1(cpuPercent),
    latencySamples: Math.max(0, Math.round(latencySamples)),
  };
}

export function sumPluginPerformance(plugins: PluginInstance[]): PluginCostProfile {
  return plugins.reduce<PluginCostProfile>((acc, plugin) => {
    const cost = estimatePluginPerformance(plugin);
    return {
      cpuPercent: acc.cpuPercent + cost.cpuPercent,
      latencySamples: acc.latencySamples + cost.latencySamples,
    };
  }, { cpuPercent: 0, latencySamples: 0 });
}

export function formatCpuPercent(cpuPercent: number): string {
  return `${round1(cpuPercent).toFixed(1)}% CPU`;
}

export function formatLatency(latencySamples: number, sampleRate = 48000): string {
  if (latencySamples <= 0 || sampleRate <= 0) return '0.00 ms';
  const latencyMs = (latencySamples / sampleRate) * 1000;
  return `${latencyMs.toFixed(2)} ms`;
}
