import { describe, expect, it } from 'vitest';
import { maybeSnapTime, MIN_CLIP_DURATION_SECONDS, snapTimeToBeat } from '../../src/lib/timelineSnap';

describe('timeline snap utilities', () => {
  it('snaps a time value to nearest beat at current bpm', () => {
    // 120 BPM => 0.5s per beat.
    expect(snapTimeToBeat(0.22, 120)).toBeCloseTo(0, 6);
    expect(snapTimeToBeat(0.31, 120)).toBeCloseTo(0.5, 6);
    expect(snapTimeToBeat(1.24, 120)).toBeCloseTo(1, 6);
  });

  it('returns original time when snap is disabled', () => {
    expect(maybeSnapTime(1.234, 120, false)).toBeCloseTo(1.234, 6);
  });

  it('keeps minimum clip duration constant exposed for trim bounds', () => {
    expect(MIN_CLIP_DURATION_SECONDS).toBe(0.05);
  });
});
