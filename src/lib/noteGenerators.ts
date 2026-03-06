/**
 * noteGenerators.ts — Music theory utilities and local pattern generators.
 * No Web Audio API dependencies; usable in tests and workers.
 */
import type { DrumHitEvent, Genre, Instrument, NoteEvent } from '../types/daw';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PITCH_CLASS_TO_SEMITONE: Record<string, number> = {
  C: 0,
  Cs: 1,
  D: 2,
  Ds: 3,
  E: 4,
  F: 5,
  Fs: 6,
  G: 7,
  Gs: 8,
  A: 9,
  As: 10,
  B: 11,
};

// Per-instrument MIDI range clamps — applied to ALL incoming note plans (AI or local).
// Values are inclusive [lo, hi]. Out-of-range notes are octave-folded into range.
export const INSTRUMENT_MIDI_RANGE: Partial<Record<Instrument, readonly [number, number]>> = {
  'guitar-acoustic': [40, 84],
  'guitar-electric': [40, 88],
  bass:              [28, 55],
  piano:             [36, 96],
  organ:             [36, 96],
  harp:              [24, 103],
  vibraphone:        [53, 89],
  cello:             [36, 76],
  violin:            [55, 96],
  trumpet:           [52, 82],
  trombone:          [40, 72],
  clarinet:          [50, 90],
  flute:             [60, 96],
  saxophone:         [49, 90],
  harmonica:         [60, 84],
  strings:           [36, 96],
  choir:             [48, 84],
  'synth-lead':      [48, 96],
  'synth-pad':       [36, 84],
};

// ─── Pitch utilities ──────────────────────────────────────────────────────────

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function keyToRootMidi(key: string): number {
  const normalized = key.replace('#', 's').replace(/m$/, '');
  const semitone = PITCH_CLASS_TO_SEMITONE[normalized] ?? 0;
  return 60 + semitone;
}

export function clampToInstrumentRange(midi: number, instrument: Instrument): number {
  const range = INSTRUMENT_MIDI_RANGE[instrument];
  if (!range) return Math.round(midi);
  const [lo, hi] = range;
  let out = Math.round(midi);
  while (out < lo) out += 12;
  while (out > hi) out -= 12;
  return Math.max(lo, Math.min(hi, out));
}

// ─── Music theory ─────────────────────────────────────────────────────────────

export function getGenreProgression(genre: Genre, isMinor: boolean): number[] {
  const map: Record<Genre, number[]> = {
    pop:        isMinor ? [0, 5, 3, 4] : [0, 4, 5, 3],
    rock:       isMinor ? [0, 5, 3, 4] : [0, 3, 4, 0],
    jazz:       isMinor ? [1, 4, 0, 5] : [1, 4, 0, 5],
    blues:      [0, 0, 3, 0],
    'hip-hop':  isMinor ? [0, 5, 2, 4] : [0, 3, 5, 4],
    electronic: isMinor ? [0, 5, 3, 4] : [0, 4, 5, 3],
    classical:  isMinor ? [0, 4, 5, 2] : [0, 3, 4, 0],
    country:    [0, 3, 4, 0],
    funk:       [0, 0, 3, 4],
    latin:      isMinor ? [0, 5, 4, 5] : [0, 4, 3, 4],
    reggae:     [0, 4, 3, 4],
    metal:      isMinor ? [0, 5, 6, 4] : [0, 5, 4, 3],
    soul:       [0, 3, 4, 5],
    rnb:        isMinor ? [0, 5, 3, 4] : [0, 5, 1, 4],
  };
  return map[genre] ?? (isMinor ? [0, 5, 3, 4] : [0, 4, 5, 3]);
}

export function degreeToChord(rootMidi: number, degree: number, isMinor: boolean): number[] {
  const scale = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const triadQualities = isMinor
    ? ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj']
    : ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
  const scaleDegree = ((degree % 7) + 7) % 7;
  const chordRoot = rootMidi + scale[scaleDegree];
  const quality = triadQualities[scaleDegree];
  const intervals = quality === 'maj' ? [0, 4, 7] : quality === 'min' ? [0, 3, 7] : [0, 3, 6];
  return intervals.map(interval => chordRoot + interval);
}

// ─── Note factories ───────────────────────────────────────────────────────────

export function makeNote(midi: number, startBeats: number, durationBeats: number, velocity: number): NoteEvent {
  return { midi, startBeats, durationBeats, velocity };
}

// ─── Pattern generators ───────────────────────────────────────────────────────

type ChordBar = { barIndex: number; degree: number; chord: number[] };

