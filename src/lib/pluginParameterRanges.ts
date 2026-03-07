export interface ParameterRange {
  min: number;
  max: number;
  unit: string;
}

export const PARAM_RANGES: Record<string, ParameterRange> = {
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

export function formatParameterLabel(parameterId: string): string {
  return parameterId.replace(/([A-Z])/g, ' $1').trim();
}
