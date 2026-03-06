/**
 * noteGenerators.test.ts
 *
 * Focused tests for the pure music-theory / pattern-generation helpers in
 * noteGenerators.ts (no Web Audio API, safe for jsdom / Vitest).
 *
 * Coverage:
 *   - clampToInstrumentRange  (range clamp + octave-fold logic)
 *   - midiToFrequency         (pitch math)
 *   - keyToRootMidi           (key string parsing)
 *   - guitarChordVoicing      (root zone clamping + interval preservation)
 *   - degreeToChord           (scale degree → triad MIDI notes)
 *   - getGenreProgression     (genre-specific degree sequences)
 *   - createLocalDrumPattern  (drum kind, hit placement, genre variants)
 *   - makeNote                (factory shape)
 */

import { describe, expect, it } from 'vitest';
import type { DrumHitEvent } from '../../src/types/daw';
import {
  INSTRUMENT_MIDI_RANGE,
  clampToInstrumentRange,
  createLocalDrumPattern,
  degreeToChord,
  getGenreProgression,
  guitarChordVoicing,
  keyToRootMidi,
  makeNote,
  midiToFrequency,
} from '../../src/lib/noteGenerators';

// ─── clampToInstrumentRange ───────────────────────────────────────────────────

describe('clampToInstrumentRange', () => {
  it('returns the same value when already in range', () => {
    expect(clampToInstrumentRange(60, 'piano')).toBe(60);
  });

  it('rounds a float to the nearest integer', () => {
    expect(clampToInstrumentRange(60.7, 'piano')).toBe(61);
    expect(clampToInstrumentRange(60.3, 'piano')).toBe(60);
  });

  it('octave-folds upward when note is below the low bound', () => {
    // bass range is [28, 55]; MIDI 16 is two octaves below 40
    const result = clampToInstrumentRange(16, 'bass');
    const [lo, hi] = INSTRUMENT_MIDI_RANGE['bass']!;
    expect(result).toBeGreaterThanOrEqual(lo);
    expect(result).toBeLessThanOrEqual(hi);
  });

  it('octave-folds downward when note is above the high bound', () => {
    // guitar-acoustic range is [40, 84]; MIDI 109 is too high
    const result = clampToInstrumentRange(109, 'guitar-acoustic');
    const [lo, hi] = INSTRUMENT_MIDI_RANGE['guitar-acoustic']!;
    expect(result).toBeGreaterThanOrEqual(lo);
    expect(result).toBeLessThanOrEqual(hi);
  });

  it('folds a note 2 octaves above the limit back into range', () => {
    // flute range is [60, 96]; MIDI 120 needs two downward folds
    const result = clampToInstrumentRange(120, 'flute');
    expect(result).toBe(96); // 120 - 12 = 108, still > 96; 108 - 12 = 96 → clamped at hi
  });

  it('handles the exact low boundary without modification', () => {
    const [lo] = INSTRUMENT_MIDI_RANGE['cello']!;
    expect(clampToInstrumentRange(lo, 'cello')).toBe(lo);
  });

  it('handles the exact high boundary without modification', () => {
    const [, hi] = INSTRUMENT_MIDI_RANGE['violin']!;
    expect(clampToInstrumentRange(hi, 'violin')).toBe(hi);
  });

  it('returns rounded value for instruments with no defined range', () => {
    // 'drums' is not in INSTRUMENT_MIDI_RANGE
    // @ts-expect-error intentionally passing unknown instrument
    expect(clampToInstrumentRange(130.4, 'drums')).toBe(130);
  });
});

// ─── midiToFrequency ─────────────────────────────────────────────────────────

describe('midiToFrequency', () => {
  it('A4 (MIDI 69) = 440 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 2);
  });

  it('A5 (MIDI 81) = 880 Hz (one octave up doubles frequency)', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 2);
  });

  it('A3 (MIDI 57) = 220 Hz (one octave down halves frequency)', () => {
    expect(midiToFrequency(57)).toBeCloseTo(220, 2);
  });

  it('Middle C (MIDI 60) ≈ 261.63 Hz', () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });

  it('each semitone increases frequency by factor 2^(1/12)', () => {
    const ratio = midiToFrequency(70) / midiToFrequency(69);
    expect(ratio).toBeCloseTo(Math.pow(2, 1 / 12), 6);
  });
});

