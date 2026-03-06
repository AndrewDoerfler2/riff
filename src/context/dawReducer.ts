import type {
  DAWState, DAWAction, Track, TrackType, PluginInstance, PluginType, NoteEvent, ChordQuality,
} from '../types/daw';

const TRACK_COLORS = [
  '#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2',
  '#64d2ff', '#ffd60a', '#ff6961', '#4cd964', '#5ac8fa',
];

export const PLUGIN_DEFINITIONS: Record<PluginType, { name: string; color: string; params: string[] }> = {
  eq:          { name: 'EQ',         color: '#0a84ff', params: ['low', 'mid', 'high', 'lowFreq', 'midFreq', 'highFreq'] },
  compressor:  { name: 'Compressor', color: '#ff9f0a', params: ['threshold', 'ratio', 'attack', 'release', 'knee', 'makeupGain'] },
  reverb:      { name: 'Reverb',     color: '#bf5af2', params: ['roomSize', 'dampening', 'wet', 'dry', 'preDelay'] },
  delay:       { name: 'Delay',      color: '#64d2ff', params: ['time', 'feedback', 'wet', 'dry', 'sync'] },
  distortion:  { name: 'Distortion', color: '#ff453a', params: ['drive', 'tone', 'mix'] },
  chorus:      { name: 'Chorus',     color: '#30d158', params: ['rate', 'depth', 'delay', 'feedback', 'mix'] },
  limiter:     { name: 'Limiter',    color: '#ffd60a', params: ['threshold', 'release', 'gain'] },
  gain:        { name: 'Gain',       color: '#8e8e93', params: ['gain', 'trim'] },
  autopan:     { name: 'Auto Pan',   color: '#5ac8fa', params: ['rate', 'depth', 'phase', 'mix'] },
  humRemover:  { name: 'Hum Remover', color: '#7de2a7', params: ['humFreq', 'q', 'reduction'] },
};

let trackCount = 0;
function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function genColor(idx: number) { return TRACK_COLORS[idx % TRACK_COLORS.length]; }
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sortMidiNotes<T extends { startBeats: number; midi: number }>(notes: T[]): T[] {
  return notes.slice().sort((left, right) => left.startBeats - right.startBeats || left.midi - right.midi);
}

function updateTrackById(
  tracks: Track[],
  trackId: string,
  updateTrack: (track: Track) => Track,
): Track[] {
  let changed = false;
  const nextTracks = tracks.map((track) => {
    if (track.id !== trackId) return track;
    const nextTrack = updateTrack(track);
    changed = changed || nextTrack !== track;
    return nextTrack;
  });
  return changed ? nextTracks : tracks;
}

function updateTrackClipById(
  tracks: Track[],
  trackId: string,
  clipId: string,
  updateClip: (clip: Track['clips'][number]) => Track['clips'][number],
): Track[] {
  return updateTrackById(tracks, trackId, (track) => {
    let changed = false;
    const nextClips = track.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const nextClip = updateClip(clip);
      changed = changed || nextClip !== clip;
      return nextClip;
    });
    return changed ? { ...track, clips: nextClips } : track;
  });
}

const CHORD_ROOT_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
};

function quantizeBeat(relativeBeat: number, gridBeats: number, swing: number): number {
  if (gridBeats <= 0) return Math.max(0, relativeBeat);
  const index = Math.round(relativeBeat / gridBeats);
  let quantized = index * gridBeats;
  if (index % 2 !== 0) {
    quantized += gridBeats * clamp(swing, 0, 0.5);
  }
  return Math.max(0, quantized);
}

function quantizeClipMidiNotes(notes: NoteEvent[], clipStartBeats: number, gridBeats: number, swing: number): NoteEvent[] {
  return sortMidiNotes(notes.map((note) => {
    const relativeStart = Math.max(0, note.startBeats - clipStartBeats);
    const quantizedStart = quantizeBeat(relativeStart, gridBeats, swing);
    const quantizedDuration = Math.max(0.05, Math.round(note.durationBeats / gridBeats) * gridBeats);
    return {
      ...note,
      startBeats: clipStartBeats + quantizedStart,
      durationBeats: quantizedDuration,
    };
  }));
}

function nudgeClipMidiNotes(notes: NoteEvent[], deltaBeats: number): NoteEvent[] {
  return sortMidiNotes(notes.map((note) => ({
    ...note,
    startBeats: Math.max(0, note.startBeats + deltaBeats),
  })));
}

