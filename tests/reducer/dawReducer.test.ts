import { describe, expect, it, beforeEach } from 'vitest';
import type { AudioClip, DAWState, NoteEvent, Track } from '../../src/types/daw';
import { dawReducer, initialDAWState, makePlugin, makeTrack } from '../../src/context/dawReducer';

function makeState(overrides?: Partial<DAWState>): DAWState {
  const clone: DAWState = {
    ...initialDAWState,
    tracks: initialDAWState.tracks.map((track) => ({
      ...track,
      clips: [...track.clips],
      videoClips: [...track.videoClips],
      plugins: track.plugins.map((plugin) => ({
        ...plugin,
        parameters: { ...plugin.parameters },
      })),
    })),
    masterPlugins: initialDAWState.masterPlugins.map((plugin) => ({
      ...plugin,
      parameters: { ...plugin.parameters },
    })),
    aiConfig: {
      ...initialDAWState.aiConfig,
      instruments: [...initialDAWState.aiConfig.instruments],
    },
  };

  if (!overrides) return clone;

  return {
    ...clone,
    ...overrides,
    tracks: overrides.tracks ?? clone.tracks,
    masterPlugins: overrides.masterPlugins ?? clone.masterPlugins,
    aiConfig: overrides.aiConfig ? { ...clone.aiConfig, ...overrides.aiConfig } : clone.aiConfig,
  };
}

function makeClip(partial?: Partial<AudioClip>): AudioClip {
  return {
    id: 'clip-1',
    name: 'Clip 1',
    startTime: 2,
    duration: 4,
    audioBuffer: null,
    waveformPeaks: [0.1, 0.5, 0.2],
    color: '#0a84ff',
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    offset: 0,
    ...partial,
  };
}

