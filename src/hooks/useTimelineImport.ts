/**
 * useTimelineImport
 *
 * Encapsulates all media-import and MIDI-clip-creation logic that was previously
 * inlined in Timeline.tsx. Extracted as a refactor to bring that component under
 * 800 lines and keep each concern independently testable.
 */
import { useRef, useCallback, useState, useMemo } from 'react';
import type React from 'react';
import { useDAW, useAudioEngineCtx } from '../context/DAWContext';
import type { Track, AudioClip, NoteEvent } from '../types/daw';
import { Midi } from '@tonejs/midi';
import { computePeaksAsync } from '../lib/audioUtils';
import { splitAudioBufferIntoStems } from '../lib/stemSeparation';
import { renderTrackMixToAudioBuffer } from '../lib/audioExport';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface ClipRef {
  trackId: string;
  clipId: string;
}

export interface ImportStatus {
  kind: 'audio' | 'video' | 'stems';
  fileName: string;
  progress: number;
  stage: string;
}

export interface ImportError {
  kind: 'audio' | 'video' | 'stems';
  message: string;
}

export interface PendingImportDecision {
  file: File;
  kind: 'audio' | 'video';
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param selectedTrackIds  Multi-selection track IDs from the Timeline
 * @param setSelectedClips  Stable dispatch from Timeline's useState<ClipRef[]>
 */
export function useTimelineImport(
  selectedTrackIds: string[],
  setSelectedClips: React.Dispatch<React.SetStateAction<ClipRef[]>>,
) {
  const { state, dispatch, createTrack } = useDAW();
  const { createClipFromFile } = useAudioEngineCtx();
  const { tracks, currentTime, bpm, timeSignature, selectedTrackId } = state;

  // ── Refs ────────────────────────────────────────────────────────────────────
  const audioImportRef = useRef<HTMLInputElement>(null);
  const videoImportRef = useRef<HTMLInputElement>(null);
  const midiImportRef  = useRef<HTMLInputElement>(null);
  const midiImportTrackIdRef = useRef<string | null>(null);
  const stemImportAbortRef   = useRef<AbortController | null>(null);

  // ── State ───────────────────────────────────────────────────────────────────
  const [importStatus, setImportStatus]                 = useState<ImportStatus | null>(null);
  const [importError, setImportError]                   = useState<ImportError | null>(null);
  const [canCancelStemImport, setCanCancelStemImport]   = useState(false);
  const [pendingImportDecision, setPendingImportDecision] = useState<PendingImportDecision | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const selectedTrack = useMemo(
    () => tracks.find(t => t.id === selectedTrackId) ?? null,
    [tracks, selectedTrackId],
  );

  const activeStemGroup = useMemo(() => {
    const targetTrackIds = selectedTrackIds.length
      ? selectedTrackIds
      : (selectedTrackId ? [selectedTrackId] : []);
    if (!targetTrackIds.length) return null;

    const resolved = targetTrackIds
      .map(id => tracks.find(t => t.id === id))
      .filter((t): t is Track => Boolean(t));

    const groupIds = Array.from(new Set(
      resolved
        .map(t => t.stemGroupId)
        .filter((g): g is string => Boolean(g)),
    ));
    if (groupIds.length !== 1) return null;
    const groupId = groupIds[0];
    const groupTracks = tracks.filter(t => t.stemGroupId === groupId && t.type === 'audio');
    if (groupTracks.length < 2) return null;
    return {
      id: groupId,
      sourceName: groupTracks[0]?.stemSourceName ?? 'Stem Group',
      totalTracks: groupTracks.length,
    };
  }, [selectedTrackId, selectedTrackIds, tracks]);

  // ── Internal helpers ────────────────────────────────────────────────────────

  const ensureAudioTrack = useCallback(() => {
    if (selectedTrack && selectedTrack.type === 'audio') return selectedTrack.id;
    const track = createTrack('audio');
    dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: track });
    dispatch({ type: 'SELECT_TRACK', payload: track.id });
    return track.id;
  }, [createTrack, dispatch, selectedTrack]);

  const ensureMidiTrack = useCallback((preferredTrackId?: string): string => {
    if (preferredTrackId) {
      const t = tracks.find(t => t.id === preferredTrackId && t.type === 'midi');
      if (t) return t.id;
    }
    if (selectedTrack && selectedTrack.type === 'midi') return selectedTrack.id;
    const existing = tracks.find(t => t.type === 'midi');
    if (existing) {
      dispatch({ type: 'SELECT_TRACK', payload: existing.id });
      return existing.id;
    }
    const newTrack = createTrack('midi');
    dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: newTrack });
    dispatch({ type: 'SELECT_TRACK', payload: newTrack.id });
    return newTrack.id;
  }, [createTrack, dispatch, selectedTrack, tracks]);

  const createClipFromAudioBuffer = useCallback(async (
    audioBuffer: AudioBuffer,
    options: { name: string; startTime: number; color: string },
  ): Promise<AudioClip> => {
    const waveformPeaks = await computePeaksAsync(audioBuffer, 200);
    return {
      id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: options.name,
      startTime: options.startTime,
      duration: audioBuffer.duration,
      audioBuffer,
      waveformPeaks,
      color: options.color,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      offset: 0,
    };
  }, []);

  const importFileToTrack = useCallback(async (
    file: File,
    clipColor: string,
    kind: ImportStatus['kind'],
  ) => {
    setImportError(null);
    const trackId = ensureAudioTrack();
    const clip = await createClipFromFile(file, {
      startTime: currentTime,
      color: clipColor,
      onProgress: (progress, stage) => {
        setImportStatus({ kind, fileName: file.name, progress, stage });
      },
    });
    dispatch({ type: 'ADD_CLIP', payload: { trackId, clip } });
    setImportStatus({ kind, fileName: file.name, progress: 100, stage: 'Complete' });
    window.setTimeout(() => {
      setImportStatus(current => (current?.fileName === file.name ? null : current));
    }, 800);
  }, [createClipFromFile, currentTime, dispatch, ensureAudioTrack]);

  const importFileAsStems = useCallback(async (file: File) => {
    setImportError(null);
    setImportStatus({ kind: 'stems', fileName: file.name, progress: 5, stage: 'Decoding source audio' });
    const stemAbortController = new AbortController();
    stemImportAbortRef.current = stemAbortController;
    setCanCancelStemImport(true);

    const decodeContext = new AudioContext();
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (stemAbortController.signal.aborted) {
        throw new DOMException('Stem separation canceled.', 'AbortError');
      }
      const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
      const stems = await splitAudioBufferIntoStems(audioBuffer, {
        signal: stemAbortController.signal,
        onProgress: (progress, stage) => {
          setImportStatus({ kind: 'stems', fileName: file.name, progress, stage });
        },
      });
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const stemGroupId = `stem_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const preparedTracks: Array<{ track: Track; clip: AudioClip }> = [];

      for (let i = 0; i < stems.length; i += 1) {
        if (stemAbortController.signal.aborted) {
          throw new DOMException('Stem separation canceled.', 'AbortError');
        }
        const stem = stems[i];
        setImportStatus({
          kind: 'stems',
          fileName: file.name,
          progress: 72 + ((i + 0.2) / stems.length) * 24,
          stage: `Rendering ${stem.name} stem (${i + 1}/${stems.length})`,
        });
        const clip = await createClipFromAudioBuffer(stem.audioBuffer, {
          name: `${baseName} (${stem.name})`,
          startTime: currentTime,
          color: stem.color,
        });
        const track: Track = {
          ...createTrack('audio'),
          name: `${stem.name} Stem`,
          color: stem.color,
          stemGroupId,
          stemRole: stem.id,
          stemSourceName: baseName,
        };
        preparedTracks.push({ track, clip });
        setImportStatus({
          kind: 'stems',
          fileName: file.name,
          progress: 72 + ((i + 1) / stems.length) * 24,
          stage: `Prepared ${stem.name} stem (${i + 1}/${stems.length})`,
        });
      }

      let firstTrackId: string | null = null;
      for (const { track, clip } of preparedTracks) {
        dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: track });
        dispatch({ type: 'ADD_CLIP', payload: { trackId: track.id, clip } });
        if (!firstTrackId) firstTrackId = track.id;
      }
      if (firstTrackId) {
        dispatch({ type: 'SELECT_TRACK', payload: firstTrackId });
      }

      setImportStatus({ kind: 'stems', fileName: file.name, progress: 100, stage: 'Stem import complete' });
      window.setTimeout(() => {
        setImportStatus(current => (current?.fileName === file.name ? null : current));
      }, 1000);
    } finally {
      if (stemImportAbortRef.current === stemAbortController) {
        stemImportAbortRef.current = null;
      }
      setCanCancelStemImport(false);
      await decodeContext.close();
    }
  }, [createClipFromAudioBuffer, createTrack, currentTime, dispatch]);

  // ── Public handlers ─────────────────────────────────────────────────────────

  const handleAudioImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingImportDecision({ file, kind: 'audio' });
  }, []);

  const handleVideoAudioImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingImportDecision({ file, kind: 'video' });
  }, []);

  const handleImportKeepMaster = useCallback(async () => {
    if (!pendingImportDecision) return;
    const { file, kind } = pendingImportDecision;
    setPendingImportDecision(null);
    try {
      if (kind === 'audio') {
        await importFileToTrack(file, '#64d2ff', 'audio');
      } else {
        await importFileToTrack(file, '#ff9f0a', 'video');
      }
    } catch (err) {
      setImportStatus(null);
      console.error('Failed to import source file:', err);
      setImportError({
        kind,
        message: err instanceof Error
          ? err.message
          : (kind === 'audio' ? 'Unable to import that audio file.' : 'Unable to extract audio from that video file.'),
      });
    }
  }, [importFileToTrack, pendingImportDecision]);

  const handleImportSplitStems = useCallback(async () => {
    if (!pendingImportDecision) return;
    const { file } = pendingImportDecision;
    setPendingImportDecision(null);
    try {
      await importFileAsStems(file);
    } catch (err) {
      if (isAbortError(err)) {
        setImportError(null);
        setImportStatus({ kind: 'stems', fileName: file.name, progress: 0, stage: 'Stem import canceled' });
        window.setTimeout(() => {
          setImportStatus(current => (current?.fileName === file.name ? null : current));
        }, 900);
        return;
      }
      setImportStatus(null);
      console.error('Failed to split imported media into stems:', err);
      setImportError({
        kind: 'stems',
        message: err instanceof Error ? err.message : 'Unable to separate the file into stems.',
      });
    }
  }, [importFileAsStems, pendingImportDecision]);

  const handleCancelStemImport = useCallback(() => {
    const active = stemImportAbortRef.current;
    if (!active) return;
    active.abort();
    setCanCancelStemImport(false);
    setImportStatus(current => {
      if (!current || current.kind !== 'stems') return current;
      return { ...current, stage: 'Cancelling stem import...' };
    });
  }, []);

  const handleMergeStemGroup = useCallback(async () => {
    if (!activeStemGroup) return;
    const groupTracks = tracks.filter(
      t => t.type === 'audio' && t.stemGroupId === activeStemGroup.id,
    );
    const audibleGroupTracks = groupTracks.filter(
      t => !t.muted && t.clips.some(c => c.audioBuffer && c.duration > 0),
    );
    if (!audibleGroupTracks.length) {
      setImportError({ kind: 'stems', message: 'No audible clips found in the selected stem group.' });
      return;
    }
    setImportError(null);
    setImportStatus({
      kind: 'stems',
      fileName: activeStemGroup.sourceName,
      progress: 20,
      stage: `Merging ${audibleGroupTracks.length} stem tracks`,
    });
    try {
      const { rendered, durationSeconds } = await renderTrackMixToAudioBuffer(state, audibleGroupTracks);
      setImportStatus({ kind: 'stems', fileName: activeStemGroup.sourceName, progress: 78, stage: 'Building merged master clip' });
      const mergedClip = await createClipFromAudioBuffer(rendered, {
        name: `${activeStemGroup.sourceName} (Merged)`,
        startTime: currentTime,
        color: '#5ac8fa',
      });
      mergedClip.duration = Math.max(0.1, durationSeconds);
      const mergedTrack: Track = {
        ...createTrack('audio'),
        name: `${activeStemGroup.sourceName} Master`,
        color: '#5ac8fa',
      };
      dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: mergedTrack });
      dispatch({ type: 'ADD_CLIP', payload: { trackId: mergedTrack.id, clip: mergedClip } });
      dispatch({ type: 'SELECT_TRACK', payload: mergedTrack.id });
      setImportStatus({ kind: 'stems', fileName: activeStemGroup.sourceName, progress: 100, stage: 'Merged master track created' });
      window.setTimeout(() => {
        setImportStatus(current => (
          current?.kind === 'stems' && current.fileName === activeStemGroup.sourceName ? null : current
        ));
      }, 1000);
    } catch (error) {
      console.error('Failed to merge stem group:', error);
      setImportStatus(null);
      setImportError({
        kind: 'stems',
        message: error instanceof Error ? error.message : 'Unable to merge selected stem tracks.',
      });
    }
  }, [activeStemGroup, createClipFromAudioBuffer, createTrack, currentTime, dispatch, state, tracks]);

  /** Create a blank 4-bar MIDI clip at `startTime` on a MIDI track. */
  const handleCreateMidiClip = useCallback((startTime: number, trackId?: string) => {
    const tid = ensureMidiTrack(trackId);
    const beatsPerBar = parseInt(timeSignature, 10) || 4;
    const duration = (beatsPerBar * 4) / (bpm / 60);
    const clipId = `midi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const clip: AudioClip = {
      id: clipId,
      name: 'MIDI Clip',
      startTime: Math.max(0, startTime),
      duration,
      audioBuffer: null,
      waveformPeaks: [],
      color: '#a78bfa',
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      offset: 0,
      midiNotes: [],
    };
    dispatch({ type: 'ADD_CLIP', payload: { trackId: tid, clip } });
    setSelectedClips([{ trackId: tid, clipId }]);
  }, [bpm, dispatch, ensureMidiTrack, setSelectedClips, timeSignature]);

  /** Import a .mid file onto a MIDI track. */
  const handleMidiFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      const midi = new Midi(ab);
      const renderBpm = midi.header.tempos[0]?.bpm ?? bpm;
      const allNotes: NoteEvent[] = [];
      for (const midiTrack of midi.tracks) {
        if (midiTrack.channel === 9) continue;
        for (const note of midiTrack.notes) {
          allNotes.push({
            midi: note.midi,
            startBeats: note.time * (renderBpm / 60),
            durationBeats: note.duration * (renderBpm / 60),
            velocity: note.velocity,
          });
        }
      }
      allNotes.sort((a, b) => a.startBeats - b.startBeats);
      const endBeat = allNotes.length > 0
        ? Math.max(...allNotes.map(n => n.startBeats + n.durationBeats))
        : 8;
      const duration = endBeat / (renderBpm / 60);
      const trackId = ensureMidiTrack(midiImportTrackIdRef.current ?? undefined);
      midiImportTrackIdRef.current = null;
      const clipId = `midi_import_${Date.now()}`;
      const clip: AudioClip = {
        id: clipId,
        name: file.name.replace(/\.mid[i]?$/i, ''),
        startTime: currentTime,
        duration: Math.max(1, duration),
        audioBuffer: null,
        waveformPeaks: [],
        color: '#a78bfa',
        gain: 1,
        fadeIn: 0,
        fadeOut: 0,
        offset: 0,
        midiNotes: allNotes,
      };
      dispatch({ type: 'ADD_CLIP', payload: { trackId, clip } });
      setSelectedClips([{ trackId, clipId }]);
    } catch (err) {
      console.error('MIDI import failed:', err);
      setImportError({ kind: 'audio', message: `MIDI import failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [bpm, currentTime, dispatch, ensureMidiTrack, setSelectedClips]);

  /**
   * Opens the MIDI file picker, optionally targeting a specific track.
   * Pass `null` to let ensureMidiTrack pick/create the appropriate track.
   */
  const openMidiImport = useCallback((trackId: string | null = null) => {
    midiImportTrackIdRef.current = trackId;
    midiImportRef.current?.click();
  }, []);

  const dismissImportDecision = useCallback(() => setPendingImportDecision(null), []);

  return {
    // Refs wired to hidden <input> elements rendered by Timeline
    audioImportRef,
    videoImportRef,
    midiImportRef,
    // Import state
    importStatus,
    importError,
    setImportError,
    pendingImportDecision,
    canCancelStemImport,
    // Stem group
    activeStemGroup,
    // Handlers
    handleAudioImport,
    handleVideoAudioImport,
    handleImportKeepMaster,
    handleImportSplitStems,
    handleCancelStemImport,
    handleMergeStemGroup,
    handleCreateMidiClip,
    handleMidiFileImport,
    openMidiImport,
    dismissImportDecision,
  };
}
