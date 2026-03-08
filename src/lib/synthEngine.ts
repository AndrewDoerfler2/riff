import type { Instrument, NoteEvent } from '../types/daw';
import { midiToFrequency } from './noteGenerators';
import { createNoiseBuffer } from './drumSynth';

// ─── Instrument Palette ───────────────────────────────────────────────────────

interface InstrumentPalette {
  oscillators: Array<{ type: OscillatorType; gain: number; detune?: number }>;
  filterType: BiquadFilterType;
  filterFrequency: number;
  filterQ?: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gain: number;
  stereoWidth?: number;
  vibratoRate?: number;
  vibratoDepth?: number;
  transientNoise?: number;
  reverbSend?: number;
}

export function isLegatoBiasedInstrument(instrument: Instrument) {
  return instrument === 'strings'
    || instrument === 'violin'
    || instrument === 'cello'
    || instrument === 'flute'
    || instrument === 'clarinet'
    || instrument === 'saxophone'
    || instrument === 'trumpet'
    || instrument === 'trombone'
    || instrument === 'choir'
    || instrument === 'organ'
    || instrument === 'synth-pad';
}

export function calculateLayerTimingOffset(instrument: Instrument, duration: number) {
  const swingWidth = instrument === 'drums'
    ? 0.002
    : isLegatoBiasedInstrument(instrument)
      ? 0.0015
      : duration < 0.18
        ? 0.002
        : 0.003;
  return (Math.random() - 0.5) * swingWidth;
}

export function shapeRenderedDuration(
  note: NoteEvent,
  nextNote: NoteEvent | undefined,
  instrument: Instrument,
  secondsPerBeat: number,
) {
  const baseDuration = Math.max(0.1, note.durationBeats * secondsPerBeat);
  const nextGap = nextNote ? (nextNote.startBeats - note.startBeats) * secondsPerBeat : null;
  if (nextGap == null || nextGap <= 0) return baseDuration;

  if (instrument === 'bass') {
    return Math.max(baseDuration, Math.min(nextGap * 0.9, baseDuration + 0.12));
  }

  if (isLegatoBiasedInstrument(instrument)) {
    return Math.max(baseDuration, Math.min(nextGap * 0.96, baseDuration + Math.min(0.32, nextGap * 0.4)));
  }

  if (instrument === 'guitar-acoustic' || instrument === 'guitar-electric' || instrument === 'piano') {
    return Math.max(baseDuration, Math.min(nextGap * 0.74, baseDuration + 0.05));
  }

  return baseDuration;
}