export function createLocalInstrumentNotes(
  instrument: Instrument,
  chordBars: ChordBar[],
  beatsPerBar: number,
  genre: Genre,
): NoteEvent[] {
  if (instrument === 'bass') return createBassNotes(chordBars, beatsPerBar, genre);
  if (
    instrument === 'piano' ||
    instrument === 'organ' ||
    instrument === 'vibraphone' ||
    instrument === 'harp'
  ) {
    return createChordInstrumentNotes(instrument, chordBars, beatsPerBar, genre);
  }
  if (instrument === 'guitar-acoustic' || instrument === 'guitar-electric') {
    return createGuitarNotes(chordBars, beatsPerBar, genre);
  }
  if (instrument === 'strings' || instrument === 'synth-pad' || instrument === 'choir') {
    return createPadNotes(chordBars, beatsPerBar);
  }
  return createLeadNotes(instrument, chordBars, beatsPerBar, genre);
}

function createBassNotes(chordBars: ChordBar[], beatsPerBar: number, genre: Genre): NoteEvent[] {
  const syncopated = genre === 'funk' || genre === 'hip-hop' || genre === 'latin' || genre === 'rnb';
  return chordBars.flatMap(({ barIndex, chord }, index) => {
    const root = chord[0] - 24;
    const fifth = chord[2] - 24;
    const nextRoot = chordBars[index + 1]?.chord[0] ?? chord[0];
    const walkTarget = nextRoot - 24 + (nextRoot > chord[0] ? -2 : 2);
    const baseBeat = barIndex * beatsPerBar;
    if (syncopated) {
      return [
        makeNote(root, baseBeat, 0.75, 0.88),
        makeNote(fifth, baseBeat + 1.5, 0.45, 0.7),
        makeNote(root, baseBeat + 2, 0.75, 0.84),
        makeNote(walkTarget, baseBeat + Math.max(2.75, beatsPerBar - 0.5), 0.4, 0.68),
      ];
    }
    return [
      makeNote(root, baseBeat, 0.95, 0.86),
      makeNote(fifth, baseBeat + Math.max(1, beatsPerBar / 2), 0.55, 0.7),
      makeNote(root, baseBeat + Math.max(2, beatsPerBar - 2), 0.85, 0.8),
      makeNote(walkTarget, baseBeat + Math.max(3, beatsPerBar - 1), 0.45, 0.65),
    ];
  });
}

function createChordInstrumentNotes(
  instrument: Instrument,
  chordBars: ChordBar[],
  beatsPerBar: number,
  genre: Genre,
): NoteEvent[] {
  const broken = instrument === 'harp' || instrument === 'vibraphone' || genre === 'jazz';
  return chordBars.flatMap(({ barIndex, chord }) => {
    const voiced = chord.map((midi, noteIndex) => midi + 12 + (noteIndex === 2 ? 12 : 0));
    const baseBeat = barIndex * beatsPerBar;
    if (broken) {
      return voiced.flatMap((midi, noteIndex) => [
        makeNote(midi, baseBeat + noteIndex * 0.5, 0.42, 0.6 + noteIndex * 0.08),
        makeNote(midi + (noteIndex === 0 ? 12 : 0), baseBeat + 2 + noteIndex * 0.35, 0.38, 0.54 + noteIndex * 0.06),
      ]);
    }
    return voiced.flatMap((midi, noteIndex) => [
      makeNote(midi, baseBeat, Math.max(1.2, beatsPerBar * 0.45), 0.58 + noteIndex * 0.06),
      makeNote(midi, baseBeat + Math.max(2, beatsPerBar / 2), Math.max(0.85, beatsPerBar * 0.35), 0.48 + noteIndex * 0.05),
    ]);
  });
}

// Build a 4-string guitar chord voicing with root in the E2–G3 zone (MIDI 40–55).
// chord = [rootMidi, thirdMidi, fifthMidi] — typically in the 60–71 octave from keyToRootMidi.
export function guitarChordVoicing(chord: number[]): [number, number, number, number] {
  let baseRoot = chord[0];
  while (baseRoot > 55) baseRoot -= 12;
  while (baseRoot < 40) baseRoot += 12;
  const thirdInterval = chord[1] - chord[0];
  const fifthInterval = chord[2] - chord[0];
  return [baseRoot, baseRoot + 12, baseRoot + 12 + thirdInterval, baseRoot + 12 + fifthInterval];
}

