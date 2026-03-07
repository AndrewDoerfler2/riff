import { describe, expect, it } from 'vitest';
import {
  estimatePluginPerformance,
  sumPluginPerformance,
  formatCpuPercent,
  formatLatency,
} from '../../src/lib/pluginPerformance';
import type { PluginInstance } from '../../src/types/daw';

function makePlugin(
  type: PluginInstance['type'],
  parameters: Record<string, number> = {},
  enabled = true,
): PluginInstance {
  return { id: `test-${type}`, type, name: type, enabled, parameters };
}

describe('estimatePluginPerformance', () => {
  it('returns zero cost for a bypassed plugin', () => {
    const plugin = makePlugin('reverb', {}, false);
    const perf = estimatePluginPerformance(plugin);
    expect(perf.cpuPercent).toBe(0);
    expect(perf.latencySamples).toBe(0);
  });

  it('returns non-zero base cost for enabled plugins', () => {
    const types: PluginInstance['type'][] = [
      'gain', 'eq', 'compressor', 'limiter', 'delay', 'reverb',
      'distortion', 'chorus', 'autopan', 'humRemover',
    ];
    for (const type of types) {
      const perf = estimatePluginPerformance(makePlugin(type));
      expect(perf.cpuPercent).toBeGreaterThan(0);
    }
  });

  it('reverb scales CPU with room size', () => {
    const small = estimatePluginPerformance(makePlugin('reverb', { roomSize: 0.1, wet: 0.3 }));
    const large = estimatePluginPerformance(makePlugin('reverb', { roomSize: 0.9, wet: 0.3 }));
    expect(large.cpuPercent).toBeGreaterThan(small.cpuPercent);
  });

  it('delay scales CPU with feedback', () => {
    const light = estimatePluginPerformance(makePlugin('delay', { feedback: 0.1, wet: 0.3 }));
    const heavy = estimatePluginPerformance(makePlugin('delay', { feedback: 0.8, wet: 0.3 }));
    expect(heavy.cpuPercent).toBeGreaterThan(light.cpuPercent);
  });

  it('distortion adds latency samples', () => {
    const perf = estimatePluginPerformance(makePlugin('distortion', { drive: 0.5, mix: 0.5 }));
    expect(perf.latencySamples).toBeGreaterThan(0);
  });

  it('chorus adds latency proportional to delay parameter', () => {
    const short = estimatePluginPerformance(makePlugin('chorus', { delay: 8, depth: 0.3, feedback: 0.1 }));
    const long = estimatePluginPerformance(makePlugin('chorus', { delay: 24, depth: 0.3, feedback: 0.1 }));
    expect(long.latencySamples).toBeGreaterThan(short.latencySamples);
  });

  it('never returns negative latency samples', () => {
    const types: PluginInstance['type'][] = ['gain', 'eq', 'compressor', 'autopan'];
    for (const type of types) {
      const perf = estimatePluginPerformance(makePlugin(type));
      expect(perf.latencySamples).toBeGreaterThanOrEqual(0);
    }
  });

  it('distortion costs more than gain', () => {
    const gainPerf = estimatePluginPerformance(makePlugin('gain'));
    const distPerf = estimatePluginPerformance(makePlugin('distortion', { drive: 0.5 }));
    expect(distPerf.cpuPercent).toBeGreaterThan(gainPerf.cpuPercent);
  });
});

describe('sumPluginPerformance', () => {
  it('returns zero totals for an empty chain', () => {
    const total = sumPluginPerformance([]);
    expect(total.cpuPercent).toBe(0);
    expect(total.latencySamples).toBe(0);
  });

  it('sums CPU and latency across a multi-plugin chain', () => {
    const plugins = [
      makePlugin('gain'),
      makePlugin('compressor', { threshold: -18, ratio: 4 }),
      makePlugin('reverb', { roomSize: 0.5, wet: 0.3 }),
    ];
    const total = sumPluginPerformance(plugins);
    const individual = plugins.reduce((acc, p) => {
      const c = estimatePluginPerformance(p);
      return { cpuPercent: acc.cpuPercent + c.cpuPercent, latencySamples: acc.latencySamples + c.latencySamples };
    }, { cpuPercent: 0, latencySamples: 0 });

    expect(total.cpuPercent).toBeCloseTo(individual.cpuPercent, 5);
    expect(total.latencySamples).toBe(individual.latencySamples);
  });

  it('bypassed plugins contribute zero to chain total', () => {
    const active = makePlugin('reverb', { roomSize: 0.8, wet: 0.4 }, true);
    const bypassed = makePlugin('reverb', { roomSize: 0.8, wet: 0.4 }, false);

    const withBypassed = sumPluginPerformance([active, bypassed]);
    const withoutBypassed = sumPluginPerformance([active]);
    expect(withBypassed.cpuPercent).toBeCloseTo(withoutBypassed.cpuPercent, 5);
  });
});

describe('formatCpuPercent', () => {
  it('formats zero correctly', () => {
    expect(formatCpuPercent(0)).toBe('0.0% CPU');
  });

  it('formats a typical CPU value', () => {
    expect(formatCpuPercent(2.3)).toBe('2.3% CPU');
  });

  it('rounds to one decimal place', () => {
    expect(formatCpuPercent(1.25)).toBe('1.3% CPU');
  });
});

describe('formatLatency', () => {
  it('returns 0.00 ms for zero samples', () => {
    expect(formatLatency(0)).toBe('0.00 ms');
  });

  it('calculates ms correctly for known sample count (48kHz)', () => {
    // 480 samples at 48000 Hz = 10ms
    expect(formatLatency(480, 48000)).toBe('10.00 ms');
  });

  it('uses 48000 as default sample rate', () => {
    // 960 samples at 48000 Hz = 20ms
    expect(formatLatency(960)).toBe('20.00 ms');
  });
});