describe('dawReducer', () => {
  it('clamps bpm to minimum and maximum bounds', () => {
    const lowState = dawReducer(initialDAWState, { type: 'SET_BPM', payload: 10 });
    const highState = dawReducer(initialDAWState, { type: 'SET_BPM', payload: 400 });

    expect(lowState.bpm).toBe(20);
    expect(highState.bpm).toBe(300);
  });

  it('adds a new track with ADD_TRACK', () => {
    const nextState = dawReducer(initialDAWState, { type: 'ADD_TRACK', payload: 'midi' });
    expect(nextState.tracks).toHaveLength(initialDAWState.tracks.length + 1);
    expect(nextState.tracks.at(-1)?.type).toBe('midi');
  });

  it('adds clips to the target track only', () => {
    const base = makeState();
    const targetTrack = base.tracks[0];
    const untouchedTrack = base.tracks[1];
    const clip = makeClip();

    const next = dawReducer(base, {
      type: 'ADD_CLIP',
      payload: { trackId: targetTrack.id, clip },
    });

    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[0].clips[0]).toMatchObject({ id: 'clip-1', startTime: 2, duration: 4 });
    expect(next.tracks[1]).toStrictEqual(untouchedTrack);
  });

  it('updates only the addressed track fields', () => {
    const base = makeState();
    const targetTrack = base.tracks[0];
    const originalOtherTrack = base.tracks[1];

    const next = dawReducer(base, {
      type: 'UPDATE_TRACK',
      payload: { id: targetTrack.id, updates: { volume: 0.42, pan: -0.25, name: 'Lead Vox' } },
    });

    expect(next.tracks[0]).toMatchObject({ name: 'Lead Vox', volume: 0.42, pan: -0.25 });
    expect(next.tracks[1]).toStrictEqual(originalOtherTrack);
  });

  it('updates mixer routing and meter mode for a single track', () => {
    const base = makeState();
    const routedTrack = base.tracks[0];
    const busTrack: Track = {
      ...base.tracks[1],
      id: 'bus-track-1',
      type: 'bus',
      name: 'Bus 1',
    };

    const withBus = makeState({
      tracks: [
        routedTrack,
        busTrack,
        ...base.tracks.slice(2),
      ],
    });

    const routed = dawReducer(withBus, {
      type: 'SET_TRACK_BUS_ROUTE',
      payload: { id: routedTrack.id, busRouteId: busTrack.id },
    });
    const metered = dawReducer(routed, {
      type: 'SET_TRACK_METER_MODE',
      payload: { id: routedTrack.id, mode: 'pre' },
    });

    expect(metered.tracks[0].busRouteId).toBe('bus-track-1');
    expect(metered.tracks[0].meterMode).toBe('pre');
    expect(metered.tracks[1].meterMode).toBe(withBus.tracks[1].meterMode);
  });

  it('merges AI config updates and toggles instruments deterministically', () => {
    const base = makeState({
      aiConfig: {
        ...initialDAWState.aiConfig,
        instruments: ['drums', 'bass'],
        useAiArrangement: true,
        useLocalPatterns: false,
      },
    });

    const updated = dawReducer(base, {
      type: 'UPDATE_AI_CONFIG',
      payload: { useAiArrangement: false, useLocalPatterns: true, progress: 55 },
    });

    expect(updated.aiConfig).toMatchObject({
      useAiArrangement: false,
      useLocalPatterns: true,
      progress: 55,
    });

    const addedInstrument = dawReducer(updated, { type: 'TOGGLE_INSTRUMENT', payload: 'piano' });
    const removedInstrument = dawReducer(addedInstrument, { type: 'TOGGLE_INSTRUMENT', payload: 'bass' });

    expect(addedInstrument.aiConfig.instruments).toEqual(['drums', 'bass', 'piano']);
    expect(removedInstrument.aiConfig.instruments).toEqual(['drums', 'piano']);
  });

  it('supports master plugin add/update/remove flow', () => {
    const base = makeState();
    const plugin = makePlugin('compressor');

    const added = dawReducer(base, { type: 'ADD_MASTER_PLUGIN', payload: plugin });
    expect(added.masterPlugins).toHaveLength(1);

    const updated = dawReducer(added, {
      type: 'UPDATE_MASTER_PLUGIN',
      payload: {
        pluginId: plugin.id,
        updates: { enabled: false, parameters: { ...plugin.parameters, ratio: 8 } },
      },
    });

    expect(updated.masterPlugins[0]).toMatchObject({ enabled: false });
    expect(updated.masterPlugins[0].parameters.ratio).toBe(8);

    const removed = dawReducer(updated, { type: 'REMOVE_MASTER_PLUGIN', payload: plugin.id });
    expect(removed.masterPlugins).toHaveLength(0);
  });
});

// ─── Transport: extended coverage ─────────────────────────────────────────────

