import type {
  AudioClip,
  DrumHitEvent,
  Genre,
  Instrument,
  NoteEvent,
  TimeSignature,
} from '../types/daw';
import { computePeaks, computePeaksAsync } from './audioUtils';
import {
  clampToInstrumentRange,
  createLocalDrumPattern,
  createLocalInstrumentNotes,
  degreeToChord,
  getGenreProgression,
  keyToRootMidi,
  midiToFrequency,
  PITCH_CLASS_TO_SEMITONE,
} from './noteGenerators';
import { createImpulseResponse, scheduleHat, scheduleKick, scheduleSnare } from './drumSynth';
import {
  isLegatoBiasedInstrument,
  calculateLayerTimingOffset,
  shapeRenderedDuration,
  scheduleSynthNote,
  scheduleSupportSynthLayer,
} from './synthEngine';

export interface BackingTrackRequest {
  genre: Genre;
  bpm: number;
  key: string;
  timeSignature: TimeSignature;
  bars: number;
  instruments: Instrument[];
  snippetFeatures?: SnippetFeatures;
}

export interface SnippetFeatures {
  durationSeconds: number;
  rms: number;
  peak: number;
  dynamicRangeDb: number;
  onsetDensity: number;
  pulseBpm: number | null;
}

export interface InstrumentPlan {
  instrument: Instrument;
  notes?: NoteEvent[];
  drumHits?: DrumHitEvent[];
}

export interface BackingTrackPlan {
  title?: string;
  instrumentPlans: InstrumentPlan[];
}

export interface SampleMetadata {
  family: string;
  midi: number;
  durationToken: string;
  durationSeconds: number;
  dynamic: string;
  dynamicRank: number;
  articulation: string;
  urlPath: string;
}

interface SampleLayer {
  family: string;
  gain: number;
  stereoWidth?: number;
  detune?: number;
  filterFrequency?: number;
  alternateGain?: number;
  alternateDetune?: number;
  synthBlend?: number;
}

