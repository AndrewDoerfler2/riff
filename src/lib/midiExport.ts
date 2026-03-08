import { Midi } from '@tonejs/midi';
import type { AudioClip } from '../types/daw';

/**
 * Encode a MIDI clip's notes as a Standard MIDI File and trigger a browser download.
 * Notes use absolute startBeats; clipStartBeats is subtracted so the file starts at beat 0.
 */
export function exportClipAsMidi(clip: AudioClip, bpm: number): void {
  const notes = clip.midiNotes ?? [];
  const secondsPerBeat = 60 / bpm;

  // Determine the beat offset so that notes start at beat 0 in the exported file.
  const clipStartBeats =
    notes.length > 0
      ? Math.min(...notes.map(n => n.startBeats))
      : 0;

  const midi = new Midi();
  midi.header.tempos.push({ bpm, ticks: 0 });
  midi.header.setTempo(bpm);

  const track = midi.addTrack();
  for (const note of notes) {
    const relativeStartBeats = Math.max(0, note.startBeats - clipStartBeats);
    track.addNote({
      midi: note.midi,
      time: relativeStartBeats * secondsPerBeat,
      duration: Math.max(0.01, note.durationBeats * secondsPerBeat),
      velocity: note.velocity,
    });
  }

  const bytes = midi.toArray();
  // Copy into a plain ArrayBuffer so TypeScript's strict Blob typing is satisfied.
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${clip.name.replace(/[^a-z0-9_\-. ]/gi, '_')}.mid`;
  a.click();
  URL.revokeObjectURL(url);
}