function revoiceMidi(target: number, minMidi: number, maxMidi: number): number {
  if (maxMidi < minMidi) return clamp(target, 0, 127);
  let midi = target;
  while (midi < minMidi) midi += 12;
  while (midi > maxMidi) midi -= 12;
  if (midi < minMidi) midi = minMidi;
  if (midi > maxMidi) midi = maxMidi;
  return clamp(midi, 0, 127);
}

function replaceChordInClipMidiNotes(
  notes: NoteEvent[],
  atBeat: number,
  root: string,
  quality: ChordQuality,
): NoteEvent[] {
  const semitone = CHORD_ROOT_TO_SEMITONE[root];
  const intervals = CHORD_INTERVALS[quality];
  if (semitone == null || !intervals?.length) {
    return notes;
  }

  const EPS = 0.15;
  const groupIndices = notes
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => Math.abs(note.startBeats - atBeat) <= EPS)
    .map(({ index }) => index);

  const fallbackIndices = notes
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => note.startBeats <= atBeat && note.startBeats + note.durationBeats >= atBeat)
    .map(({ index }) => index);

  const indices = groupIndices.length > 0 ? groupIndices : fallbackIndices;
  if (indices.length === 0) {
    if (notes.length === 0) return notes;

    const nearestNote = notes
      .slice()
      .sort((left, right) => Math.abs(left.startBeats - atBeat) - Math.abs(right.startBeats - atBeat))[0];
    if (!nearestNote) return notes;

    const nearbyGroup = notes.filter((note) => Math.abs(note.startBeats - nearestNote.startBeats) <= EPS);
    const templateGroup = nearbyGroup.length > 0 ? nearbyGroup : [nearestNote];
    const templateMin = Math.min(...templateGroup.map(note => note.midi));
    const templateMax = Math.max(...templateGroup.map(note => note.midi));
    const templateAverage = templateGroup.reduce((sum, note) => sum + note.midi, 0) / templateGroup.length;
    const avgDuration = templateGroup.reduce((sum, note) => sum + note.durationBeats, 0) / templateGroup.length;
    const avgVelocity = templateGroup.reduce((sum, note) => sum + note.velocity, 0) / templateGroup.length;

    const minMidi = clamp(templateMin - 2, 0, 127);
    const maxMidi = clamp(templateMax + 2, 0, 127);
    const rootBase = 12 * Math.round((templateAverage - semitone) / 12) + semitone;
    const targetCount = Math.max(3, templateGroup.length);
    const chordTones: number[] = [];
    for (let i = 0; i < targetCount; i += 1) {
      const octave = Math.floor(i / intervals.length);
      const interval = intervals[i % intervals.length];
      chordTones.push(rootBase + interval + 12 * octave);
    }

    const inserted = chordTones
      .sort((left, right) => left - right)
      .map((tone) => ({
        midi: revoiceMidi(tone, minMidi, maxMidi),
        startBeats: Math.max(0, atBeat),
        durationBeats: Math.max(0.25, avgDuration),
        velocity: clamp(avgVelocity, 0.05, 1),
      }));

    return sortMidiNotes([...notes, ...inserted]);
  }

  const group = indices.map((index) => notes[index]);
  const groupStart = Math.min(...group.map(note => note.startBeats));
  const groupMin = Math.min(...group.map(note => note.midi));
  const groupMax = Math.max(...group.map(note => note.midi));
  const groupAverage = group.reduce((sum, note) => sum + note.midi, 0) / group.length;
  const minMidi = clamp(groupMin - 2, 0, 127);
  const maxMidi = clamp(groupMax + 2, 0, 127);

  const rootBase = 12 * Math.round((groupAverage - semitone) / 12) + semitone;
  const targetCount = Math.max(3, group.length);
  const chordTones: number[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    const octave = Math.floor(i / intervals.length);
    const interval = intervals[i % intervals.length];
    chordTones.push(rootBase + interval + 12 * octave);
  }
  chordTones.sort((left, right) => left - right);

  const sortedIndices = indices.slice().sort((left, right) => notes[left].midi - notes[right].midi);
  const nextNotes = notes.slice();
  sortedIndices.forEach((index, idx) => {
    const tone = chordTones[Math.min(idx, chordTones.length - 1)];
    const original = nextNotes[index];
    nextNotes[index] = {
      ...original,
      startBeats: groupStart,
      midi: revoiceMidi(tone, minMidi, maxMidi),
    };
  });

  return sortMidiNotes(nextNotes);
}