function instrumentPalette(instrument: Instrument): InstrumentPalette {
  const palettes: Partial<Record<Instrument, InstrumentPalette>> = {
    bass: { oscillators: [{ type: 'triangle', gain: 0.75 }, { type: 'sine', gain: 0.25, detune: -5 }], filterType: 'lowpass', filterFrequency: 520, filterQ: 0.8, attack: 0.008, decay: 0.16, sustain: 0.58, release: 0.12, gain: 0.36, stereoWidth: 0.04, transientNoise: 0.02, reverbSend: 0.03 },
    piano: { oscillators: [{ type: 'triangle', gain: 0.6 }, { type: 'sine', gain: 0.2, detune: 4 }, { type: 'triangle', gain: 0.2, detune: -3 }], filterType: 'lowpass', filterFrequency: 3000, filterQ: 0.7, attack: 0.004, decay: 0.22, sustain: 0.18, release: 0.28, gain: 0.18, stereoWidth: 0.22, transientNoise: 0.05, reverbSend: 0.16 },
    organ: { oscillators: [{ type: 'square', gain: 0.5 }, { type: 'sine', gain: 0.25, detune: 8 }, { type: 'triangle', gain: 0.25, detune: -8 }], filterType: 'lowpass', filterFrequency: 2200, filterQ: 0.6, attack: 0.012, decay: 0.05, sustain: 0.78, release: 0.2, gain: 0.14, stereoWidth: 0.18, vibratoRate: 5.5, vibratoDepth: 8, reverbSend: 0.12 },
    vibraphone: { oscillators: [{ type: 'sine', gain: 0.78 }, { type: 'triangle', gain: 0.22, detune: 6 }], filterType: 'bandpass', filterFrequency: 1600, filterQ: 2.2, attack: 0.004, decay: 0.32, sustain: 0.08, release: 0.45, gain: 0.12, stereoWidth: 0.24, vibratoRate: 5.8, vibratoDepth: 5, reverbSend: 0.2 },
    'guitar-acoustic': { oscillators: [{ type: 'triangle', gain: 0.55 }, { type: 'sawtooth', gain: 0.2, detune: 5 }, { type: 'triangle', gain: 0.25, detune: -4 }], filterType: 'bandpass', filterFrequency: 1900, filterQ: 1.8, attack: 0.003, decay: 0.15, sustain: 0.12, release: 0.2, gain: 0.17, stereoWidth: 0.28, transientNoise: 0.08, reverbSend: 0.1 },
    'guitar-electric': { oscillators: [{ type: 'sawtooth', gain: 0.62 }, { type: 'square', gain: 0.22, detune: 7 }, { type: 'sawtooth', gain: 0.16, detune: -7 }], filterType: 'lowpass', filterFrequency: 1800, filterQ: 1.4, attack: 0.006, decay: 0.18, sustain: 0.3, release: 0.24, gain: 0.2, stereoWidth: 0.2, transientNoise: 0.03, reverbSend: 0.08 },
    saxophone: { oscillators: [{ type: 'sawtooth', gain: 0.58 }, { type: 'triangle', gain: 0.22, detune: 4 }, { type: 'square', gain: 0.2, detune: -4 }], filterType: 'bandpass', filterFrequency: 1500, filterQ: 1.3, attack: 0.025, decay: 0.18, sustain: 0.42, release: 0.2, gain: 0.12, stereoWidth: 0.16, vibratoRate: 5.2, vibratoDepth: 10, transientNoise: 0.02, reverbSend: 0.12 },
    trumpet: { oscillators: [{ type: 'square', gain: 0.52 }, { type: 'sawtooth', gain: 0.28, detune: 4 }, { type: 'square', gain: 0.2, detune: -3 }], filterType: 'bandpass', filterFrequency: 1750, filterQ: 1.5, attack: 0.016, decay: 0.14, sustain: 0.38, release: 0.18, gain: 0.11, stereoWidth: 0.14, vibratoRate: 4.9, vibratoDepth: 7, reverbSend: 0.11 },
    trombone: { oscillators: [{ type: 'square', gain: 0.45 }, { type: 'triangle', gain: 0.35, detune: 3 }, { type: 'sawtooth', gain: 0.2, detune: -3 }], filterType: 'lowpass', filterFrequency: 1100, filterQ: 1.2, attack: 0.03, decay: 0.16, sustain: 0.46, release: 0.24, gain: 0.13, stereoWidth: 0.12, vibratoRate: 4.2, vibratoDepth: 6, reverbSend: 0.12 },
    flute: { oscillators: [{ type: 'sine', gain: 0.72 }, { type: 'triangle', gain: 0.28, detune: 3 }], filterType: 'lowpass', filterFrequency: 2600, filterQ: 0.7, attack: 0.02, decay: 0.1, sustain: 0.44, release: 0.2, gain: 0.1, stereoWidth: 0.2, vibratoRate: 5.6, vibratoDepth: 9, transientNoise: 0.015, reverbSend: 0.18 },
    clarinet: { oscillators: [{ type: 'triangle', gain: 0.55 }, { type: 'square', gain: 0.25, detune: 3 }, { type: 'triangle', gain: 0.2, detune: -2 }], filterType: 'bandpass', filterFrequency: 1200, filterQ: 1.4, attack: 0.022, decay: 0.15, sustain: 0.42, release: 0.18, gain: 0.11, stereoWidth: 0.14, vibratoRate: 4.5, vibratoDepth: 6, reverbSend: 0.11 },
    harmonica: { oscillators: [{ type: 'square', gain: 0.58 }, { type: 'sawtooth', gain: 0.18, detune: 5 }, { type: 'square', gain: 0.24, detune: -5 }], filterType: 'bandpass', filterFrequency: 1900, filterQ: 2.1, attack: 0.014, decay: 0.12, sustain: 0.3, release: 0.16, gain: 0.12, stereoWidth: 0.12, vibratoRate: 5.8, vibratoDepth: 8, transientNoise: 0.03, reverbSend: 0.08 },
    violin: { oscillators: [{ type: 'sawtooth', gain: 0.62 }, { type: 'triangle', gain: 0.22, detune: 5 }, { type: 'sawtooth', gain: 0.16, detune: -5 }], filterType: 'lowpass', filterFrequency: 2200, filterQ: 1.1, attack: 0.04, decay: 0.13, sustain: 0.5, release: 0.26, gain: 0.11, stereoWidth: 0.26, vibratoRate: 5.4, vibratoDepth: 11, reverbSend: 0.2 },
    cello: { oscillators: [{ type: 'triangle', gain: 0.58 }, { type: 'sawtooth', gain: 0.22, detune: 3 }, { type: 'sine', gain: 0.2, detune: -3 }], filterType: 'lowpass', filterFrequency: 1250, filterQ: 1.1, attack: 0.04, decay: 0.16, sustain: 0.54, release: 0.28, gain: 0.12, stereoWidth: 0.16, vibratoRate: 4.6, vibratoDepth: 6, reverbSend: 0.16 },
    harp: { oscillators: [{ type: 'triangle', gain: 0.6 }, { type: 'sine', gain: 0.22, detune: 4 }, { type: 'triangle', gain: 0.18, detune: -4 }], filterType: 'bandpass', filterFrequency: 2200, filterQ: 1.8, attack: 0.002, decay: 0.18, sustain: 0.08, release: 0.28, gain: 0.13, stereoWidth: 0.3, transientNoise: 0.05, reverbSend: 0.22 },
    strings: { oscillators: [{ type: 'sawtooth', gain: 0.55 }, { type: 'triangle', gain: 0.2, detune: 6 }, { type: 'sawtooth', gain: 0.15, detune: -6 }, { type: 'sine', gain: 0.1 }], filterType: 'lowpass', filterFrequency: 1650, filterQ: 1.0, attack: 0.08, decay: 0.14, sustain: 0.58, release: 0.34, gain: 0.11, stereoWidth: 0.32, vibratoRate: 5.1, vibratoDepth: 7, reverbSend: 0.24 },
    'synth-lead': { oscillators: [{ type: 'sawtooth', gain: 0.62 }, { type: 'square', gain: 0.2, detune: 9 }, { type: 'sawtooth', gain: 0.18, detune: -9 }], filterType: 'lowpass', filterFrequency: 2600, filterQ: 1.4, attack: 0.008, decay: 0.16, sustain: 0.36, release: 0.16, gain: 0.12, stereoWidth: 0.16, vibratoRate: 5.9, vibratoDepth: 12, reverbSend: 0.1 },
    'synth-pad': { oscillators: [{ type: 'triangle', gain: 0.42 }, { type: 'sawtooth', gain: 0.28, detune: 8 }, { type: 'triangle', gain: 0.2, detune: -8 }, { type: 'sine', gain: 0.1 }], filterType: 'lowpass', filterFrequency: 1400, filterQ: 0.8, attack: 0.14, decay: 0.2, sustain: 0.62, release: 0.42, gain: 0.11, stereoWidth: 0.36, vibratoRate: 0.3, vibratoDepth: 4, reverbSend: 0.28 },
    choir: { oscillators: [{ type: 'triangle', gain: 0.46 }, { type: 'sine', gain: 0.24, detune: 7 }, { type: 'triangle', gain: 0.18, detune: -7 }, { type: 'square', gain: 0.12 }], filterType: 'bandpass', filterFrequency: 1100, filterQ: 1.2, attack: 0.09, decay: 0.15, sustain: 0.52, release: 0.32, gain: 0.12, stereoWidth: 0.28, vibratoRate: 4.8, vibratoDepth: 8, reverbSend: 0.24 },
  };
  return palettes[instrument] ?? { oscillators: [{ type: 'triangle', gain: 0.7 }, { type: 'sine', gain: 0.3, detune: 4 }], filterType: 'lowpass', filterFrequency: 1600, filterQ: 1, attack: 0.02, decay: 0.12, sustain: 0.34, release: 0.18, gain: 0.12, stereoWidth: 0.14, reverbSend: 0.12 };
}