describe('Transport: extended actions', () => {
  it('SET_PLAYING toggles isPlaying on and off', () => {
    const on = dawReducer(makeState(), { type: 'SET_PLAYING', payload: true });
    expect(on.isPlaying).toBe(true);
    const off = dawReducer(on, { type: 'SET_PLAYING', payload: false });
    expect(off.isPlaying).toBe(false);
  });

  it('SET_RECORDING sets isRecording', () => {
    const s = dawReducer(makeState(), { type: 'SET_RECORDING', payload: true });
    expect(s.isRecording).toBe(true);
  });

  it('SET_CURRENT_TIME updates time', () => {
    const s = dawReducer(makeState(), { type: 'SET_CURRENT_TIME', payload: 7.25 });
    expect(s.currentTime).toBe(7.25);
  });

  it('SET_CURRENT_TIME clamps negative to 0', () => {
    const s = dawReducer(makeState(), { type: 'SET_CURRENT_TIME', payload: -2 });
    expect(s.currentTime).toBe(0);
  });

  it('SET_BPM boundary: exactly 20 and 300 are accepted unchanged', () => {
    const lo = dawReducer(makeState(), { type: 'SET_BPM', payload: 20 });
    const hi = dawReducer(makeState(), { type: 'SET_BPM', payload: 300 });
    expect(lo.bpm).toBe(20);
    expect(hi.bpm).toBe(300);
  });

  it('SET_BPM accepts valid mid-range value', () => {
    const s = dawReducer(makeState(), { type: 'SET_BPM', payload: 128 });
    expect(s.bpm).toBe(128);
  });

  it('SET_TIME_SIGNATURE updates timeSignature', () => {
    const s = dawReducer(makeState(), { type: 'SET_TIME_SIGNATURE', payload: '6/8' });
    expect(s.timeSignature).toBe('6/8');
  });

  it('TOGGLE_LOOP flips loopEnabled each call', () => {
    const base = makeState();
    const toggled = dawReducer(base, { type: 'TOGGLE_LOOP' });
    expect(toggled.loopEnabled).toBe(!base.loopEnabled);
    const back = dawReducer(toggled, { type: 'TOGGLE_LOOP' });
    expect(back.loopEnabled).toBe(base.loopEnabled);
  });

  it('SET_LOOP_RANGE sets start and end', () => {
    const s = dawReducer(makeState(), { type: 'SET_LOOP_RANGE', payload: { start: 4, end: 20 } });
    expect(s.loopStart).toBe(4);
    expect(s.loopEnd).toBe(20);
  });

  it('TOGGLE_METRONOME flips metronomeEnabled', () => {
    const base = makeState();
    const on = dawReducer(base, { type: 'TOGGLE_METRONOME' });
    expect(on.metronomeEnabled).toBe(!base.metronomeEnabled);
    const off = dawReducer(on, { type: 'TOGGLE_METRONOME' });
    expect(off.metronomeEnabled).toBe(base.metronomeEnabled);
  });

  it('TOGGLE_SNAP flips snapEnabled', () => {
    const base = makeState();
    const toggled = dawReducer(base, { type: 'TOGGLE_SNAP' });
    expect(toggled.snapEnabled).toBe(!base.snapEnabled);
  });

  it('SET_PRE_ROLL_BARS clamps to supported range', () => {
    const low = dawReducer(makeState(), { type: 'SET_PRE_ROLL_BARS', payload: -3 });
    const high = dawReducer(makeState(), { type: 'SET_PRE_ROLL_BARS', payload: 12 });
    const mid = dawReducer(makeState(), { type: 'SET_PRE_ROLL_BARS', payload: 2 });
    expect(low.preRollBars).toBe(0);
    expect(high.preRollBars).toBe(4);
    expect(mid.preRollBars).toBe(2);
  });

  it('SET_ZOOM clamps below 20 and above 600', () => {
    const lo = dawReducer(makeState(), { type: 'SET_ZOOM', payload: 1 });
    const hi = dawReducer(makeState(), { type: 'SET_ZOOM', payload: 9999 });
    expect(lo.zoom).toBe(20);
    expect(hi.zoom).toBe(600);
  });

  it('SET_ZOOM accepts in-range value', () => {
    const s = dawReducer(makeState(), { type: 'SET_ZOOM', payload: 150 });
    expect(s.zoom).toBe(150);
  });

  it('SET_SCROLL_LEFT clamps negative to 0', () => {
    const s = dawReducer(makeState(), { type: 'SET_SCROLL_LEFT', payload: -100 });
    expect(s.scrollLeft).toBe(0);
  });

  it('SET_SCROLL_LEFT accepts positive value', () => {
    const s = dawReducer(makeState(), { type: 'SET_SCROLL_LEFT', payload: 480 });
    expect(s.scrollLeft).toBe(480);
  });
});

// ─── Track: arm / mute / solo / select / remove ────────────────────────────────

