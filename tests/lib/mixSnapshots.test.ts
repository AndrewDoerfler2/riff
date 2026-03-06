import { describe, expect, it } from 'vitest';
import { initialDAWState, makePlugin } from '../../src/context/dawReducer';
import { captureMixSnapshot, getAlternateSnapshotSlot } from '../../src/lib/mixSnapshots';

describe('mixSnapshots utilities', () => {
  it('captures a deep-cloned snapshot of mix settings', () => {
    const eq = makePlugin('eq');
    eq.parameters.low = -3;
    const masterLimiter = makePlugin('limiter');
    masterLimiter.parameters.threshold = -1;

    const state = {
      tracks: [
        {
          ...initialDAWState.tracks[0],
          volume: 0.61,
          pan: -0.2,
          muted: true,
          soloed: false,
          busRouteId: 'bus-1',
          plugins: [eq],
        },
      ],
      masterPlugins: [masterLimiter],
      masterVolume: 0.77,
    };

    const snapshot = captureMixSnapshot(state);

    expect(snapshot.masterVolume).toBe(0.77);
    expect(snapshot.trackSnapshots[0]).toMatchObject({
      id: state.tracks[0].id,
      volume: 0.61,
      pan: -0.2,
      muted: true,
      soloed: false,
      busRouteId: 'bus-1',
    });
    expect(snapshot.trackSnapshots[0].plugins[0].parameters.low).toBe(-3);
    expect(snapshot.masterPlugins[0].parameters.threshold).toBe(-1);

    eq.parameters.low = -12;
    masterLimiter.parameters.threshold = -6;

    expect(snapshot.trackSnapshots[0].plugins[0].parameters.low).toBe(-3);
    expect(snapshot.masterPlugins[0].parameters.threshold).toBe(-1);
  });

  it('selects the next A/B slot correctly for toggles', () => {
    const snapshots = {
      A: { capturedAt: 1, masterVolume: 0.7, trackSnapshots: [], masterPlugins: [] },
      B: { capturedAt: 2, masterVolume: 0.8, trackSnapshots: [], masterPlugins: [] },
    };

    expect(getAlternateSnapshotSlot('A', snapshots)).toBe('B');
    expect(getAlternateSnapshotSlot('B', snapshots)).toBe('A');
    expect(getAlternateSnapshotSlot(null, snapshots)).toBe('A');
    expect(getAlternateSnapshotSlot('A', { A: snapshots.A })).toBeNull();
    expect(getAlternateSnapshotSlot('B', { B: snapshots.B })).toBeNull();
  });
});