// ─── Synth Note Scheduler ─────────────────────────────────────────────────────

export function scheduleSynthNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  instrument: Instrument,
  frequency: number,
  start: number,
  duration: number,
  velocity = 1,
  options?: {
    gainScale?: number;
    detuneCents?: number;
    stereoScale?: number;
    attackScale?: number;
    releaseScale?: number;
  },
) {
  const palette = instrumentPalette(instrument);
  const voiceGain = ctx.createGain();
  const dryGain = ctx.createGain();
  const verbGain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const panner = ctx.createStereoPanner();
  const vibratoOsc = palette.vibratoRate ? ctx.createOscillator() : null;
  const vibratoGain = palette.vibratoDepth ? ctx.createGain() : null;
  const gainScale = options?.gainScale ?? 1;
  const detuneCents = options?.detuneCents ?? 0;
  const stereoScale = options?.stereoScale ?? 1;
  const attackScale = options?.attackScale ?? 1;
  const releaseScale = options?.releaseScale ?? 1;
  const attackTime = palette.attack * attackScale;
  const releaseTime = Math.max(0.04, palette.release * releaseScale);
  const voiceDuration = duration + releaseTime + 0.1;
  const humanStart = Math.max(0, start + (Math.random() - 0.5) * 0.008);
  const humanVelocity = velocity * (0.92 + Math.random() * 0.12);
  const panPosition = ((Math.random() - 0.5) * 2) * (palette.stereoWidth ?? 0.12) * stereoScale;

  filter.type = palette.filterType;
  filter.frequency.value = palette.filterFrequency;
  filter.Q.value = palette.filterQ ?? 1;
  panner.pan.value = panPosition;
  dryGain.gain.value = 1 - (palette.reverbSend ?? 0.12);
  verbGain.gain.value = palette.reverbSend ?? 0.12;
  voiceGain.gain.setValueAtTime(0.0001, humanStart);
  voiceGain.gain.linearRampToValueAtTime(palette.gain * gainScale * humanVelocity, humanStart + attackTime);
  voiceGain.gain.linearRampToValueAtTime(palette.gain * gainScale * palette.sustain * humanVelocity, humanStart + attackTime + palette.decay);
  voiceGain.gain.setTargetAtTime(0.0001, humanStart + duration, releaseTime);

  if (vibratoOsc && vibratoGain) {
    vibratoOsc.type = 'sine';
    vibratoOsc.frequency.value = palette.vibratoRate ?? 0;
    vibratoGain.gain.value = palette.vibratoDepth ?? 0;
    vibratoOsc.connect(vibratoGain);
    vibratoOsc.start(humanStart);
    vibratoOsc.stop(humanStart + voiceDuration);
  }

  palette.oscillators.forEach((oscSpec, index) => {
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = oscSpec.type;
    osc.frequency.value = frequency;
    osc.detune.value = (oscSpec.detune ?? 0) + detuneCents;
    oscGain.gain.value = oscSpec.gain;
    if (vibratoGain && index < 2) {
      vibratoGain.connect(osc.detune);
    }
    osc.connect(oscGain);
    oscGain.connect(filter);
    osc.start(humanStart);
    osc.stop(humanStart + voiceDuration);
  });

  if (palette.transientNoise) {
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    noise.buffer = createNoiseBuffer(ctx, 0.08);
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2000;
    noiseGain.gain.setValueAtTime(0.0001, humanStart);
    noiseGain.gain.exponentialRampToValueAtTime(palette.transientNoise * humanVelocity, humanStart + 0.003);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, humanStart + 0.035);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(filter);
    noise.start(humanStart);
    noise.stop(humanStart + 0.05);
  }

  filter.connect(voiceGain);
  voiceGain.connect(panner);
  panner.connect(dryGain);
  panner.connect(verbGain);
  dryGain.connect(destination);
  verbGain.connect(destination);
}