describe('Track: arm / mute / solo / select / remove', () => {
  it('ARM_TRACK sets armed flag for the target track only', () => {
    const base = makeState();
    const target = base.tracks[0];
    const s = dawReducer(base, { type: 'ARM_TRACK', payload: { id: target.id, armed: true } });
    expect(s.tracks[0].armed).toBe(true);
    s.tracks.slice(1).forEach(t => expect(t.armed).toBe(false));
  });

  it('MUTE_TRACK mutes the target track only', () => {
    const base = makeState();
    const target = base.tracks[0];
    const s = dawReducer(base, { type: 'MUTE_TRACK', payload: { id: target.id, muted: true } });
    expect(s.tracks[0].muted).toBe(true);
    s.tracks.slice(1).forEach(t => expect(t.muted).toBe(false));
  });

  it('SOLO_TRACK solos the target track only', () => {
    const base = makeState();
    const target = base.tracks[1];
    const s = dawReducer(base, { type: 'SOLO_TRACK', payload: { id: target.id, soloed: true } });
    expect(s.tracks[1].soloed).toBe(true);
    [s.tracks[0], ...s.tracks.slice(2)].forEach(t => expect(t.soloed).toBe(false));
  });

  it('SELECT_TRACK sets selectedTrackId', () => {
    const base = makeState();
    const target = base.tracks[2];
    const s = dawReducer(base, { type: 'SELECT_TRACK', payload: target.id });
    expect(s.selectedTrackId).toBe(target.id);
  });

  it('SELECT_TRACK accepts null to deselect', () => {
    const base = makeState();
    const s1 = dawReducer(base, { type: 'SELECT_TRACK', payload: base.tracks[0].id });
    const s2 = dawReducer(s1, { type: 'SELECT_TRACK', payload: null });
    expect(s2.selectedTrackId).toBeNull();
  });

  it('REMOVE_TRACK removes only the target track', () => {
    const base = makeState();
    const target = base.tracks[1];
    const s = dawReducer(base, { type: 'REMOVE_TRACK', payload: target.id });
    expect(s.tracks).toHaveLength(base.tracks.length - 1);
    expect(s.tracks.find(t => t.id === target.id)).toBeUndefined();
    expect(s.tracks.find(t => t.id === base.tracks[0].id)).toBeDefined();
  });

  it('ADD_TRACK_WITH_DATA inserts a pre-built track', () => {
    const base = makeState();
    const track = makeTrack('bus');
    const s = dawReducer(base, { type: 'ADD_TRACK_WITH_DATA', payload: track });
    expect(s.tracks.at(-1)?.id).toBe(track.id);
    expect(s.tracks.at(-1)?.type).toBe('bus');
  });
});

// ─── Clip: remove / update ─────────────────────────────────────────────────────

describe('Clip: remove and update', () => {
  it('REMOVE_CLIP removes only the matching clip', () => {
    const base = makeState();
    const trackId = base.tracks[0].id;
    const c1 = makeClip({ id: 'clip-a' });
    const c2 = makeClip({ id: 'clip-b', startTime: 6 });
    let s = dawReducer(base, { type: 'ADD_CLIP', payload: { trackId, clip: c1 } });
    s = dawReducer(s, { type: 'ADD_CLIP', payload: { trackId, clip: c2 } });
    s = dawReducer(s, { type: 'REMOVE_CLIP', payload: { trackId, clipId: 'clip-a' } });
    const clips = s.tracks[0].clips;
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBe('clip-b');
  });

  it('UPDATE_CLIP patches clip fields without touching other clips', () => {
    const base = makeState();
    const trackId = base.tracks[0].id;
    const c1 = makeClip({ id: 'clip-x', name: 'Original' });
    const c2 = makeClip({ id: 'clip-y', name: 'Untouched' });
    let s = dawReducer(base, { type: 'ADD_CLIP', payload: { trackId, clip: c1 } });
    s = dawReducer(s, { type: 'ADD_CLIP', payload: { trackId, clip: c2 } });
    s = dawReducer(s, {
      type: 'UPDATE_CLIP',
      payload: { trackId, clipId: 'clip-x', updates: { name: 'Updated', gain: 0.5 } },
    });
    const updated = s.tracks[0].clips.find(c => c.id === 'clip-x');
    const untouched = s.tracks[0].clips.find(c => c.id === 'clip-y');
    expect(updated?.name).toBe('Updated');
    expect(updated?.gain).toBe(0.5);
    expect(untouched?.name).toBe('Untouched');
  });
});