// ─── keyToRootMidi ────────────────────────────────────────────────────────────

describe('keyToRootMidi', () => {
  it('C → MIDI 60', () => expect(keyToRootMidi('C')).toBe(60));
  it('G → MIDI 67', () => expect(keyToRootMidi('G')).toBe(67));
  it('F → MIDI 65', () => expect(keyToRootMidi('F')).toBe(65));
  it('D → MIDI 62', () => expect(keyToRootMidi('D')).toBe(62));

  it('F# (sharp notation) → MIDI 66', () => {
    expect(keyToRootMidi('F#')).toBe(66);
  });

  it('Bb / As → same result as A# (MIDI 70)', () => {
    // 'As' normalises internally; 'Bb' would need external conversion
    expect(keyToRootMidi('As')).toBe(70);
  });

  it('strips trailing minor "m" from key string', () => {
    // Am → A after strip, same as 'A' → MIDI 69
    expect(keyToRootMidi('Am')).toBe(keyToRootMidi('A'));
  });

  it('returns 60 (C) for unknown pitch-class strings', () => {
    expect(keyToRootMidi('X')).toBe(60);
  });
});

// ─── guitarChordVoicing ───────────────────────────────────────────────────────

describe('guitarChordVoicing', () => {
  // C major chord from degreeToChord at root=60: [60, 64, 67]
  const cMajor = [60, 64, 67];

  it('returns a 4-element tuple', () => {
    const voicing = guitarChordVoicing(cMajor);
    expect(voicing).toHaveLength(4);
  });

  it('bass note (first string) is in E2–G3 zone (MIDI 40–55)', () => {
    const [root] = guitarChordVoicing(cMajor);
    expect(root).toBeGreaterThanOrEqual(40);
    expect(root).toBeLessThanOrEqual(55);
  });

  it('preserves major-third interval between strings 2 and 3', () => {
    const [, s2, s3] = guitarChordVoicing(cMajor);
    const thirdInterval = cMajor[1] - cMajor[0]; // 4 semitones for major third
    expect(s3 - s2).toBe(thirdInterval);
  });

  it('preserves perfect-fifth interval between strings 2 and 4', () => {
    const [, s2, , s4] = guitarChordVoicing(cMajor);
    const fifthInterval = cMajor[2] - cMajor[0]; // 7 semitones
    expect(s4 - s2).toBe(fifthInterval);
  });

  it('folds a very high root down into range', () => {
    const highChord = [84, 88, 91]; // root way above 55
    const [root] = guitarChordVoicing(highChord);
    expect(root).toBeGreaterThanOrEqual(40);
    expect(root).toBeLessThanOrEqual(55);
  });

  it('folds a very low root up into range', () => {
    const lowChord = [28, 32, 35]; // root below 40
    const [root] = guitarChordVoicing(lowChord);
    expect(root).toBeGreaterThanOrEqual(40);
    expect(root).toBeLessThanOrEqual(55);
  });
});

// ─── degreeToChord ────────────────────────────────────────────────────────────

describe('degreeToChord', () => {
  // C major root = 60
  it('degree 0 in C major → C major triad [60, 64, 67]', () => {
    expect(degreeToChord(60, 0, false)).toEqual([60, 64, 67]);
  });

  it('degree 1 in C major → D minor triad', () => {
    // D is 2 semitones up (62), minor = [0,3,7] → [62, 65, 69]
    expect(degreeToChord(60, 1, false)).toEqual([62, 65, 69]);
  });

  it('degree 6 in C major → B diminished triad', () => {
    // B = root + 11 = 71, dim = [0,3,6] → [71, 74, 77]
    expect(degreeToChord(60, 6, false)).toEqual([71, 74, 77]);
  });

  it('degree 0 in A minor → A minor triad', () => {
    // A = 60 + 9 = 69, minor = [0,3,7] → [69, 72, 76]
    expect(degreeToChord(69, 0, true)).toEqual([69, 72, 76]);
  });

  it('degree 2 in A minor → C major triad', () => {
    // minor scale degree 2 offset = 3 semitones → C=72, quality='maj' → [72, 76, 79]
    expect(degreeToChord(69, 2, true)).toEqual([72, 76, 79]);
  });

  it('returns 3 notes for every chord', () => {
    for (let deg = 0; deg < 7; deg += 1) {
      expect(degreeToChord(60, deg, false)).toHaveLength(3);
      expect(degreeToChord(60, deg, true)).toHaveLength(3);
    }
  });

  it('wraps degree values >= 7 via modulo', () => {
    // degree 7 → same as degree 0
    expect(degreeToChord(60, 7, false)).toEqual(degreeToChord(60, 0, false));
  });
});

