import { describe, expect, it } from 'vitest';
import { initialDAWState } from '../../src/context/dawReducer';
import { createInitialHistoryState, dawHistoryReducer } from '../../src/context/historyReducer';

describe('dawHistoryReducer', () => {
  it('tracks editable actions and supports undo/redo', () => {
    const base = createInitialHistoryState(initialDAWState);
    const withBpm = dawHistoryReducer(base, { type: 'SET_BPM', payload: 132 });

    expect(withBpm.present.bpm).toBe(132);
    expect(withBpm.past).toHaveLength(1);

    const undone = dawHistoryReducer(withBpm, { type: 'UNDO' });
    expect(undone.present.bpm).toBe(initialDAWState.bpm);
    expect(undone.future).toHaveLength(1);

    const redone = dawHistoryReducer(undone, { type: 'REDO' });
    expect(redone.present.bpm).toBe(132);
    expect(redone.past).toHaveLength(1);
  });

  it('does not create undo snapshots for transport-only time updates', () => {
    const base = createInitialHistoryState(initialDAWState);
    const withTime = dawHistoryReducer(base, { type: 'SET_CURRENT_TIME', payload: 12.5 });

    expect(withTime.present.currentTime).toBe(12.5);
    expect(withTime.past).toHaveLength(0);
  });

  it('clears future branch when editing after undo', () => {
    const base = createInitialHistoryState(initialDAWState);
    const withBpm = dawHistoryReducer(base, { type: 'SET_BPM', payload: 130 });
    const withMaster = dawHistoryReducer(withBpm, { type: 'SET_MASTER_VOLUME', payload: 0.7 });
    const undone = dawHistoryReducer(withMaster, { type: 'UNDO' });
    const branched = dawHistoryReducer(undone, { type: 'SET_BPM', payload: 118 });

    expect(undone.future).toHaveLength(1);
    expect(branched.future).toHaveLength(0);
    expect(branched.present.bpm).toBe(118);
  });

  it('resets undo/redo stacks after load project', () => {
    const base = createInitialHistoryState(initialDAWState);
    const withBpm = dawHistoryReducer(base, { type: 'SET_BPM', payload: 140 });
    const loaded = dawHistoryReducer(withBpm, {
      type: 'LOAD_PROJECT',
      payload: { projectName: 'Loaded Session', bpm: 96 },
    });

    expect(loaded.present.projectName).toBe('Loaded Session');
    expect(loaded.present.bpm).toBe(96);
    expect(loaded.past).toHaveLength(0);
    expect(loaded.future).toHaveLength(0);
  });
});