// ─── MIDI note operations ─────────────────────────────────────────────────────

describe('MIDI note operations', () => {
  function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
    return { midi: 60, startBeats: 0, durationBeats: 1, velocity: 0.8, ...overrides };
  }

  let base: DAWState;
  let trackId: string;
  const clipId = 'midi-clip-1';

  beforeEach(() => {
    base = makeState();
    trackId = base.tracks[0].id;
    base = dawReducer(base, {
      type: 'ADD_CLIP',
      payload: { trackId, clip: makeClip({ id: clipId, midiNotes: [] }) },
    });
  });

  it('ADD_MIDI_NOTE appends note', () => {
    const s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ midi: 64 }) },
    });
    expect(s.tracks[0].clips[0].midiNotes).toHaveLength(1);
    expect(s.tracks[0].clips[0].midiNotes![0].midi).toBe(64);
  });

  it('ADD_MIDI_NOTE clamps midi 0–127', () => {
    let s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ midi: 200, startBeats: 0 }) },
    });
    s = dawReducer(s, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ midi: -5, startBeats: 1 }) },
    });
    const notes = s.tracks[0].clips[0].midiNotes!;
    expect(notes[0].midi).toBe(127);
    expect(notes[1].midi).toBe(0);
  });

  it('ADD_MIDI_NOTE clamps velocity 0.05–1', () => {
    let s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ velocity: 5, startBeats: 0 }) },
    });
    s = dawReducer(s, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ velocity: 0, startBeats: 1 }) },
    });
    const notes = s.tracks[0].clips[0].midiNotes!;
    expect(notes[0].velocity).toBe(1);
    expect(notes[1].velocity).toBe(0.05);
  });

  it('ADD_MIDI_NOTE clamps negative startBeats to 0', () => {
    const s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ startBeats: -3 }) },
    });
    expect(s.tracks[0].clips[0].midiNotes![0].startBeats).toBe(0);
  });

  it('UPDATE_MIDI_NOTE patches the note at the given index', () => {
    let s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ midi: 60 }) },
    });
    s = dawReducer(s, {
      type: 'UPDATE_MIDI_NOTE',
      payload: { trackId, clipId, noteIndex: 0, updates: { midi: 72, velocity: 0.3 } },
    });
    expect(s.tracks[0].clips[0].midiNotes![0].midi).toBe(72);
    expect(s.tracks[0].clips[0].midiNotes![0].velocity).toBe(0.3);
  });

  it('UPDATE_MIDI_NOTE clamps out-of-range fields', () => {
    let s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ midi: 60 }) },
    });
    s = dawReducer(s, {
      type: 'UPDATE_MIDI_NOTE',
      payload: { trackId, clipId, noteIndex: 0, updates: { midi: 200, velocity: -0.5, durationBeats: 0 } },
    });
    const note = s.tracks[0].clips[0].midiNotes![0];
    expect(note.midi).toBe(127);
    expect(note.velocity).toBe(0.05);
    expect(note.durationBeats).toBe(0.05); // minimum duration
  });

  it('REMOVE_MIDI_NOTE removes the note at the given index', () => {
    let s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ midi: 60, startBeats: 0 }) },
    });
    s = dawReducer(s, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ midi: 64, startBeats: 2 }) },
    });
    s = dawReducer(s, { type: 'REMOVE_MIDI_NOTE', payload: { trackId, clipId, noteIndex: 0 } });
    const notes = s.tracks[0].clips[0].midiNotes!;
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(64);
  });

  it('NUDGE_MIDI_CLIP shifts all notes by deltaBeats', () => {
    let s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ startBeats: 2 }) },
    });
    s = dawReducer(s, { type: 'NUDGE_MIDI_CLIP', payload: { trackId, clipId, deltaBeats: 1.5 } });
    expect(s.tracks[0].clips[0].midiNotes![0].startBeats).toBe(3.5);
  });

  it('NUDGE_MIDI_CLIP clamps result to 0', () => {
    let s = dawReducer(base, {
      type: 'ADD_MIDI_NOTE',
      payload: { trackId, clipId, note: makeNote({ startBeats: 0.25 }) },
    });
    s = dawReducer(s, { type: 'NUDGE_MIDI_CLIP', payload: { trackId, clipId, deltaBeats: -2 } });
    expect(s.tracks[0].clips[0].midiNotes![0].startBeats).toBe(0);
  });

  it('QUANTIZE_MIDI_CLIP snaps note to nearest grid beat', () => {
    // Clip at startTime=0, BPM=120 → clipStartBeats=0. Note at 1.9 on 1-beat grid → snaps to 2
    const qClipId = 'q-clip';
    let s = dawReducer(makeState(), {
      type: 'ADD_CLIP',
      payload: {
        trackId,
        clip: makeClip({ id: qClipId, startTime: 0, midiNotes: [makeNote({ startBeats: 1.9, durationBeats: 0.9 })] }),
      },
    });
    s = dawReducer(s, {
      type: 'QUANTIZE_MIDI_CLIP',
      payload: { trackId, clipId: qClipId, gridBeats: 1, swing: 0 },
    });
    expect(s.tracks[0].clips[0].midiNotes![0].startBeats).toBe(2);
  });

  it('QUANTIZE_MIDI_CLIP enforces minimum duration of gridBeats', () => {
    const qClipId = 'q-clip2';
    let s = dawReducer(makeState(), {
      type: 'ADD_CLIP',
      payload: {
        trackId,
        clip: makeClip({ id: qClipId, startTime: 0, midiNotes: [makeNote({ startBeats: 0, durationBeats: 0.01 })] }),
      },
    });
    s = dawReducer(s, {
      type: 'QUANTIZE_MIDI_CLIP',
      payload: { trackId, clipId: qClipId, gridBeats: 0.5, swing: 0 },
    });
    const note = s.tracks[0].clips[0].midiNotes![0];
    expect(note.durationBeats).toBeGreaterThanOrEqual(0.05);
  });

  it('REPLACE_MIDI_CHORD updates existing notes at the selected beat', () => {
    const chordClipId = 'chord-clip-1';
    let s = dawReducer(makeState(), {
      type: 'ADD_CLIP',
      payload: {
        trackId,
        clip: makeClip({
          id: chordClipId,
          startTime: 0,
          midiNotes: [
            makeNote({ midi: 60, startBeats: 2, durationBeats: 1, velocity: 0.75 }),
            makeNote({ midi: 64, startBeats: 2, durationBeats: 1, velocity: 0.75 }),
            makeNote({ midi: 67, startBeats: 2, durationBeats: 1, velocity: 0.75 }),
          ],
        }),
      },
    });

    s = dawReducer(s, {
      type: 'REPLACE_MIDI_CHORD',
      payload: { trackId, clipId: chordClipId, atBeat: 2, root: 'D', quality: 'minor' },
    });

    const notes = s.tracks[0].clips[0].midiNotes!;
    expect(notes).toHaveLength(3);
    expect(notes.map(note => note.startBeats)).toEqual([2, 2, 2]);
    expect(notes.map(note => note.midi)).toEqual([62, 65, 69]);
  });

  it('REPLACE_MIDI_CHORD inserts a new chord when target beat is empty', () => {
    const chordClipId = 'chord-clip-2';
    let s = dawReducer(makeState(), {
      type: 'ADD_CLIP',
      payload: {
        trackId,
        clip: makeClip({
          id: chordClipId,
          startTime: 0,
          midiNotes: [
            makeNote({ midi: 60, startBeats: 0, durationBeats: 1, velocity: 0.72 }),
            makeNote({ midi: 64, startBeats: 0, durationBeats: 1, velocity: 0.72 }),
            makeNote({ midi: 67, startBeats: 0, durationBeats: 1, velocity: 0.72 }),
          ],
        }),
      },
    });

    s = dawReducer(s, {
      type: 'REPLACE_MIDI_CHORD',
      payload: { trackId, clipId: chordClipId, atBeat: 2, root: 'A', quality: 'minor' },
    });

    const notes = s.tracks[0].clips[0].midiNotes!;
    const inserted = notes.filter(note => note.startBeats === 2);
    expect(notes).toHaveLength(6);
    expect(inserted).toHaveLength(3);
    expect(inserted.map(note => ((note.midi % 12) + 12) % 12)).toEqual([0, 4, 9]);
    inserted.forEach((note) => {
      expect(note.durationBeats).toBe(1);
      expect(note.velocity).toBeCloseTo(0.72, 4);
    });
  });
});