// ─── getGenreProgression ─────────────────────────────────────────────────────

describe('getGenreProgression', () => {
  it('pop major → [0, 4, 5, 3] (I–V–VI–IV)', () => {
    expect(getGenreProgression('pop', false)).toEqual([0, 4, 5, 3]);
  });

  it('pop minor → [0, 5, 3, 4]', () => {
    expect(getGenreProgression('pop', true)).toEqual([0, 5, 3, 4]);
  });

  it('blues → [0, 0, 3, 0] regardless of major/minor', () => {
    expect(getGenreProgression('blues', false)).toEqual([0, 0, 3, 0]);
    expect(getGenreProgression('blues', true)).toEqual([0, 0, 3, 0]);
  });

  it('country → [0, 3, 4, 0] (I–IV–V–I)', () => {
    expect(getGenreProgression('country', false)).toEqual([0, 3, 4, 0]);
    expect(getGenreProgression('country', true)).toEqual([0, 3, 4, 0]);
  });

  it('rock minor → [0, 5, 3, 4]', () => {
    expect(getGenreProgression('rock', true)).toEqual([0, 5, 3, 4]);
  });

  it('jazz always uses [1, 4, 0, 5] (ii–V–I–VI)', () => {
    expect(getGenreProgression('jazz', false)).toEqual([1, 4, 0, 5]);
    expect(getGenreProgression('jazz', true)).toEqual([1, 4, 0, 5]);
  });

  it('returns 4 degrees for all genres', () => {
    const genres = [
      'pop', 'rock', 'jazz', 'blues', 'hip-hop', 'electronic',
      'classical', 'country', 'funk', 'latin', 'reggae', 'metal', 'soul', 'rnb',
    ] as const;
    for (const genre of genres) {
      expect(getGenreProgression(genre, false)).toHaveLength(4);
    }
  });
});

// ─── createLocalDrumPattern ───────────────────────────────────────────────────