export function makeTrack(type: TrackType): Track {
  trackCount += 1;
  const labels: Record<TrackType, string> = {
    audio: 'Audio', midi: 'MIDI', video: 'Video', bus: 'Bus',
  };
  return {
    id: genId(),
    name: `${labels[type]} ${trackCount}`,
    type,
    color: genColor(trackCount - 1),
    armed: false,
    muted: false,
    soloed: false,
    volume: 0.8,
    pan: 0,
    clips: [],
    videoClips: [],
    plugins: [],
    height: 110,
    inputMonitor: false,
    meterMode: 'post' as const,
  };
}

export function makePlugin(type: PluginType): PluginInstance {
  const def = PLUGIN_DEFINITIONS[type];
  const parameters: Record<string, number> = {};
  def.params.forEach((p) => {
    const defaults: Record<string, number> = {
      low: 0, mid: 0, high: 0, lowFreq: 80, midFreq: 1000, highFreq: 10000,
      threshold: -18, ratio: 4, attack: 10, release: 100, knee: 6,
      makeupGain: 0, roomSize: 0.5, dampening: 0.5, wet: 0.3, dry: 0.7,
      preDelay: 20, time: 0.25, feedback: 0.3, drive: 0.5, tone: 0.5,
      mix: 0.5, rate: 0.5, depth: 0.5, delay: 0.5, phase: 0,
      gain: 0, trim: 0, humFreq: 60, q: 14, reduction: 18,
    };
    parameters[p] = defaults[p] ?? 0.5;
  });
  return { id: genId(), type, name: def.name, enabled: true, parameters };
}

const initialTracks: Track[] = [
  makeTrack('audio'),
  makeTrack('audio'),
  makeTrack('audio'),
  makeTrack('audio'),
];

export const initialDAWState: DAWState = {
  projectName: 'Untitled Project',
  isPlaying: false,
  isRecording: false,
  currentTime: 0,
  bpm: 120,
  timeSignature: '4/4',
  loopEnabled: false,
  loopStart: 0,
  loopEnd: 8,
  metronomeEnabled: false,
  snapEnabled: true,

  tracks: initialTracks,
  selectedTrackId: null,
  masterVolume: 0.85,
  masterPan: 0,
  masterPlugins: [],
  loudnessPreset: null,

  zoom: 100,
  scrollLeft: 0,
  viewDuration: 120,
  autoScroll: true,

  activePanel: null,
  pluginRackTrackId: null,

  aiConfig: {
    genre: 'pop',
    bpm: 120,
    key: 'C',
    timeSignature: '4/4',
    bars: 8,
    instruments: ['drums', 'bass', 'piano'],
    useAiArrangement: true,
    useLocalPatterns: true,
    isGenerating: false,
    isRecordingSnippet: false,
    snippetDuration: 0,
    progress: 0,
  },
};