// ─── Track-level plugin: add / update / remove ────────────────────────────────

describe('Track plugin actions', () => {
  let base: DAWState;
  let trackId: string;

  beforeEach(() => {
    base = makeState();
    trackId = base.tracks[0].id;
  });

  it('ADD_PLUGIN appends to the target track only', () => {
    const plugin = makePlugin('reverb');
    const s = dawReducer(base, { type: 'ADD_PLUGIN', payload: { trackId, plugin } });
    expect(s.tracks[0].plugins).toHaveLength(1);
    expect(s.tracks[0].plugins[0].type).toBe('reverb');
    s.tracks.slice(1).forEach(t => expect(t.plugins).toHaveLength(0));
  });

  it('REMOVE_PLUGIN removes by id', () => {
    const p = makePlugin('delay');
    let s = dawReducer(base, { type: 'ADD_PLUGIN', payload: { trackId, plugin: p } });
    s = dawReducer(s, { type: 'REMOVE_PLUGIN', payload: { trackId, pluginId: p.id } });
    expect(s.tracks[0].plugins).toHaveLength(0);
  });

  it('UPDATE_PLUGIN patches matching plugin and leaves others intact', () => {
    const p1 = makePlugin('eq');
    const p2 = makePlugin('compressor');
    let s = dawReducer(base, { type: 'ADD_PLUGIN', payload: { trackId, plugin: p1 } });
    s = dawReducer(s, { type: 'ADD_PLUGIN', payload: { trackId, plugin: p2 } });
    s = dawReducer(s, {
      type: 'UPDATE_PLUGIN',
      payload: { trackId, pluginId: p1.id, updates: { enabled: false } },
    });
    expect(s.tracks[0].plugins.find(p => p.id === p1.id)?.enabled).toBe(false);
    expect(s.tracks[0].plugins.find(p => p.id === p2.id)?.enabled).toBe(true);
  });

  it('makePlugin produces valid defaults for all types', () => {
    const types: Array<Parameters<typeof makePlugin>[0]> = [
      'eq', 'compressor', 'reverb', 'delay', 'distortion',
      'chorus', 'limiter', 'gain', 'autopan', 'humRemover',
    ];
    types.forEach(type => {
      const plugin = makePlugin(type);
      expect(plugin.type).toBe(type);
      expect(plugin.enabled).toBe(true);
      expect(Object.keys(plugin.parameters).length).toBeGreaterThan(0);
    });
  });
});