describe('createLocalDrumPattern', () => {
  const beatsPerBar = 4;

  it('always places a kick on beat 0 of every bar', () => {
    const hits = createLocalDrumPattern('pop', beatsPerBar, 4);
    for (let bar = 0; bar < 4; bar += 1) {
      const barStart = bar * beatsPerBar;
      const kickOnOne = hits.find(h => h.kind === 'kick' && h.startBeats === barStart);
      expect(kickOnOne).toBeTruthy();
    }
  });

  it('places a snare on beat 2 of every bar (when beatsPerBar > 2)', () => {
    const hits = createLocalDrumPattern('pop', beatsPerBar, 2);
    for (let bar = 0; bar < 2; bar += 1) {
      const barStart = bar * beatsPerBar;
      const snareOnTwo = hits.find(h => h.kind === 'snare' && h.startBeats === barStart + 2);
      expect(snareOnTwo).toBeTruthy();
    }
  });

  it('emits only "hat", "kick", and "snare" kinds (no openHat from local pattern)', () => {
    const hits = createLocalDrumPattern('rock', beatsPerBar, 4);
    const kinds = new Set(hits.map(h => h.kind));
    expect([...kinds].every(k => ['hat', 'kick', 'snare'].includes(k))).toBe(true);
  });

  it('hats land on every half-beat (non-metal)', () => {
    const hits = createLocalDrumPattern('pop', beatsPerBar, 1);
    const hats = hits.filter(h => h.kind === 'hat');
    // Expect hat on beat 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5 (8 hats per bar)
    expect(hats).toHaveLength(8);
    const expectedBeats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    for (const beat of expectedBeats) {
      expect(hats.find(h => h.startBeats === beat)).toBeTruthy();
    }
  });

  it('metal skips the off-beat hats (only on-beat hats)', () => {
    const hits = createLocalDrumPattern('metal', beatsPerBar, 1);
    const hats = hits.filter(h => h.kind === 'hat');
    // Only the on-beat steps (step % 2 === 0 in the loop → beats 0, 1, 2, 3)
    expect(hats).toHaveLength(4);
    expect(hats.every(h => h.startBeats % 1 === 0)).toBe(true);
  });

  it('funk/hip-hop/latin/rnb add a syncopated kick on beat 1.5', () => {
    for (const genre of ['funk', 'hip-hop', 'latin', 'rnb'] as const) {
      const hits = createLocalDrumPattern(genre, beatsPerBar, 1);
      const syncKick = hits.find(h => h.kind === 'kick' && h.startBeats === 1.5);
      expect(syncKick, `${genre} should have syncopated kick at 1.5`).toBeTruthy();
    }
  });

  it('funk/hip-hop/latin/rnb add a snare on beat 3', () => {
    for (const genre of ['funk', 'hip-hop', 'latin', 'rnb'] as const) {
      const hits = createLocalDrumPattern(genre, beatsPerBar, 1);
      const snareThree = hits.find(h => h.kind === 'snare' && h.startBeats === 3);
      expect(snareThree, `${genre} should have snare at beat 3`).toBeTruthy();
    }
  });

  it('rock and metal add extra kicks on beats 1.5 and 3', () => {
    for (const genre of ['rock', 'metal'] as const) {
      const hits = createLocalDrumPattern(genre, beatsPerBar, 1);
      const kick15 = hits.find(h => h.kind === 'kick' && h.startBeats === 1.5);
      const kick3  = hits.find(h => h.kind === 'kick' && h.startBeats === 3);
      expect(kick15, `${genre} should have kick at 1.5`).toBeTruthy();
      expect(kick3,  `${genre} should have kick at 3`).toBeTruthy();
    }
  });

  it('reggae adds a kick on beat 2.5 and snare on beat 3', () => {
    const hits = createLocalDrumPattern('reggae', beatsPerBar, 1);
    expect(hits.find(h => h.kind === 'kick' && h.startBeats === 2.5)).toBeTruthy();
    expect(hits.find(h => h.kind === 'snare' && h.startBeats === 3)).toBeTruthy();
  });

  it('scales correctly across multiple bars', () => {
    const hits4 = createLocalDrumPattern('pop', beatsPerBar, 4);
    const hits1 = createLocalDrumPattern('pop', beatsPerBar, 1);
    // 4-bar pattern should have exactly 4× the events of 1-bar
    expect(hits4).toHaveLength(hits1.length * 4);
  });

  it('jazz hats have lower velocity (0.42) vs non-jazz (0.52)', () => {
    const jazzHits = createLocalDrumPattern('jazz', beatsPerBar, 1);
    const popHits  = createLocalDrumPattern('pop',  beatsPerBar, 1);
    const jazzOnBeatHat  = jazzHits.find(h => h.kind === 'hat' && h.startBeats % 1 === 0)!;
    const popOnBeatHat   = popHits.find(h => h.kind === 'hat' && h.startBeats % 1 === 0)!;
    expect(jazzOnBeatHat.velocity).toBe(0.42);
    expect(popOnBeatHat.velocity).toBe(0.52);
  });

  it('all hit velocities are in (0, 1] range', () => {
    const hits = createLocalDrumPattern('funk', beatsPerBar, 4) as DrumHitEvent[];
    for (const hit of hits) {
      expect(hit.velocity).toBeGreaterThan(0);
      expect(hit.velocity).toBeLessThanOrEqual(1);
    }
  });

  it('all startBeats values are non-negative', () => {
    const hits = createLocalDrumPattern('rock', beatsPerBar, 4);
    for (const hit of hits) {
      expect(hit.startBeats).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── makeNote ─────────────────────────────────────────────────────────────────

describe('makeNote', () => {
  it('creates a NoteEvent with the supplied fields', () => {
    const note = makeNote(60, 0, 1, 0.8);
    expect(note).toEqual({ midi: 60, startBeats: 0, durationBeats: 1, velocity: 0.8 });
  });

  it('does not mutate inputs or share references', () => {
    const a = makeNote(60, 0, 1, 0.5);
    const b = makeNote(60, 0, 1, 0.5);
    expect(a).not.toBe(b);
  });
});