function createGuitarNotes(chordBars: ChordBar[], beatsPerBar: number, genre: Genre): NoteEvent[] {
  const upbeat = genre === 'reggae' || genre === 'funk';
  const fingerpick = genre === 'classical' || genre === 'country' || genre === 'blues';

  return chordBars.flatMap(({ barIndex, chord }) => {
    const voiced = guitarChordVoicing(chord);
    const barStart = barIndex * beatsPerBar;

    if (fingerpick) {
      const pattern = [0, 2, 1, 3, 0, 2, 3, 2];
      const subBeats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].filter(b => b < beatsPerBar);
      return subBeats.map((beat, i) => makeNote(
        voiced[pattern[i % pattern.length]],
        barStart + beat,
        beat % 1 === 0 ? 0.55 : 0.35,
        beat % 1 === 0 ? 0.7 : 0.52,
      ));
    }

    const strokeBeats = upbeat
      ? [0.5, 1.5, 2.5, 3.5].filter(b => b < beatsPerBar)
      : [0, 1.5, 2, 3].filter(b => b < beatsPerBar);
    const STRING_SPREAD_BEATS = 0.025;

    return strokeBeats.flatMap((strokeBeat, strokeIndex) => {
      const isDownstroke = !upbeat || strokeIndex % 2 === 0;
      const strings: readonly number[] = isDownstroke ? voiced : [...voiced].reverse();
      const noteDuration = upbeat ? 0.18 : 0.28;
      return strings.map((midi, stringIndex) => makeNote(
        midi,
        barStart + strokeBeat + stringIndex * STRING_SPREAD_BEATS,
        noteDuration,
        isDownstroke ? 0.66 - stringIndex * 0.04 : 0.58 + stringIndex * 0.03,
      ));
    });
  });
}

function createPadNotes(chordBars: ChordBar[], beatsPerBar: number): NoteEvent[] {
  return chordBars.flatMap(({ barIndex, chord }) => {
    const baseBeat = barIndex * beatsPerBar;
    return chord.map((midi, noteIndex) =>
      makeNote(midi + 12 + noteIndex * 5, baseBeat, beatsPerBar * 0.96, 0.5 + noteIndex * 0.05),
    );
  });
}

function createLeadNotes(
  instrument: Instrument,
  chordBars: ChordBar[],
  beatsPerBar: number,
  genre: Genre,
): NoteEvent[] {
  const stepPattern = genre === 'jazz' || genre === 'blues'
    ? [0, 1, 2, 1]
    : genre === 'latin' || genre === 'funk'
      ? [0, 2, 1, 2]
      : [0, 1, 0, 2];
  const octaveOffset = instrument === 'cello' || instrument === 'trombone' ? 0 : 12;

  return chordBars.flatMap(({ barIndex, chord }, barIdx) => {
    const barStart = barIndex * beatsPerBar;
    const melodySource = [chord[0], chord[1], chord[2], chord[1]];
    return stepPattern
      .filter((_, noteIndex) => noteIndex < beatsPerBar)
      .map((step, noteIndex) => makeNote(
        melodySource[(step + barIdx) % melodySource.length] + octaveOffset,
        barStart + noteIndex + (noteIndex === 1 && (genre === 'latin' || genre === 'rnb') ? 0.25 : 0),
        instrument === 'strings' ? 0.8 : 0.6,
        0.52 + (noteIndex % 2) * 0.1,
      ));
  });
}

export function createLocalDrumPattern(genre: Genre, beatsPerBar: number, bars: number): DrumHitEvent[] {
  const events: DrumHitEvent[] = [];
  for (let barIndex = 0; barIndex < bars; barIndex += 1) {
    const barStart = barIndex * beatsPerBar;
    for (let step = 0; step < beatsPerBar * 2; step += 1) {
      const beat = barStart + step * 0.5;
      if (step % 2 === 0) {
        events.push({ kind: 'hat', startBeats: beat, velocity: genre === 'jazz' ? 0.42 : 0.52 });
      } else if (genre !== 'metal') {
        events.push({ kind: 'hat', startBeats: beat, velocity: 0.32 });
      }
    }

    events.push({ kind: 'kick', startBeats: barStart, velocity: 0.95 });
    if (beatsPerBar > 2) events.push({ kind: 'snare', startBeats: barStart + 2, velocity: 0.88 });
    if (genre === 'funk' || genre === 'hip-hop' || genre === 'latin' || genre === 'rnb') {
      events.push({ kind: 'kick', startBeats: barStart + 1.5, velocity: 0.72 });
      events.push({ kind: 'snare', startBeats: barStart + 3, velocity: 0.7 });
    } else if (genre === 'rock' || genre === 'metal') {
      events.push({ kind: 'kick', startBeats: barStart + 1.5, velocity: 0.82 });
      events.push({ kind: 'kick', startBeats: barStart + 3, velocity: 0.78 });
    } else if (genre === 'reggae') {
      events.push({ kind: 'kick', startBeats: barStart + 2.5, velocity: 0.76 });
      events.push({ kind: 'snare', startBeats: barStart + 3, velocity: 0.64 });
    }
  }
  return events;
}
