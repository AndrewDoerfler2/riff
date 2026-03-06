import type { AIConfig, AudioClip, DrumHitEvent, Genre, Instrument, NoteEvent } from '../types/daw';

export interface AIGenerationTrack {
  instrument: Instrument;
  label: string;
  buffer: AudioBuffer;
  sourceLabel: 'AI' | 'Local';
  notes: NoteEvent[];
  drumHits: DrumHitEvent[];
}

export interface AIGeneration {
  id: string;
  takeNumber: number;
  createdAt: number;
  genre: Genre;
  bpm: number;
  key: string;
  timeSignature: AIConfig['timeSignature'];
  bars: number;
  tracks: AIGenerationTrack[];
}

export const MAX_GENERATIONS = 5;

export const GENRES: Array<{ id: Genre; label: string; emoji: string }> = [
  { id: 'pop', label: 'Pop', emoji: '🎵' },
  { id: 'rock', label: 'Rock', emoji: '🎸' },
  { id: 'jazz', label: 'Jazz', emoji: '🎷' },
  { id: 'blues', label: 'Blues', emoji: '🎺' },
  { id: 'hip-hop', label: 'Hip-Hop', emoji: '🎤' },
  { id: 'electronic', label: 'Electronic', emoji: '🎛' },
  { id: 'funk', label: 'Funk', emoji: '🪗' },
  { id: 'soul', label: 'Soul', emoji: '🎼' },
  { id: 'rnb', label: 'R&B', emoji: '🎙' },
  { id: 'latin', label: 'Latin', emoji: '💃' },
  { id: 'reggae', label: 'Reggae', emoji: '🌴' },
  { id: 'country', label: 'Country', emoji: '🤠' },
  { id: 'classical', label: 'Classical', emoji: '🎻' },
  { id: 'metal', label: 'Metal', emoji: '🤘' },
];

export const INSTRUMENTS: Array<{ id: Instrument; label: string; emoji: string; group: string }> = [
  { id: 'drums', label: 'Drums', emoji: '🥁', group: 'Rhythm' },
  { id: 'bass', label: 'Bass', emoji: '🎸', group: 'Rhythm' },
  { id: 'piano', label: 'Piano', emoji: '🎹', group: 'Keys' },
  { id: 'organ', label: 'Organ', emoji: '🎹', group: 'Keys' },
  { id: 'vibraphone', label: 'Vibraphone', emoji: '🎵', group: 'Keys' },
  { id: 'guitar-acoustic', label: 'Acoustic Gtr', emoji: '🎸', group: 'Guitar' },
  { id: 'guitar-electric', label: 'Electric Gtr', emoji: '⚡', group: 'Guitar' },
  { id: 'saxophone', label: 'Saxophone', emoji: '🎷', group: 'Wind' },
  { id: 'trumpet', label: 'Trumpet', emoji: '🎺', group: 'Wind' },
  { id: 'trombone', label: 'Trombone', emoji: '🎺', group: 'Wind' },
  { id: 'flute', label: 'Flute', emoji: '🪈', group: 'Wind' },
  { id: 'clarinet', label: 'Clarinet', emoji: '🎵', group: 'Wind' },
  { id: 'harmonica', label: 'Harmonica', emoji: '🎵', group: 'Wind' },
  { id: 'violin', label: 'Violin', emoji: '🎻', group: 'Strings' },
  { id: 'cello', label: 'Cello', emoji: '🎻', group: 'Strings' },
  { id: 'harp', label: 'Harp', emoji: '🪗', group: 'Strings' },
  { id: 'strings', label: 'Strings Ens.', emoji: '🎻', group: 'Strings' },
  { id: 'synth-lead', label: 'Synth Lead', emoji: '🎛', group: 'Synth' },
  { id: 'synth-pad', label: 'Synth Pad', emoji: '🌊', group: 'Synth' },
  { id: 'choir', label: 'Choir', emoji: '🎤', group: 'Vocal' },
];

export const KEYS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm',
];

export const INSTRUMENT_GROUPS = ['Rhythm', 'Keys', 'Guitar', 'Wind', 'Strings', 'Synth', 'Vocal'];

const DRUM_MIDI_MAP: Record<DrumHitEvent['kind'], number> = {
  kick: 36,
  snare: 38,
  hat: 42,
  openHat: 46,
};

export function createMidiClipFromGenerationTrack(
  gen: AIGeneration,
  renderedTrack: AIGenerationTrack,
  color: string,
): AudioClip {
  const beatsPerBar = Number.parseInt(gen.timeSignature, 10) || 4;
  const secondsPerBeat = 60 / gen.bpm;
  const fallbackDurationSeconds = gen.bars * beatsPerBar * secondsPerBeat;
  const noteEvents = renderedTrack.notes.map(note => ({ ...note }));
  const drumEvents = renderedTrack.drumHits.map(hit => ({ ...hit }));
  const drumAsNotes: NoteEvent[] = drumEvents.map(hit => ({
    midi: DRUM_MIDI_MAP[hit.kind],
    startBeats: hit.startBeats,
    durationBeats: 0.25,
    velocity: hit.velocity,
  }));
  const midiNotes = (noteEvents.length > 0 ? noteEvents : drumAsNotes).sort(
    (left, right) => left.startBeats - right.startBeats || left.midi - right.midi,
  );
  const maxNoteEndBeats = midiNotes.reduce(
    (maxEnd, note) => Math.max(maxEnd, note.startBeats + Math.max(0.01, note.durationBeats)),
    0,
  );
  const maxDrumBeat = drumEvents.reduce((maxStart, hit) => Math.max(maxStart, hit.startBeats + 0.25), 0);
  const durationSeconds = Math.max(
    0.25,
    fallbackDurationSeconds,
    Math.max(maxNoteEndBeats, maxDrumBeat) * secondsPerBeat,
  );

  return {
    id: `midi_clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: `${renderedTrack.label} MIDI • ${gen.genre} ${gen.key} ${gen.bpm}bpm`,
    startTime: 0,
    duration: durationSeconds,
    audioBuffer: null,
    waveformPeaks: [],
    color,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    offset: 0,
    midiNotes,
    drumHits: drumEvents,
  };
}

export function formatRelativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return mins === 1 ? '1 min ago' : `${mins} mins ago`;
}

export async function renderPlansWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  render: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await render(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()),
  );

  return results;
}