export function dawReducer(state: DAWState, action: DAWAction): DAWState {
  switch (action.type) {
    case 'SET_PLAYING': return { ...state, isPlaying: action.payload };
    case 'SET_RECORDING': return { ...state, isRecording: action.payload };
    case 'SET_CURRENT_TIME': return { ...state, currentTime: Math.max(0, action.payload) };
    case 'SET_BPM': return { ...state, bpm: Math.max(20, Math.min(300, action.payload)) };
    case 'SET_TIME_SIGNATURE': return { ...state, timeSignature: action.payload };
    case 'TOGGLE_LOOP': return { ...state, loopEnabled: !state.loopEnabled };
    case 'SET_LOOP_RANGE': return { ...state, loopStart: action.payload.start, loopEnd: action.payload.end };
    case 'TOGGLE_METRONOME': return { ...state, metronomeEnabled: !state.metronomeEnabled };
    case 'TOGGLE_SNAP': return { ...state, snapEnabled: !state.snapEnabled };
    case 'TOGGLE_AUTO_SCROLL': return { ...state, autoScroll: !state.autoScroll };
    case 'SET_MASTER_VOLUME': return { ...state, masterVolume: action.payload };
    case 'SET_ZOOM': return { ...state, zoom: Math.max(20, Math.min(600, action.payload)) };
    case 'SET_SCROLL_LEFT': return { ...state, scrollLeft: Math.max(0, action.payload) };
    case 'SET_ACTIVE_PANEL': return { ...state, activePanel: action.payload };
    case 'SET_PLUGIN_RACK_TRACK':
      return { ...state, pluginRackTrackId: action.payload, activePanel: action.payload ? 'plugins' : state.activePanel };
    case 'SELECT_TRACK': return { ...state, selectedTrackId: action.payload };

    case 'ADD_TRACK': {
      const t = makeTrack(action.payload);
      return { ...state, tracks: [...state.tracks, t] };
    }

    case 'ADD_TRACK_WITH_DATA':
      return { ...state, tracks: [...state.tracks, action.payload] };

    case 'REMOVE_TRACK':
      return { ...state, tracks: state.tracks.filter(t => t.id !== action.payload) };

    case 'UPDATE_TRACK':
      return {
        ...state,
        tracks: state.tracks.map(t => (t.id === action.payload.id ? { ...t, ...action.payload.updates } : t)),
      };

    case 'ARM_TRACK':
      return {
        ...state,
        tracks: state.tracks.map(t => (t.id === action.payload.id ? { ...t, armed: action.payload.armed } : t)),
      };

    case 'MUTE_TRACK':
      return {
        ...state,
        tracks: state.tracks.map(t => (t.id === action.payload.id ? { ...t, muted: action.payload.muted } : t)),
      };

    case 'SOLO_TRACK':
      return {
        ...state,
        tracks: state.tracks.map(t => (t.id === action.payload.id ? { ...t, soloed: action.payload.soloed } : t)),
      };

    case 'ADD_CLIP':
      return {
        ...state,
        tracks: updateTrackById(state.tracks, action.payload.trackId, (track) => ({
          ...track,
          clips: [...track.clips, action.payload.clip],
        })),
      };

    case 'ADD_MIDI_NOTE':
      return {
        ...state,
        tracks: updateTrackClipById(state.tracks, action.payload.trackId, action.payload.clipId, (clip) => ({
          ...clip,
          midiNotes: sortMidiNotes([...(clip.midiNotes ?? []), {
            midi: clamp(Math.round(action.payload.note.midi), 0, 127),
            startBeats: Math.max(0, action.payload.note.startBeats),
            durationBeats: Math.max(0.05, action.payload.note.durationBeats),
            velocity: clamp(action.payload.note.velocity, 0.05, 1),
          }]),
        })),
      };

    case 'UPDATE_MIDI_NOTE':
      return {
        ...state,
        tracks: updateTrackClipById(state.tracks, action.payload.trackId, action.payload.clipId, (clip) => {
          if (!clip.midiNotes) return clip;
          const nextNotes = clip.midiNotes.map((note, index) => {
            if (index !== action.payload.noteIndex) return note;
            const merged = { ...note, ...action.payload.updates };
            return {
              ...merged,
              midi: clamp(Math.round(merged.midi), 0, 127),
              startBeats: Math.max(0, merged.startBeats),
              durationBeats: Math.max(0.05, merged.durationBeats),
              velocity: clamp(merged.velocity, 0.05, 1),
            };
          });
          return { ...clip, midiNotes: nextNotes };
        }),
      };

    case 'REMOVE_MIDI_NOTE':
      return {
        ...state,
        tracks: updateTrackClipById(state.tracks, action.payload.trackId, action.payload.clipId, (clip) => (
          clip.midiNotes
            ? { ...clip, midiNotes: clip.midiNotes.filter((_, index) => index !== action.payload.noteIndex) }
            : clip
        )),
      };

    case 'QUANTIZE_MIDI_CLIP':
      return {
        ...state,
        tracks: updateTrackClipById(state.tracks, action.payload.trackId, action.payload.clipId, (clip) => {
          if (!clip.midiNotes?.length) return clip;
          const clipStartBeats = clip.startTime * (state.bpm / 60);
          return {
            ...clip,
            midiNotes: quantizeClipMidiNotes(
              clip.midiNotes,
              clipStartBeats,
              Math.max(0.125, action.payload.gridBeats),
              action.payload.swing,
            ),
          };
        }),
      };

    case 'NUDGE_MIDI_CLIP':
      return {
        ...state,
        tracks: updateTrackClipById(state.tracks, action.payload.trackId, action.payload.clipId, (clip) => (
          clip.midiNotes?.length
            ? { ...clip, midiNotes: nudgeClipMidiNotes(clip.midiNotes, action.payload.deltaBeats) }
            : clip
        )),
      };

    case 'REPLACE_MIDI_CHORD':
      return {
        ...state,
        tracks: updateTrackClipById(state.tracks, action.payload.trackId, action.payload.clipId, (clip) => (
          clip.midiNotes?.length
            ? {
                ...clip,
                midiNotes: replaceChordInClipMidiNotes(
                  clip.midiNotes,
                  Math.max(0, action.payload.atBeat),
                  action.payload.root,
                  action.payload.quality,
                ),
              }
            : clip
        )),
      };

    case 'UPDATE_CLIP':
      return {
        ...state,
        tracks: updateTrackClipById(state.tracks, action.payload.trackId, action.payload.clipId, (clip) => ({
          ...clip,
          ...action.payload.updates,
        })),
      };

    case 'REMOVE_CLIP':
      return {
        ...state,
        tracks: state.tracks.map(t => (
          t.id === action.payload.trackId
            ? { ...t, clips: t.clips.filter(c => c.id !== action.payload.clipId) }
            : t
        )),
      };

    case 'ADD_PLUGIN':
      return {
        ...state,
        tracks: state.tracks.map(t => (
          t.id === action.payload.trackId
            ? { ...t, plugins: [...t.plugins, action.payload.plugin] }
            : t
        )),
      };

    case 'REMOVE_PLUGIN':
      return {
        ...state,
        tracks: state.tracks.map(t => (
          t.id === action.payload.trackId
            ? { ...t, plugins: t.plugins.filter(p => p.id !== action.payload.pluginId) }
            : t
        )),
      };

    case 'UPDATE_PLUGIN':
      return {
        ...state,
        tracks: state.tracks.map(t => (
          t.id === action.payload.trackId
            ? {
                ...t,
                plugins: t.plugins.map(p => (
                  p.id === action.payload.pluginId ? { ...p, ...action.payload.updates } : p
                )),
              }
            : t
        )),
      };

    case 'UPDATE_AI_CONFIG':
      return { ...state, aiConfig: { ...state.aiConfig, ...action.payload } };

    case 'TOGGLE_INSTRUMENT': {
      const instr = action.payload;
      const list = state.aiConfig.instruments;
      const next = list.includes(instr) ? list.filter(i => i !== instr) : [...list, instr];
      return { ...state, aiConfig: { ...state.aiConfig, instruments: next } };
    }

    case 'SET_PROJECT_NAME':
      return { ...state, projectName: action.payload };

    case 'LOAD_PROJECT':
      return { ...state, ...action.payload, isPlaying: false, isRecording: false };

    case 'SET_TRACK_METER_MODE':
      return {
        ...state,
        tracks: state.tracks.map(t => (
          t.id === action.payload.id ? { ...t, meterMode: action.payload.mode } : t
        )),
      };

    case 'SET_TRACK_BUS_ROUTE':
      return {
        ...state,
        tracks: state.tracks.map(t => (
          t.id === action.payload.id ? { ...t, busRouteId: action.payload.busRouteId } : t
        )),
      };

    case 'ADD_MASTER_PLUGIN':
      return { ...state, masterPlugins: [...state.masterPlugins, action.payload] };

    case 'REMOVE_MASTER_PLUGIN':
      return { ...state, masterPlugins: state.masterPlugins.filter(p => p.id !== action.payload) };

    case 'UPDATE_MASTER_PLUGIN':
      return {
        ...state,
        masterPlugins: state.masterPlugins.map(p => (
          p.id === action.payload.pluginId ? { ...p, ...action.payload.updates } : p
        )),
      };

    case 'APPLY_LOUDNESS_PRESET': {
      // Remove any existing AI loudness compressor/limiter, then insert the new preset pair
      const filtered = state.masterPlugins.filter(
        p => !p.id.startsWith('compressor-lufs-') && !p.id.startsWith('limiter-lufs-'),
      );
      return {
        ...state,
        loudnessPreset: action.payload.preset,
        masterPlugins: [...filtered, action.payload.compressor, action.payload.limiter],
      };
    }

    case 'CLEAR_LOUDNESS_PRESET':
      return {
        ...state,
        loudnessPreset: null,
        masterPlugins: state.masterPlugins.filter(
          p => !p.id.startsWith('compressor-lufs-') && !p.id.startsWith('limiter-lufs-'),
        ),
      };

    default:
      return state;
  }
}