// ─── Panel / UI actions ────────────────────────────────────────────────────────

describe('Panel and UI actions', () => {
  it('SET_ACTIVE_PANEL updates activePanel', () => {
    const s = dawReducer(makeState(), { type: 'SET_ACTIVE_PANEL', payload: 'ai' });
    expect(s.activePanel).toBe('ai');
  });

  it('SET_ACTIVE_PANEL accepts null', () => {
    let s = dawReducer(makeState(), { type: 'SET_ACTIVE_PANEL', payload: 'mixer' });
    s = dawReducer(s, { type: 'SET_ACTIVE_PANEL', payload: null });
    expect(s.activePanel).toBeNull();
  });

  it('SET_PLUGIN_RACK_TRACK sets pluginRackTrackId and forces activePanel to plugins', () => {
    const base = makeState();
    const tid = base.tracks[0].id;
    const s = dawReducer(base, { type: 'SET_PLUGIN_RACK_TRACK', payload: tid });
    expect(s.pluginRackTrackId).toBe(tid);
    expect(s.activePanel).toBe('plugins');
  });

  it('SET_PLUGIN_RACK_TRACK with null preserves existing activePanel', () => {
    let s = dawReducer(makeState(), { type: 'SET_ACTIVE_PANEL', payload: 'mixer' });
    s = dawReducer(s, { type: 'SET_PLUGIN_RACK_TRACK', payload: null });
    expect(s.pluginRackTrackId).toBeNull();
    expect(s.activePanel).toBe('mixer');
  });
});