const SAMPLE_FILE_LOADERS = import.meta.glob([
  '../samples/cello/**/*.mp3',
  '../samples/clarinet/**/*.mp3',
  '../samples/double bass/**/*.mp3',
  '../samples/flute/**/*.mp3',
  '../samples/guitar/**/*.mp3',
  '../samples/guitar 2/**/*.mp3',
  '../samples/saxophone/**/*.mp3',
  '../samples/trombone/**/*.mp3',
  '../samples/trumpet/**/*.mp3',
  '../samples/viola/**/*.mp3',
  '../samples/violin/**/*.mp3',
], {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const DRUM_SAMPLE_LOADERS = import.meta.glob([
  '../samples/percussion/bass drum/**/*.mp3',
  '../samples/percussion/snare drum/**/*.mp3',
  '../samples/percussion/clash cymbals/**/*.mp3',
  '../samples/percussion/suspended cymbal/**/*.mp3',
], {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

export type DrumHitKind = 'kick' | 'snare' | 'hat' | 'openHat';

export interface DrumSampleEntry {
  kind: DrumHitKind;
  durationSeconds: number;
  dynamicRank: number;
  urlPath: string;
}

const INSTRUMENT_SAMPLE_LAYERS: Partial<Record<Instrument, SampleLayer[]>> = {
  bass: [{ family: 'double bass', gain: 0.9, stereoWidth: 0.06, filterFrequency: 1800, alternateGain: 0.28, alternateDetune: -4, synthBlend: 0.18 }],
  cello: [{ family: 'cello', gain: 0.86, stereoWidth: 0.12, filterFrequency: 2600, alternateGain: 0.3, alternateDetune: 4, synthBlend: 0.14 }],
  violin: [{ family: 'violin', gain: 0.82, stereoWidth: 0.18, filterFrequency: 4200, alternateGain: 0.34, alternateDetune: -5, synthBlend: 0.14 }],
  flute: [{ family: 'flute', gain: 0.78, stereoWidth: 0.18, filterFrequency: 5200, alternateGain: 0.2, alternateDetune: 3, synthBlend: 0.08 }],
  clarinet: [{ family: 'clarinet', gain: 0.82, stereoWidth: 0.12, filterFrequency: 3600, alternateGain: 0.24, alternateDetune: -3, synthBlend: 0.1 }],
  saxophone: [{ family: 'saxophone', gain: 0.8, stereoWidth: 0.1, filterFrequency: 3400, alternateGain: 0.26, alternateDetune: 3, synthBlend: 0.12 }],
  trumpet: [{ family: 'trumpet', gain: 0.78, stereoWidth: 0.1, filterFrequency: 4200, alternateGain: 0.22, alternateDetune: -2, synthBlend: 0.08 }],
  trombone: [{ family: 'trombone', gain: 0.8, stereoWidth: 0.08, filterFrequency: 3000, alternateGain: 0.24, alternateDetune: 2, synthBlend: 0.1 }],
  'guitar-acoustic': [{ family: 'guitar', gain: 0.78, stereoWidth: 0.2, filterFrequency: 4800, alternateGain: 0.22, alternateDetune: 5, synthBlend: 0.08 }],
  'guitar-electric': [
    { family: 'guitar 2', gain: 0.56, stereoWidth: 0.16, detune: -3, filterFrequency: 3600, alternateGain: 0.18, alternateDetune: -7, synthBlend: 0.14 },
    { family: 'guitar', gain: 0.28, stereoWidth: 0.22, detune: 4, filterFrequency: 4000, alternateGain: 0.12, alternateDetune: 7, synthBlend: 0.08 },
  ],
  strings: [
    { family: 'violin', gain: 0.36, stereoWidth: 0.22, detune: -5, filterFrequency: 4200, alternateGain: 0.18, alternateDetune: -9, synthBlend: 0.12 },
    { family: 'viola', gain: 0.3, stereoWidth: 0.18, detune: 3, filterFrequency: 3400, alternateGain: 0.16, alternateDetune: 6, synthBlend: 0.1 },
    { family: 'cello', gain: 0.26, stereoWidth: 0.14, detune: 7, filterFrequency: 2800, alternateGain: 0.14, alternateDetune: 10, synthBlend: 0.1 },
  ],
};
const SAMPLE_PLAYBACK_ENABLED = false;

const SAFE_ARTICULATION_KEYWORDS = ['normal', 'legato', 'tenuto', 'arco-normal', 'pizz-normal', 'spiccato', 'staccato'];
const EXCLUDED_ARTICULATION_KEYWORDS = [
  'glissando',
  'trill',
  'tremolo',
  'fluttertonguing',
  'double-tonguing',
  'triple-tonguing',
  'tongued-slur',
  'col-legno',
  'harmonic',
  'snap-pizz',
  'sul-ponticello',
  'sul-tasto',
  'con-sord',
  'non-vibrato',
  'molto-vibrato',
  'au-talon',
  'martele',
  'major-trill',
  'minor-trill',
  'gliss',
];

let sampleCatalogPromise: Promise<Map<string, SampleMetadata[]>> | null = null;
let drumCatalogPromise: Promise<Map<DrumHitKind, DrumSampleEntry[]>> | null = null;
let sampleDecodeContextPromise: Promise<AudioContext> | null = null;
const decodedSampleCache = new Map<string, Promise<AudioBuffer>>();

export function instrumentColor(instrument: Instrument) {
  const colorMap: Partial<Record<Instrument, string>> = {
    drums: '#ff453a',
    bass: '#30d158',
    piano: '#64d2ff',
    organ: '#5ac8fa',
    'guitar-acoustic': '#ff9f0a',
    'guitar-electric': '#ffd60a',
    strings: '#bf5af2',
    'synth-pad': '#7d8cff',
    'synth-lead': '#ff6bcb',
    choir: '#c39ef7',
  };
  return colorMap[instrument] ?? '#8e8e93';
}

export function createClipFromBuffer(buffer: AudioBuffer, name: string, color: string): AudioClip {
  return {
    id: `ai_clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    startTime: 0,
    duration: buffer.duration,
    audioBuffer: buffer,
    waveformPeaks: computePeaks(buffer, 200),
    color,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    offset: 0,
  };
}

export async function createClipFromBufferAsync(buffer: AudioBuffer, name: string, color: string): Promise<AudioClip> {
  return {
    id: `ai_clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    startTime: 0,
    duration: buffer.duration,
    audioBuffer: buffer,
    waveformPeaks: await computePeaksAsync(buffer, 200),
    color,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    offset: 0,
  };
}

export async function renderInstrumentPlan(
  request: BackingTrackRequest,
  plan: InstrumentPlan,
): Promise<AudioBuffer> {
  const beatsPerBar = Number.parseInt(request.timeSignature, 10) || 4;
  const secondsPerBeat = 60 / request.bpm;
  const totalBeats = request.bars * beatsPerBar;
  const duration = totalBeats * secondsPerBeat;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const master = ctx.createGain();
  const busCompressor = ctx.createDynamicsCompressor();
  const wetBus = ctx.createGain();
  const dryBus = ctx.createGain();
  const reverb = ctx.createConvolver();
  const wetReturn = ctx.createGain();

  master.gain.value = 0.78;
  dryBus.gain.value = 0.92;
  wetBus.gain.value = 0.22;
  wetReturn.gain.value = 0.6;
  busCompressor.threshold.value = -16;
  busCompressor.ratio.value = 2.2;
  busCompressor.attack.value = 0.008;
  busCompressor.release.value = 0.16;
  reverb.buffer = createImpulseResponse(ctx, plan.instrument === 'drums' ? 0.15 : 0.42, 0.48);

  master.connect(dryBus);
  master.connect(wetBus);
  wetBus.connect(reverb);
  reverb.connect(wetReturn);
  dryBus.connect(busCompressor);
  wetReturn.connect(busCompressor);
  busCompressor.connect(ctx.destination);

  if (plan.instrument === 'drums') {
    const drumCatalog = SAMPLE_PLAYBACK_ENABLED ? await getDrumCatalog() : null;
    const hasSampledDrums = SAMPLE_PLAYBACK_ENABLED
      ? Array.from(drumCatalog?.values() ?? []).some(arr => arr.length > 0)
      : false;
    const roundRobinCursor: Record<DrumHitKind, number> = { kick: 0, snare: 0, hat: 0, openHat: 0 };
    const drumHits = (plan.drumHits ?? []).slice().sort((a, b) => a.startBeats - b.startBeats);
    for (let index = 0; index < drumHits.length; index += 1) {
      const hit = drumHits[index];
      const resolvedKind = resolveDrumHitKind(drumHits, index);
      const start = hit.startBeats * secondsPerBeat;
      const nextHatHit = drumHits.slice(index + 1).find(next => next.kind === 'hat' || next.kind === 'openHat');
      const nextHatStart = nextHatHit ? nextHatHit.startBeats * secondsPerBeat : null;
      const usedSample = hasSampledDrums && drumCatalog
        ? await scheduleDrumHitSampled(ctx, master, resolvedKind, drumCatalog, start, hit.velocity, {
            roundRobinIndex: roundRobinCursor[resolvedKind],
            nextHatStart,
          })
        : false;
      roundRobinCursor[resolvedKind] += 1;
      if (!usedSample) {
        if (resolvedKind === 'kick') scheduleKick(ctx, master, start, hit.velocity);
        else if (resolvedKind === 'snare') scheduleSnare(ctx, master, start, hit.velocity);
        else if (resolvedKind === 'hat') scheduleHat(ctx, master, start, false, hit.velocity);
        else if (resolvedKind === 'openHat') scheduleHat(ctx, master, start, true, hit.velocity);
      }
    }
  } else {
    // Clamp all incoming MIDI values to the instrument's playable range before rendering.
    // This catches out-of-range notes from both AI plans (A8+ guitar) and local generators.
    const notes = (plan.notes ?? []).map(n => ({
      ...n,
      midi: clampToInstrumentRange(n.midi, plan.instrument),
    }));
    const usedSamples = SAMPLE_PLAYBACK_ENABLED
      ? await scheduleSampledNotes(ctx, master, plan.instrument, notes, secondsPerBeat)
      : false;
    if (!usedSamples) {
      notes.forEach(note => {
        const start = note.startBeats * secondsPerBeat;
        const durationSeconds = Math.max(0.08, note.durationBeats * secondsPerBeat);
        scheduleSynthNote(
          ctx,
          master,
          plan.instrument,
          midiToFrequency(note.midi),
          start,
          durationSeconds,
          note.velocity,
        );
      });
    }
  }

  return ctx.startRendering();
}

export function resolveDrumHitKind(drumHits: DrumHitEvent[], index: number): DrumHitKind {
  const hit = drumHits[index];
  if (!hit) return 'hat';
  if (hit.kind !== 'hat') return hit.kind;

  const prev = drumHits[index - 1];
  const next = drumHits[index + 1];
  const gapFromPrev = prev ? hit.startBeats - prev.startBeats : 0;
  const gapToNext = next ? next.startBeats - hit.startBeats : 0;
  const onOffbeat = Math.abs((hit.startBeats % 1) - 0.5) < 0.12;
  const isolatedStroke = gapFromPrev >= 0.45 && (gapToNext === 0 || gapToNext >= 0.85);
  const shouldOpen = onOffbeat && isolatedStroke;
  return shouldOpen ? 'openHat' : 'hat';
}

export function generateLocalBackingTrackPlan(request: BackingTrackRequest): BackingTrackPlan {
  const beatsPerBar = Number.parseInt(request.timeSignature, 10) || 4;
  const rootMidi = keyToRootMidi(request.key);
  const isMinor = request.key.endsWith('m');
  const progression = getGenreProgression(request.genre, isMinor);
  const chordBars = Array.from({ length: request.bars }, (_, barIndex) => {
    const degree = progression[barIndex % progression.length];
    const chord = degreeToChord(rootMidi, degree, isMinor);
    return { barIndex, degree, chord };
  });

  return {
    title: `Local ${request.genre} pattern`,
    instrumentPlans: request.instruments.map(instrument => {
      if (instrument === 'drums') {
        return { instrument, drumHits: createLocalDrumPattern(request.genre, beatsPerBar, request.bars) };
      }

      return {
        instrument,
        notes: createLocalInstrumentNotes(instrument, chordBars, beatsPerBar, request.genre),
      };
    }),
  };
}

async function scheduleSampledNotes(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  instrument: Instrument,
  notes: NoteEvent[],
  secondsPerBeat: number,
) {
  const layers = INSTRUMENT_SAMPLE_LAYERS[instrument];
  if (!layers?.length || !notes.length) return false;

  const catalog = await getSampleCatalog();
  let scheduledCount = 0;
  const orderedNotes = notes.slice().sort((left, right) => left.startBeats - right.startBeats || left.midi - right.midi);

  for (let index = 0; index < orderedNotes.length; index += 1) {
    const note = orderedNotes[index];
    const nextNote = orderedNotes[index + 1];
    const start = note.startBeats * secondsPerBeat;
    const duration = shapeRenderedDuration(note, nextNote, instrument, secondsPerBeat);
    const timingOffset = calculateLayerTimingOffset(instrument, duration);
    const velocityTaper = 0.96 + Math.random() * 0.08;
    let noteScheduled = false;

    for (const layer of layers) {
      const candidates = catalog.get(layer.family) ?? [];
      const rankedSamples = rankSamples(candidates, note.midi, duration, note.velocity, instrument, layer.family).slice(0, 2);
      if (!rankedSamples.length) continue;

      const [primarySample, alternateSample] = rankedSamples;
      const primaryBuffer = await decodeSample(primarySample);
      scheduleSampleNote(ctx, destination, {
        buffer: primaryBuffer,
        sample: primarySample,
        instrument,
        targetMidi: note.midi,
        start,
        duration,
        velocity: note.velocity * velocityTaper,
        layer,
        timingOffset,
      });

      if (alternateSample) {
        const alternateBuffer = await decodeSample(alternateSample);
        scheduleSampleNote(ctx, destination, {
          buffer: alternateBuffer,
          sample: alternateSample,
          instrument,
          targetMidi: note.midi,
          start,
          duration,
          velocity: note.velocity * velocityTaper,
          layer,
          gainMultiplier: layer.alternateGain ?? 0.24,
          detuneOffset: layer.alternateDetune ?? ((Math.random() > 0.5 ? 1 : -1) * 4),
          panOffset: (Math.random() - 0.5) * 0.2,
          timingOffset,
        });
      }

      if (layer.synthBlend) {
        scheduleSupportSynthLayer(ctx, destination, instrument, note.midi, start, duration, note.velocity * velocityTaper, layer.synthBlend, timingOffset);
      }

      noteScheduled = true;
    }

    if (noteScheduled) scheduledCount += 1;
  }

  return scheduledCount > 0;
}

function scheduleSampleNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  config: {
    buffer: AudioBuffer;
    sample: SampleMetadata;
    instrument: Instrument;
    targetMidi: number;
    start: number;
    duration: number;
    velocity: number;
    layer: SampleLayer;
    gainMultiplier?: number;
    detuneOffset?: number;
    panOffset?: number;
    timingOffset?: number;
  },
) {
  const {
    buffer,
    sample,
    instrument,
    targetMidi,
    start,
    duration,
    velocity,
    layer,
    gainMultiplier = 1,
    detuneOffset = 0,
    panOffset = 0,
    timingOffset = 0,
  } = config;
  const source = ctx.createBufferSource();
  const voiceGain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const filter = ctx.createBiquadFilter();
  const dryGain = ctx.createGain();
  const verbGain = ctx.createGain();
  const playbackRate = Math.pow(2, (targetMidi - sample.midi) / 12);
  const sampleDuration = buffer.duration / playbackRate;
  const release = instrument === 'strings' || instrument === 'cello' || instrument === 'violin' ? 0.18 : 0.12;
  const attack = duration < 0.18 ? 0.004 : 0.016;
  const safeStart = Math.max(0, start + timingOffset);
  const safeVelocity = velocity * (0.96 + Math.random() * 0.06);
  const wetAmount = instrument === 'strings' || instrument === 'flute' ? 0.18 : 0.1;
  const panAmount = (((Math.random() - 0.5) * 2) * (layer.stereoWidth ?? 0.12)) + panOffset;
  const sustainTime = duration + release + (isLegatoBiasedInstrument(instrument) ? 0.04 : 0);

  source.buffer = buffer;
  source.playbackRate.value = playbackRate;
  source.detune.value = (layer.detune ?? 0) + detuneOffset;
  source.loop = shouldLoopSample(sample, duration, sampleDuration);
  if (source.loop) {
    source.loopStart = Math.min(0.12, Math.max(0.03, buffer.duration * 0.08));
    source.loopEnd = Math.max(source.loopStart + 0.08, buffer.duration - Math.min(0.12, buffer.duration * 0.1));
  }

  filter.type = 'lowpass';
  filter.frequency.value = layer.filterFrequency ?? 4200;
  filter.Q.value = 0.3;
  panner.pan.value = panAmount;
  dryGain.gain.value = 1 - wetAmount;
  verbGain.gain.value = wetAmount;

  voiceGain.gain.setValueAtTime(0.0001, safeStart);
  voiceGain.gain.linearRampToValueAtTime(layer.gain * safeVelocity * gainMultiplier, safeStart + attack);
  voiceGain.gain.setValueAtTime(layer.gain * safeVelocity * gainMultiplier, safeStart + Math.max(attack, duration * 0.65));
  voiceGain.gain.linearRampToValueAtTime(0.0001, safeStart + sustainTime);

  source.connect(filter);
  filter.connect(voiceGain);
  voiceGain.connect(panner);
  panner.connect(dryGain);
  panner.connect(verbGain);
  dryGain.connect(destination);
  verbGain.connect(destination);

  const playbackWindow = source.loop ? sustainTime : Math.min(sampleDuration, sustainTime);
  source.start(safeStart, 0, playbackWindow);
  source.stop(safeStart + playbackWindow + 0.02);
}

function shouldLoopSample(sample: SampleMetadata, targetDuration: number, sampleDuration: number) {
  if (sample.durationToken === 'phrase') return false;
  if (sample.articulation.includes('pizz') || sample.articulation.includes('staccato') || sample.articulation.includes('spiccato')) {
    return false;
  }
  return targetDuration > sampleDuration * 0.8 && sampleDuration > 0.7;
}

export function rankSamples(
  candidates: SampleMetadata[],
  midi: number,
  targetDuration: number,
  velocity: number,
  instrument: Instrument,
  family: string,
) {
  if (!candidates.length) return [];

  const expressivePool = candidates.filter(sample => isAcceptableSample(sample, targetDuration, instrument, family));
  const pool = expressivePool.length ? expressivePool : candidates.filter(sample => !sample.articulation.includes('phrase'));
  if (!pool.length) return [];

  return pool
    .slice()
    .sort((left, right) => (
      scoreSample(left, midi, targetDuration, velocity, instrument, family)
      - scoreSample(right, midi, targetDuration, velocity, instrument, family)
    ));
}

function isAcceptableSample(
  sample: SampleMetadata,
  targetDuration: number,
  instrument: Instrument,
  family: string,
) {
  if (EXCLUDED_ARTICULATION_KEYWORDS.some(keyword => sample.articulation.includes(keyword))) {
    return false;
  }

  if (sample.durationToken === 'phrase' && targetDuration < 1.5) {
    return false;
  }

  if (family === 'guitar' || family === 'guitar 2' || instrument === 'bass') {
    if (sample.articulation.includes('harmonics')) return false;
  }

  if (targetDuration <= 0.25) {
    if (isLegatoBiasedInstrument(instrument)) {
      return sample.articulation.includes('normal')
        || sample.articulation.includes('legato')
        || sample.articulation.includes('tenuto');
    }

    return sample.articulation.includes('staccato')
      || sample.articulation.includes('spiccato')
      || sample.articulation.includes('pizz')
      || sample.articulation.includes('normal')
      || sample.articulation.includes('tenuto');
  }

  if (targetDuration <= 0.45) {
    return SAFE_ARTICULATION_KEYWORDS.some(keyword => sample.articulation.includes(keyword))
      || sample.articulation.includes('normal');
  }

  if (targetDuration >= 0.8) {
    return SAFE_ARTICULATION_KEYWORDS.some(keyword => sample.articulation.includes(keyword))
      || sample.durationToken === 'long'
      || sample.durationToken === 'very-long';
  }

  return true;
}

function scoreSample(
  sample: SampleMetadata,
  midi: number,
  targetDuration: number,
  velocity: number,
  instrument: Instrument,
  family: string,
) {
  const pitchScore = Math.abs(sample.midi - midi) * 5;
  const durationScore = Math.abs(sample.durationSeconds - targetDuration) * 2.5;
  const dynamicScore = Math.abs(sample.dynamicRank - dynamicRankFromVelocity(velocity)) * 1.3;
  const phrasePenalty = sample.durationToken === 'phrase' ? 9 : 0;
  const weirdArticulationPenalty = EXCLUDED_ARTICULATION_KEYWORDS.some(keyword => sample.articulation.includes(keyword)) ? 12 : 0;
  const legatoFriendly = sample.articulation.includes('normal')
    || sample.articulation.includes('legato')
    || sample.articulation.includes('tenuto')
    || sample.articulation.includes('arco-normal');
  const shortArticulationPenalty = targetDuration <= 0.16 && !(
    sample.articulation.includes('staccato')
    || sample.articulation.includes('spiccato')
    || sample.articulation.includes('pizz')
    || legatoFriendly
  ) ? 3 : 0;
  const connectedPhraseBonus = targetDuration >= 0.22 && legatoFriendly ? -1.8 : 0;
  const disconnectedPenalty = targetDuration >= 0.22 && (
    sample.articulation.includes('pizz')
    || sample.articulation.includes('spiccato')
    || sample.articulation.includes('staccato')
  ) ? 2.8 : 0;
  const longArticulationPenalty = targetDuration >= 0.8 && (
    sample.articulation.includes('pizz')
    || sample.articulation.includes('spiccato')
    || sample.articulation.includes('staccato')
  ) ? 3.5 : 0;
  const bassHarmonicPenalty = (family === 'guitar' || family === 'guitar 2' || instrument === 'bass') && sample.articulation.includes('harmonics')
    ? 7
    : 0;

  return pitchScore + durationScore + dynamicScore + phrasePenalty + weirdArticulationPenalty + shortArticulationPenalty + connectedPhraseBonus + disconnectedPenalty + longArticulationPenalty + bassHarmonicPenalty;
}

function dynamicRankFromVelocity(velocity: number) {
  if (velocity < 0.34) return 1;
  if (velocity < 0.48) return 2;
  if (velocity < 0.7) return 3;
  if (velocity < 0.88) return 4;
  return 5;
}

async function getSampleCatalog() {
  if (!sampleCatalogPromise) {
    sampleCatalogPromise = Promise.resolve(buildSampleCatalog());
  }
  return sampleCatalogPromise;
}

function parseDrumSamplePath(urlPath: string): DrumSampleEntry | null {
  const parts = urlPath.split('/');
  const dir = parts.at(-2);
  const fileName = parts.at(-1)?.replace(/\.mp3$/i, '');
  if (!dir || !fileName) return null;

  const kind: DrumHitKind | null =
    dir === 'bass drum' ? 'kick' :
    dir === 'snare drum' ? 'snare' :
    dir === 'clash cymbals' ? 'hat' :
    dir === 'suspended cymbal' ? 'openHat' : null;
  if (!kind) return null;

  const dunderIdx = fileName.indexOf('__');
  if (dunderIdx === -1) return null;
  const rest = fileName.slice(dunderIdx + 2);
  const restParts = rest.split('_');
  const durationToken = restParts[0] ?? '1';
  const dynamic = restParts[1] ?? 'mezzo-forte';
  const durationSeconds = sampleDurationTokenToSeconds(durationToken);
  // Skip rolls, phrases, and very long sustains — we want short single hits
  if (durationSeconds > 1.5 || durationToken === 'phrase') return null;
  return { kind, durationSeconds, dynamicRank: dynamicRank(dynamic), urlPath };
}

function buildDrumCatalog(): Map<DrumHitKind, DrumSampleEntry[]> {
  const catalog = new Map<DrumHitKind, DrumSampleEntry[]>([
    ['kick', []], ['snare', []], ['hat', []], ['openHat', []],
  ]);
  for (const urlPath of Object.keys(DRUM_SAMPLE_LOADERS)) {
    const entry = parseDrumSamplePath(urlPath);
    if (entry) catalog.get(entry.kind)!.push(entry);
  }
  return catalog;
}

async function getDrumCatalog(): Promise<Map<DrumHitKind, DrumSampleEntry[]>> {
  if (!drumCatalogPromise) {
    drumCatalogPromise = Promise.resolve(buildDrumCatalog());
  }
  return drumCatalogPromise;
}

export function pickDrumSample(entries: DrumSampleEntry[], velocity: number, roundRobinIndex = 0): DrumSampleEntry | null {
  if (!entries.length) return null;
  const targetRank = dynamicRankFromVelocity(velocity);
  const best = entries
    .slice()
    .sort(
      (a, b) => Math.abs(a.dynamicRank - targetRank) - Math.abs(b.dynamicRank - targetRank) || a.durationSeconds - b.durationSeconds,
    )
    .slice(0, Math.min(3, entries.length));
  if (!best.length) return null;
  return best[roundRobinIndex % best.length] ?? best[0];
}

async function scheduleDrumHitSampled(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  kind: DrumHitKind,
  catalog: Map<DrumHitKind, DrumSampleEntry[]>,
  start: number,
  velocity: number,
  options?: {
    roundRobinIndex?: number;
    nextHatStart?: number | null;
  },
): Promise<boolean> {
  const entry = pickDrumSample(catalog.get(kind) ?? [], velocity, options?.roundRobinIndex ?? 0);
  if (!entry) return false;
  const loader = DRUM_SAMPLE_LOADERS[entry.urlPath];
  if (!loader) return false;

  let bufferPromise = decodedSampleCache.get(entry.urlPath);
  if (!bufferPromise) {
    bufferPromise = (async () => {
      const assetUrl = await loader();
      const response = await fetch(assetUrl);
      if (!response.ok) throw new Error(`Drum sample fetch failed: ${entry.urlPath}`);
      const arrayBuffer = await response.arrayBuffer();
      const decodeContext = await getSampleDecodeContext();
      return decodeContext.decodeAudioData(arrayBuffer.slice(0));
    })();
    decodedSampleCache.set(entry.urlPath, bufferPromise);
  }

  const buffer = await bufferPromise;
  const gainByKind: Record<DrumHitKind, number> = { kick: 1.05, snare: 0.88, hat: 0.62, openHat: 0.68 };
  const humanVelocity = velocity * (0.9 + Math.random() * 0.2);
  const humanStart = Math.max(0, start);

  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = 0.98 + Math.random() * 0.04;
  gainNode.gain.value = (gainByKind[kind]) * humanVelocity;
  source.connect(gainNode);
  gainNode.connect(destination);
  const defaultDuration = kind === 'openHat'
    ? Math.min(buffer.duration, 0.7)
    : kind === 'hat'
      ? Math.min(buffer.duration, 0.42)
      : Math.min(buffer.duration, 0.5);
  const chokedDuration = (kind === 'hat' || kind === 'openHat') && options?.nextHatStart != null
    ? Math.max(0.04, options.nextHatStart - humanStart - 0.004)
    : defaultDuration;
  const playDuration = Math.max(0.04, Math.min(defaultDuration, chokedDuration));
  source.start(humanStart, 0, playDuration);

  if (kind === 'kick') {
    scheduleKick(ctx, destination, humanStart, Math.min(0.4, humanVelocity * 0.28));
  } else if (kind === 'snare') {
    scheduleSnare(ctx, destination, humanStart, Math.min(0.35, humanVelocity * 0.24));
  }
  return true;
}

/**
 * Pre-decode samples for the given instrument set so the first render starts
 * without stalls. The selected sample targets are awaited, while decode failures
 * are tolerated so rendering can still continue with fallbacks.
 */
export async function prewarmSamples(instruments: Instrument[]): Promise<void> {
  if (!SAMPLE_PLAYBACK_ENABLED) return;
  const catalog = await getSampleCatalog();
  const warmTasks: Promise<unknown>[] = [];

  for (const instrument of instruments) {
    if (instrument === 'drums') continue;
    const layers = INSTRUMENT_SAMPLE_LAYERS[instrument];
    if (!layers?.length) continue;
    for (const layer of layers) {
      const candidates = catalog.get(layer.family) ?? [];
      // Warm one sample per octave in the playable range
      for (const midi of [48, 60, 72]) {
        const best = rankSamples(candidates, midi, 0.5, 0.7, instrument, layer.family).slice(0, 1);
        for (const sample of best) {
          warmTasks.push(decodeSample(sample));
        }
      }
    }
  }

  if (instruments.includes('drums')) {
    const drumCatalog = await getDrumCatalog();
    for (const [kind, entries] of drumCatalog) {
      const warmTargets = [0.45, 0.7, 0.92]
        .map((vel, idx) => pickDrumSample(entries, vel, idx))
        .filter((entry): entry is DrumSampleEntry => Boolean(entry));
      for (const entry of warmTargets) {
        if (decodedSampleCache.has(entry.urlPath)) continue;
        const loader = DRUM_SAMPLE_LOADERS[entry.urlPath];
        if (!loader) continue;
        const decodePromise = (async () => {
          const assetUrl = await loader();
          const response = await fetch(assetUrl);
          if (!response.ok) throw new Error(`Drum prewarm failed: ${kind}`);
          const arrayBuffer = await response.arrayBuffer();
          const decodeContext = await getSampleDecodeContext();
          return decodeContext.decodeAudioData(arrayBuffer.slice(0));
        })();
        decodedSampleCache.set(entry.urlPath, decodePromise);
        warmTasks.push(decodePromise);
      }
    }
  }

  if (!warmTasks.length) return;
  await Promise.allSettled(warmTasks);
}

function buildSampleCatalog() {
  const catalog = new Map<string, SampleMetadata[]>();

  Object.keys(SAMPLE_FILE_LOADERS).forEach(urlPath => {
    const metadata = parseSamplePath(urlPath);
    if (!metadata) return;
    const existing = catalog.get(metadata.family) ?? [];
    existing.push(metadata);
    catalog.set(metadata.family, existing);
  });

  catalog.forEach(samples => {
    samples.sort((left, right) => left.midi - right.midi || left.durationSeconds - right.durationSeconds);
  });

  return catalog;
}

function parseSamplePath(urlPath: string) {
  const parts = urlPath.split('/');
  const family = parts.at(-2);
  const fileName = parts.at(-1)?.replace(/\.mp3$/i, '');
  if (!family || !fileName) return null;

  const tokens = fileName.split('_');
  const midi = parseSampleMidi(tokens[1] ?? '');
  if (midi == null) return null;

  const durationToken = tokens[2] ?? '1';
  const dynamic = tokens[3] ?? 'mezzo-forte';
  const articulation = tokens.slice(4).join('_') || 'normal';

  return {
    family,
    midi,
    durationToken,
    durationSeconds: sampleDurationTokenToSeconds(durationToken),
    dynamic,
    dynamicRank: dynamicRank(dynamic),
    articulation,
    urlPath,
  } satisfies SampleMetadata;
}

function parseSampleMidi(token: string) {
  const match = token.match(/^([A-G]s?)(-?\d)$/);
  if (!match) return null;
  const [, pitchClass, octaveText] = match;
  const semitone = PITCH_CLASS_TO_SEMITONE[pitchClass];
  if (semitone == null) return null;
  const octave = Number.parseInt(octaveText, 10);
  return (octave + 1) * 12 + semitone;
}

function sampleDurationTokenToSeconds(durationToken: string) {
  switch (durationToken) {
    case '025':
      return 0.25;
    case '05':
      return 0.5;
    case '1':
      return 1;
    case '15':
      return 1.5;
    case 'long':
      return 2.6;
    case 'very-long':
      return 4.2;
    case 'phrase':
      return 1.2;
    default:
      return 1;
  }
}

function dynamicRank(dynamic: string) {
  switch (dynamic) {
    case 'pianissimo':
      return 0;
    case 'mezzo-piano':
      return 1;
    case 'piano':
      return 2;
    case 'mezzo-forte':
      return 3;
    case 'forte':
      return 4;
    case 'fortissimo':
      return 5;
    default:
      return 3;
  }
}

async function decodeSample(sample: SampleMetadata) {
  const loader = SAMPLE_FILE_LOADERS[sample.urlPath];
  if (!loader) {
    throw new Error(`Missing sample asset: ${sample.urlPath}`);
  }

  const cached = decodedSampleCache.get(sample.urlPath);
  if (cached) return cached;

  const decodePromise = (async () => {
    const assetUrl = await loader();
    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(`Failed to load sample: ${sample.urlPath}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const decodeContext = await getSampleDecodeContext();
    return decodeContext.decodeAudioData(arrayBuffer.slice(0));
  })();

  decodedSampleCache.set(sample.urlPath, decodePromise);
  return decodePromise;
}

async function getSampleDecodeContext() {
  if (!sampleDecodeContextPromise) {
    sampleDecodeContextPromise = Promise.resolve(new AudioContext({ sampleRate: 44100 }));
  }
  return sampleDecodeContextPromise;
}
