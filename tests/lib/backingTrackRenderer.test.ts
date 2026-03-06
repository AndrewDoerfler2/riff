import { describe, expect, it } from 'vitest';
import { clampToInstrumentRange } from '../../src/lib/noteGenerators';
import {
  pickDrumSample,
  rankSamples,
  resolveDrumHitKind,
  type DrumSampleEntry,
  type SampleMetadata,
} from '../../src/lib/backingTrackRenderer';

function makeSample(overrides: Partial<SampleMetadata>): SampleMetadata {
  return {
    family: 'violin',
    midi: 60,
    durationToken: '1',
    durationSeconds: 1,
    dynamic: 'mezzo-forte',
    dynamicRank: 3,
    articulation: 'normal',
    urlPath: '/samples/mock.mp3',
    ...overrides,
  };
}

describe('renderer helper: note range clamping', () => {
  it('folds out-of-range notes into instrument bounds', () => {
    expect(clampToInstrumentRange(117, 'guitar-acoustic')).toBe(81);
    expect(clampToInstrumentRange(20, 'bass')).toBe(32);
  });

  it('returns rounded values for instruments without a configured clamp', () => {
    expect(clampToInstrumentRange(63.6, 'drums')).toBe(64);
  });
});

describe('renderer helper: sample ranking', () => {
  it('prefers short articulations for short non-legato note durations', () => {
    const candidates: SampleMetadata[] = [
      makeSample({ articulation: 'normal', durationSeconds: 1, dynamicRank: 3, urlPath: '/samples/normal.mp3' }),
      makeSample({ articulation: 'staccato', durationSeconds: 0.2, dynamicRank: 3, urlPath: '/samples/staccato.mp3' }),
    ];

    const ranked = rankSamples(candidates, 60, 0.12, 0.65, 'guitar-electric', 'guitar');
    expect(ranked[0]?.articulation).toContain('staccato');
  });

  it('prefers connected articulations for longer notes', () => {
    const candidates: SampleMetadata[] = [
      makeSample({ articulation: 'pizz', durationSeconds: 0.2, dynamicRank: 3, urlPath: '/samples/pizz.mp3' }),
      makeSample({ articulation: 'legato', durationSeconds: 1.2, dynamicRank: 3, urlPath: '/samples/legato.mp3' }),
    ];

    const ranked = rankSamples(candidates, 60, 1.1, 0.7, 'violin', 'violin');
    expect(ranked[0]?.articulation).toContain('legato');
  });

  it('penalizes excluded articulations when ranking', () => {
    const candidates: SampleMetadata[] = [
      makeSample({ articulation: 'normal', dynamicRank: 4, durationSeconds: 0.5, urlPath: '/samples/normal.mp3' }),
      makeSample({ articulation: 'fluttertonguing', dynamicRank: 4, durationSeconds: 0.5, urlPath: '/samples/flutter.mp3' }),
    ];

    const ranked = rankSamples(candidates, 60, 0.5, 0.9, 'flute', 'flute');
    expect(ranked[0]?.articulation).toContain('normal');
  });
});

describe('renderer helper: drum kind and sample selection', () => {
  it('resolves an isolated offbeat hat to openHat', () => {
    const kind = resolveDrumHitKind(
      [
        { kind: 'kick', startBeats: 0, velocity: 0.9 },
        { kind: 'hat', startBeats: 0.5, velocity: 0.5 },
        { kind: 'snare', startBeats: 1.5, velocity: 0.8 },
      ],
      1,
    );

    expect(kind).toBe('openHat');
  });

  it('keeps tightly spaced hats closed', () => {
    const kind = resolveDrumHitKind(
      [
        { kind: 'hat', startBeats: 0, velocity: 0.45 },
        { kind: 'hat', startBeats: 0.5, velocity: 0.5 },
        { kind: 'hat', startBeats: 1, velocity: 0.45 },
      ],
      1,
    );

    expect(kind).toBe('hat');
  });

  it('uses round-robin index among top-ranked drum samples', () => {
    const entries: DrumSampleEntry[] = [
      { kind: 'hat', durationSeconds: 0.19, dynamicRank: 3, urlPath: '/samples/hat-a.mp3' },
      { kind: 'hat', durationSeconds: 0.21, dynamicRank: 3, urlPath: '/samples/hat-b.mp3' },
      { kind: 'hat', durationSeconds: 0.2, dynamicRank: 3, urlPath: '/samples/hat-c.mp3' },
      { kind: 'hat', durationSeconds: 0.2, dynamicRank: 1, urlPath: '/samples/hat-soft.mp3' },
    ];

    const first = pickDrumSample(entries, 0.66, 0);
    const second = pickDrumSample(entries, 0.66, 1);
    const third = pickDrumSample(entries, 0.66, 2);

    expect(first?.urlPath).toBe('/samples/hat-a.mp3');
    expect(second?.urlPath).toBe('/samples/hat-c.mp3');
    expect(third?.urlPath).toBe('/samples/hat-b.mp3');
  });
});