// ─── Project actions ──────────────────────────────────────────────────────────

describe('Project actions', () => {
  it('SET_PROJECT_NAME updates projectName', () => {
    const s = dawReducer(makeState(), { type: 'SET_PROJECT_NAME', payload: 'My Masterpiece' });
    expect(s.projectName).toBe('My Masterpiece');
  });

  it('LOAD_PROJECT merges payload and forces transport off', () => {
    let s = dawReducer(makeState(), { type: 'SET_PLAYING', payload: true });
    s = dawReducer(s, { type: 'SET_RECORDING', payload: true });
    s = dawReducer(s, {
      type: 'LOAD_PROJECT',
      payload: { projectName: 'Loaded Project', bpm: 95 },
    });
    expect(s.projectName).toBe('Loaded Project');
    expect(s.bpm).toBe(95);
    expect(s.isPlaying).toBe(false);
    expect(s.isRecording).toBe(false);
  });

  it('LOAD_PROJECT preserves fields not present in payload', () => {
    const base = makeState();
    const s = dawReducer(base, {
      type: 'LOAD_PROJECT',
      payload: { projectName: 'X' },
    });
    // bpm unchanged from base
    expect(s.bpm).toBe(base.bpm);
  });
});

// ─── Immutability ─────────────────────────────────────────────────────────────

describe('Immutability', () => {
  it('returns a new state reference on any change', () => {
    const base = makeState();
    const next = dawReducer(base, { type: 'SET_BPM', payload: 140 });
    expect(next).not.toBe(base);
  });

  it('tracks array is a new reference after ADD_TRACK', () => {
    const base = makeState();
    const next = dawReducer(base, { type: 'ADD_TRACK', payload: 'audio' });
    expect(next.tracks).not.toBe(base.tracks);
  });

  it('unaffected tracks share the same object reference after UPDATE_TRACK', () => {
    const base = makeState();
    const unaffected = base.tracks[1];
    const next = dawReducer(base, {
      type: 'UPDATE_TRACK',
      payload: { id: base.tracks[0].id, updates: { name: 'Changed' } },
    });
    expect(next.tracks.find(t => t.id === unaffected.id)).toBe(unaffected);
  });

  it('default case returns same state reference', () => {
    const base = makeState();
    // @ts-expect-error intentionally sending unknown action to hit default
    const next = dawReducer(base, { type: 'UNKNOWN_ACTION' });
    expect(next).toBe(base);
  });
});
