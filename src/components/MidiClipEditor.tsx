import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDAW } from '../context/DAWContext';
import type { AudioClip, ChordQuality, Instrument, NoteEvent, Track } from '../types/daw';
import { renderInstrumentPlan, instrumentColor } from '../lib/backingTrackRenderer';
import type { BackingTrackRequest, InstrumentPlan } from '../lib/backingTrackRenderer';
import { INSTRUMENTS } from './aiPanelUtils';
import { computePeaks } from '../lib/audioUtils';

interface MidiClipEditorProps {
  track: Track;
  clip: AudioClip;
  bpm: number;
  onClose: () => void;
}

const ROW_HEIGHT = 14;
const BEAT_WIDTH = 38;
const MIN_MIDI = 24;
const MAX_MIDI = 108;
const SNAP_BEATS = 0.25;
const NUDGE_STEP = 0.25;

const CHORD_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const CHORD_QUALITIES: Array<{ value: ChordQuality; label: string }> = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'diminished', label: 'Diminished' },
  { value: 'augmented', label: 'Augmented' },
  { value: 'sus2', label: 'Sus2' },
  { value: 'sus4', label: 'Sus4' },
  { value: 'major7', label: 'Major 7' },
  { value: 'minor7', label: 'Minor 7' },
  { value: 'dominant7', label: 'Dom 7' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapBeat(beat: number): number {
  return Math.round(beat / SNAP_BEATS) * SNAP_BEATS;
}

function noteLabel(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pitch = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pitch}${octave}`;
}

function getRelativeStartBeats(note: NoteEvent, clipStartBeats: number): number {
  return Math.max(0, note.startBeats - clipStartBeats);
}

// Parse instrument from MIDI clip name: "Piano MIDI • pop C 120bpm" → 'piano'
function inferInstrumentFromClipName(clipName: string): Instrument | null {
  const labelPart = clipName.split(' MIDI')[0].replace(/^(AI|Local)\s+/i, '').trim();
  const match = INSTRUMENTS.find(i => i.label.toLowerCase() === labelPart.toLowerCase());
  return match ? match.id : null;
}

// Parse original BPM from clip name, e.g. "120bpm" → 120
function parseBpmFromClipName(clipName: string): number | null {
  const m = clipName.match(/(\d+)bpm/i);
  return m ? parseInt(m[1], 10) : null;
}

export default function MidiClipEditor({ track, clip, bpm, onClose }: MidiClipEditorProps) {
  const { state, dispatch } = useDAW();
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number | null>(null);
  const [quantizeGrid, setQuantizeGrid] = useState(0.25);
  const [swing, setSwing] = useState(0);
  const [chordRoot, setChordRoot] = useState<(typeof CHORD_ROOTS)[number]>('C');
  const [chordQuality, setChordQuality] = useState<ChordQuality>('major');
  const [chordBeat, setChordBeat] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const autoRenderTimeoutRef = useRef<number | null>(null);
  const hasAutoRenderMountedRef = useRef(false);
  const notes = clip.midiNotes ?? [];
  const beatsPerSecond = bpm / 60;
  const clipStartBeats = clip.startTime * beatsPerSecond;

  const { minMidi, maxMidi, totalBeats } = useMemo(() => {
    if (!notes.length) {
      return {
        minMidi: 48,
        maxMidi: 72,
        totalBeats: Math.max(4, clip.duration * beatsPerSecond),
      };
    }
    const noteMin = Math.min(...notes.map(note => note.midi));
    const noteMax = Math.max(...notes.map(note => note.midi));
    const furthestEndBeat = Math.max(...notes.map(note => getRelativeStartBeats(note, clipStartBeats) + note.durationBeats));
    return {
      minMidi: clamp(noteMin - 4, MIN_MIDI, MAX_MIDI - 8),
      maxMidi: clamp(noteMax + 4, MIN_MIDI + 8, MAX_MIDI),
      totalBeats: Math.max(4, clip.duration * beatsPerSecond, furthestEndBeat + 1),
    };
  }, [beatsPerSecond, clip.duration, clipStartBeats, notes]);

  const pianoWidth = Math.max(420, totalBeats * BEAT_WIDTH);
  const rowCount = maxMidi - minMidi + 1;
  const pianoHeight = rowCount * ROW_HEIGHT;
  const selectedNote = selectedNoteIndex != null ? notes[selectedNoteIndex] ?? null : null;
  const selectedRelativeBeat = selectedNote ? getRelativeStartBeats(selectedNote, clipStartBeats) : null;

  const applyQuantize = () => {
    dispatch({
      type: 'QUANTIZE_MIDI_CLIP',
      payload: {
        trackId: track.id,
        clipId: clip.id,
        gridBeats: quantizeGrid,
        swing,
      },
    });
  };

  const nudgeClip = (deltaBeats: number) => {
    dispatch({
      type: 'NUDGE_MIDI_CLIP',
      payload: {
        trackId: track.id,
        clipId: clip.id,
        deltaBeats,
      },
    });
  };

  const replaceChord = () => {
    const targetBeat = selectedRelativeBeat != null ? selectedRelativeBeat : chordBeat;
    dispatch({
      type: 'REPLACE_MIDI_CHORD',
      payload: {
        trackId: track.id,
        clipId: clip.id,
        atBeat: clipStartBeats + Math.max(0, targetBeat),
        root: chordRoot,
        quality: chordQuality,
      },
    });
  };

  const handleRenderToAudio = useCallback(async () => {
    const hasMidiContent = (clip.midiNotes?.length ?? 0) > 0 || (clip.drumHits?.length ?? 0) > 0;
    if (!hasMidiContent) {
      setRenderError('No MIDI notes to render.');
      return;
    }
    setIsRendering(true);
    setRenderError(null);
    try {
      const inferredInstrument = inferInstrumentFromClipName(clip.name);
      const instrument: Instrument = clip.aiLink?.instrument ?? inferredInstrument ?? 'piano';
      const renderBpm = clip.aiLink?.bpm ?? parseBpmFromClipName(clip.name) ?? bpm;
      const renderTimeSignature = clip.aiLink?.timeSignature ?? state.timeSignature;
      const beatsPerBar = parseInt(renderTimeSignature, 10) || 4;

      // Normalize note startBeats to be clip-relative (offset from clip start)
      const relativeNotes = (clip.midiNotes ?? []).map(note => ({
        ...note,
        startBeats: Math.max(0, note.startBeats - clipStartBeats),
      }));
      const relativeDrumHits = (clip.drumHits ?? []).map(hit => ({
        ...hit,
        startBeats: Math.max(0, hit.startBeats - clipStartBeats),
      }));

      // Calculate bars needed to fit all content
      const maxRelativeBeat = Math.max(
        ...relativeNotes.map(n => n.startBeats + n.durationBeats),
        ...relativeDrumHits.map(h => h.startBeats + 0.25),
        clip.duration * (renderBpm / 60),
        beatsPerBar,
      );
      const bars = Math.max(1, Math.ceil(maxRelativeBeat / beatsPerBar));

      const request: BackingTrackRequest = {
        genre: clip.aiLink?.genre ?? state.aiConfig.genre,
        bpm: renderBpm,
        key: clip.aiLink?.key ?? state.aiConfig.key,
        timeSignature: renderTimeSignature,
        bars,
        instruments: [instrument],
      };
      const plan: InstrumentPlan = {
        instrument,
        notes: instrument !== 'drums' ? relativeNotes : undefined,
        drumHits: instrument === 'drums' ? relativeDrumHits : undefined,
      };

      const buffer = await renderInstrumentPlan(request, plan);
      const newColor = instrumentColor(instrument);
      const targetTrackId = clip.aiLink?.role === 'midi'
        ? (clip.aiLink.linkedTrackId ?? track.id)
        : track.id;
      const targetClipId = clip.aiLink?.role === 'midi'
        ? (clip.aiLink.linkedClipId ?? clip.id)
        : clip.id;
      const targetTrack = state.tracks.find(t => t.id === targetTrackId);
      const targetClip = targetTrack?.clips.find(c => c.id === targetClipId);

      if (!targetTrack || !targetClip) {
        setRenderError('Linked audio clip not found. Regenerate the take linkage.');
        return;
      }

      dispatch({
        type: 'UPDATE_CLIP',
        payload: {
          trackId: targetTrackId,
          clipId: targetClipId,
          updates: {
            audioBuffer: buffer,
            duration: buffer.duration,
            waveformPeaks: computePeaks(buffer, 200),
            color: newColor,
            aiLink: targetClip.aiLink ? { ...targetClip.aiLink } : undefined,
          },
        },
      });
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Render failed.');
    } finally {
      setIsRendering(false);
    }
  }, [bpm, clip, clipStartBeats, dispatch, state.aiConfig.genre, state.aiConfig.key, state.timeSignature, state.tracks, track.id]);

  useEffect(() => {
    if (!clip.aiLink || clip.aiLink.role !== 'midi' || !clip.aiLink.autoUpdateLinkedAudio) return;
    if (!hasAutoRenderMountedRef.current) {
      hasAutoRenderMountedRef.current = true;
      return;
    }
    if (isRendering) return;
    if (autoRenderTimeoutRef.current) {
      window.clearTimeout(autoRenderTimeoutRef.current);
    }
    autoRenderTimeoutRef.current = window.setTimeout(() => {
      void handleRenderToAudio();
    }, 260);
  }, [clip.aiLink, clip.drumHits, clip.midiNotes, handleRenderToAudio, isRendering]);

  useEffect(() => () => {
    if (autoRenderTimeoutRef.current) {
      window.clearTimeout(autoRenderTimeoutRef.current);
    }
  }, []);

  const addNote = (startBeats: number, midi: number) => {
    dispatch({
      type: 'ADD_MIDI_NOTE',
      payload: {
        trackId: track.id,
        clipId: clip.id,
        note: {
          startBeats: clipStartBeats + Math.max(0, snapBeat(startBeats)),
          durationBeats: 1,
          midi: clamp(Math.round(midi), 0, 127),
          velocity: 0.75,
        },
      },
    });
  };

  const updateSelectedVelocity = (velocity: number) => {
    if (selectedNoteIndex == null) return;
    dispatch({
      type: 'UPDATE_MIDI_NOTE',
      payload: {
        trackId: track.id,
        clipId: clip.id,
        noteIndex: selectedNoteIndex,
        updates: { velocity },
      },
    });
  };

  const deleteSelectedNote = () => {
    if (selectedNoteIndex == null) return;
    dispatch({
      type: 'REMOVE_MIDI_NOTE',
      payload: {
        trackId: track.id,
        clipId: clip.id,
        noteIndex: selectedNoteIndex,
      },
    });
    setSelectedNoteIndex(null);
  };

  const handleGridDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const beat = (event.clientX - rect.left) / BEAT_WIDTH;
    const row = Math.floor((event.clientY - rect.top) / ROW_HEIGHT);
    const midi = maxMidi - row;
    addNote(beat, midi);
  };

  const onNoteDrag = (event: React.MouseEvent<HTMLDivElement>, noteIndex: number) => {
    event.stopPropagation();
    setSelectedNoteIndex(noteIndex);
    const startX = event.clientX;
    const startY = event.clientY;
    const note = notes[noteIndex];
    if (!note) return;
    const initialStart = note.startBeats;
    const initialMidi = note.midi;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaBeats = snapBeat((moveEvent.clientX - startX) / BEAT_WIDTH);
      const deltaMidi = Math.round((startY - moveEvent.clientY) / ROW_HEIGHT);
      dispatch({
        type: 'UPDATE_MIDI_NOTE',
        payload: {
          trackId: track.id,
          clipId: clip.id,
          noteIndex,
          updates: {
            startBeats: Math.max(0, initialStart + deltaBeats),
            midi: clamp(initialMidi + deltaMidi, 0, 127),
          },
        },
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onNoteResize = (event: React.MouseEvent<HTMLDivElement>, noteIndex: number) => {
    event.stopPropagation();
    setSelectedNoteIndex(noteIndex);
    const startX = event.clientX;
    const note = notes[noteIndex];
    if (!note) return;
    const initialDuration = note.durationBeats;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaBeats = snapBeat((moveEvent.clientX - startX) / BEAT_WIDTH);
      dispatch({
        type: 'UPDATE_MIDI_NOTE',
        payload: {
          trackId: track.id,
          clipId: clip.id,
          noteIndex,
          updates: {
            durationBeats: Math.max(0.25, initialDuration + deltaBeats),
          },
        },
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <section className="midi-editor-panel">
      <div className="midi-editor-header">
        <div>
          <h3>MIDI Clip Editor</h3>
          <p>{track.name} · {clip.name}</p>
        </div>
        <div className="midi-editor-actions">
          <button
            type="button"
            className="midi-editor-btn"
            onClick={() => {
              const fallbackMidi = selectedNote?.midi ?? Math.round((minMidi + maxMidi) / 2);
              addNote(totalBeats - 1, fallbackMidi);
            }}
          >
            + Add Note
          </button>
          <button type="button" className="midi-editor-btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="midi-editor-body">
        <div className="midi-editor-grid-wrap">
          <div className="midi-editor-grid" style={{ width: pianoWidth, height: pianoHeight }} onDoubleClick={handleGridDoubleClick}>
            {Array.from({ length: rowCount }).map((_, rowIndex) => {
              const midi = maxMidi - rowIndex;
              const isBlackKey = [1, 3, 6, 8, 10].includes(midi % 12);
              return (
                <div
                  key={midi}
                  className={`midi-row ${isBlackKey ? 'midi-row-black' : ''}`}
                  style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  <span className="midi-row-label">{noteLabel(midi)}</span>
                </div>
              );
            })}

            {Array.from({ length: Math.ceil(totalBeats) + 1 }).map((_, beat) => (
              <div
                key={`beat_${beat}`}
                className={`midi-beat-line ${beat % 4 === 0 ? 'midi-beat-bar' : ''}`}
                style={{ left: beat * BEAT_WIDTH }}
              />
            ))}

            {notes.map((note, noteIndex) => {
              const left = getRelativeStartBeats(note, clipStartBeats) * BEAT_WIDTH;
              const width = Math.max(8, note.durationBeats * BEAT_WIDTH);
              const top = (maxMidi - note.midi) * ROW_HEIGHT + 1;
              return (
                <div
                  key={`${note.startBeats}_${note.midi}_${noteIndex}`}
                  className={`midi-note-block ${selectedNoteIndex === noteIndex ? 'selected' : ''}`}
                  style={{ left, top, width, height: ROW_HEIGHT - 2, opacity: clamp(note.velocity, 0.15, 1) }}
                  onMouseDown={(event) => onNoteDrag(event, noteIndex)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNoteIndex(noteIndex);
                  }}
                >
                  <span className="midi-note-label">{noteLabel(note.midi)}</span>
                  <div className="midi-note-resize-handle" onMouseDown={(event) => onNoteResize(event, noteIndex)} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="midi-editor-inspector">
          <h4>Note Inspector</h4>
          {!selectedNote && <p>Select a note to edit velocity or delete it.</p>}
          {selectedNote && (
            <>
              <div className="midi-inspector-row"><span>Pitch</span><strong>{noteLabel(selectedNote.midi)}</strong></div>
              <div className="midi-inspector-row"><span>Start</span><strong>{selectedNote.startBeats.toFixed(2)} beats</strong></div>
              <div className="midi-inspector-row"><span>Length</span><strong>{selectedNote.durationBeats.toFixed(2)} beats</strong></div>
              <label className="midi-inspector-slider">
                <span>Velocity {Math.round(selectedNote.velocity * 127)}</span>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.01}
                  value={selectedNote.velocity}
                  onChange={(event) => updateSelectedVelocity(parseFloat(event.target.value))}
                />
              </label>
              <button type="button" className="midi-editor-btn midi-delete-note-btn" onClick={deleteSelectedNote}>
                Delete Note
              </button>
            </>
          )}
          <div className="midi-tool-section">
            <h5>Beat Tools</h5>
            <label className="midi-tool-field">
              <span>Grid</span>
              <select value={quantizeGrid} onChange={(event) => setQuantizeGrid(parseFloat(event.target.value))}>
                <option value={1}>1/4</option>
                <option value={0.5}>1/8</option>
                <option value={0.25}>1/16</option>
                <option value={0.125}>1/32</option>
              </select>
            </label>
            <label className="midi-inspector-slider">
              <span>Swing {Math.round(swing * 100)}%</span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={swing}
                onChange={(event) => setSwing(parseFloat(event.target.value))}
              />
            </label>
            <div className="midi-tool-actions">
              <button type="button" className="midi-editor-btn" onClick={applyQuantize}>Quantize</button>
              <button type="button" className="midi-editor-btn" onClick={() => nudgeClip(-NUDGE_STEP)}>Nudge -1/16</button>
              <button type="button" className="midi-editor-btn" onClick={() => nudgeClip(NUDGE_STEP)}>Nudge +1/16</button>
            </div>
          </div>
          <div className="midi-tool-section">
            <h5>Chord Swap</h5>
            <label className="midi-tool-field">
              <span>Root</span>
              <select value={chordRoot} onChange={(event) => setChordRoot(event.target.value as (typeof CHORD_ROOTS)[number])}>
                {CHORD_ROOTS.map(root => <option key={root} value={root}>{root}</option>)}
              </select>
            </label>
            <label className="midi-tool-field">
              <span>Quality</span>
              <select value={chordQuality} onChange={(event) => setChordQuality(event.target.value as ChordQuality)}>
                {CHORD_QUALITIES.map(quality => <option key={quality.value} value={quality.value}>{quality.label}</option>)}
              </select>
            </label>
            <label className="midi-tool-field">
              <span>Beat</span>
              <input
                type="number"
                min={0}
                step={0.25}
                value={selectedRelativeBeat != null ? selectedRelativeBeat.toFixed(2) : chordBeat}
                onChange={(event) => setChordBeat(Math.max(0, parseFloat(event.target.value) || 0))}
                disabled={selectedRelativeBeat != null}
              />
            </label>
            <button type="button" className="midi-editor-btn" onClick={replaceChord}>
              Replace Chord {selectedRelativeBeat != null ? '(Selected Note Beat)' : ''}
            </button>
          </div>
          <div className="midi-tool-section midi-render-section">
            <h5>Render to Audio</h5>
            <p className="midi-render-note">
              Bounce edited MIDI notes back to an audio clip using the same instrument engine.
              {clip.audioBuffer ? ' (Re-renders existing audio.)' : ''}
            </p>
            {renderError && <p className="midi-render-error">{renderError}</p>}
            <button
              type="button"
              className={`midi-editor-btn midi-render-btn ${isRendering ? 'midi-render-btn-busy' : ''}`}
              onClick={handleRenderToAudio}
              disabled={isRendering}
            >
              {isRendering ? '⟳ Rendering…' : '▶ Render to Audio'}
            </button>
          </div>
          <p className="midi-editor-hint">Double-click grid: add note · Drag note: move pitch/time · Drag right edge: resize</p>
        </div>
      </div>
    </section>
  );
}