// ─── Sample+Synth Blend Layer Scheduler ──────────────────────────────────────

export function scheduleSupportSynthLayer(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  instrument: Instrument,
  midi: number,
  start: number,
  duration: number,
  velocity: number,
  blend: number,
  timingOffset = 0,
) {
  const baseVelocity = Math.max(0.14, velocity * blend);
  const startOffset = Math.max(0, start + timingOffset);
  scheduleSynthNote(
    ctx,
    destination,
    instrument,
    midiToFrequency(midi),
    startOffset,
    duration * 1.04,
    baseVelocity,
    {
      gainScale: 0.28,
      detuneCents: (Math.random() - 0.5) * 5,
      stereoScale: 0.45,
      attackScale: 1,
      releaseScale: 1.2,
    },
  );

  if (instrument === 'strings' || instrument === 'violin' || instrument === 'cello') {
    scheduleSynthNote(
      ctx,
      destination,
      instrument,
      midiToFrequency(Math.min(96, midi + (instrument === 'cello' ? 0 : 12))),
      startOffset + 0.002,
      duration * 1.04,
      baseVelocity * 0.32,
      {
        gainScale: 0.18,
        detuneCents: (Math.random() - 0.5) * 7,
        stereoScale: 0.6,
        attackScale: 1.1,
        releaseScale: 1.25,
      },
    );
  }

  if (instrument === 'guitar-electric' || instrument === 'guitar-acoustic') {
    scheduleSynthNote(
      ctx,
      destination,
      instrument,
      midiToFrequency(Math.min(96, midi + 12)),
      startOffset + 0.003,
      Math.max(0.12, duration * 0.85),
      baseVelocity * 0.2,
      {
        gainScale: 0.14,
        detuneCents: (Math.random() - 0.5) * 8,
        stereoScale: 0.6,
        attackScale: 1,
        releaseScale: 0.8,
      },
    );
  }

  if (instrument === 'bass' && midi > 35) {
    scheduleSynthNote(
      ctx,
      destination,
      instrument,
      midiToFrequency(midi - 12),
      startOffset,
      duration,
      baseVelocity * 0.22,
      {
        gainScale: 0.18,
        detuneCents: -2,
        stereoScale: 0.2,
        attackScale: 0.9,
        releaseScale: 1.1,
      },
    );
  }
}
