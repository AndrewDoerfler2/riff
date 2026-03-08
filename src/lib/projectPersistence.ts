import type {
  DAWState,
  Track,
  AudioClip,
  VideoClip,
  PluginInstance,
  PluginType,
  DrumHitEvent,
  NoteEvent,
} from '../types/daw';

export const SCHEMA_VERSION = 1;
const LS_KEY = 'riff-project-v1';
const IDB_DB_NAME = 'riff-daw';
const IDB_DB_VER = 1;
const IDB_STORE = 'audio-clips';

// ─── AudioBuffer serialization ─────────────────────────────────────────────────

interface ChannelData {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  channels: string[]; // base64-encoded Float32Array per channel
}

function encodeBuffer(buf: AudioBuffer): ChannelData {
  const channels: string[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const f32 = buf.getChannelData(c);
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    // Process in 8KB chunks to avoid call-stack overflow on large buffers
    const CHUNK = 8192;
    let bin = '';
    for (let i = 0; i < u8.length; i += CHUNK) {
      bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
    }
    channels.push(btoa(bin));
  }
  return {
    sampleRate: buf.sampleRate,
    numberOfChannels: buf.numberOfChannels,
    length: buf.length,
    channels,
  };
}

function decodeBuffer(data: ChannelData): AudioBuffer {
  const buf = new AudioBuffer({
    numberOfChannels: data.numberOfChannels,
    length: data.length,
    sampleRate: data.sampleRate,
  });
  for (let c = 0; c < data.numberOfChannels; c++) {
    const bin = atob(data.channels[c]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    buf.copyToChannel(new Float32Array(u8.buffer), c);
  }
  return buf;
}

// ─── IndexedDB helpers ─────────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VER);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSaveAllBuffers(clips: Map<string, AudioBuffer>): Promise<void> {
  if (clips.size === 0) return;
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  const puts: Promise<void>[] = [];
  clips.forEach((buf, id) => {
    puts.push(new Promise((resolve, reject) => {
      const req = store.put(encodeBuffer(buf), id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  });
  await Promise.all(puts);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbLoadBuffer(clipId: string): Promise<AudioBuffer | null> {
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, 'readonly');
  const store = tx.objectStore(IDB_STORE);
  return new Promise((resolve) => {
    const req = store.get(clipId);
    req.onsuccess = () => {
      db.close();
      if (!req.result) { resolve(null); return; }
      try { resolve(decodeBuffer(req.result as ChannelData)); }
      catch { resolve(null); }
    };
    req.onerror = () => { db.close(); resolve(null); };
  });
}

async function idbPruneKeys(keepIds: Set<string>): Promise<void> {
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  await new Promise<void>((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const key of req.result as string[]) {
        if (!keepIds.has(key)) store.delete(key);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ─── Serialization types ────────────────────────────────────────────────────────

interface SerializedClip {
  id: string; name: string; startTime: number; duration: number;
  waveformPeaks: number[]; color: string; gain: number;
  fadeIn: number; fadeOut: number; offset: number;
  midiNotes?: NoteEvent[];
  drumHits?: DrumHitEvent[];
  aiLink?: AudioClip['aiLink'];
  audioData?: ChannelData;
}

interface SerializedVideoClip {
  id: string; name: string; startTime: number; duration: number; color: string;
  audioWaveformPeaks?: number[];
  trimIn?: number; trimOut?: number; opacity?: number; volume?: number;
  layoutX?: number; layoutY?: number; layoutScale?: number;
  textOverlays?: VideoClip['textOverlays'];
}

interface SerializedTrack {
  id: string; name: string; type: string; color: string;
  armed: boolean; muted: boolean; soloed: boolean;
  volume: number; pan: number; height: number; inputMonitor: boolean;
  meterMode?: 'pre' | 'post';
  stemGroupId?: string;
  stemRole?: Track['stemRole'];
  stemSourceName?: string;
  automationLanes?: Track['automationLanes'];
  automationLaneExpanded?: boolean;
  plugins: PluginInstance[];
  clips: SerializedClip[];
  videoClips: SerializedVideoClip[];
}

export interface RiffProjectFile {
  schema: number;
  name: string;
  savedAt: string;
  bpm: number;
  timeSignature: string;
  loopEnabled: boolean; loopStart: number; loopEnd: number;
  metronomeEnabled: boolean; snapEnabled: boolean;
  preRollBars?: number;
  overdubEnabled?: boolean;
  masterVolume: number; masterPan: number;
  pluginPresets?: Partial<Record<PluginType, Array<{
    id: string;
    name: string;
    pluginType: PluginType;
    parameters: Record<string, number>;
  }>>>;
  zoom: number;
  autoScroll?: boolean;
  markers?: Array<{ id: string; name: string; time: number; color: string }>;
  aiConfig: {
    genre: string; bpm: number; key: string; timeSignature: string;
    bars: number; instruments: string[];
    useAiArrangement: boolean; useLocalPatterns: boolean;
  };
  tracks: SerializedTrack[];
}

// ─── Serialize state → project file ───────────────────────────────────────────

function serializeProject(state: DAWState, includeAudio: boolean): RiffProjectFile {
  return {
    schema: SCHEMA_VERSION,
    name: state.projectName,
    savedAt: new Date().toISOString(),
    bpm: state.bpm,
    timeSignature: state.timeSignature,
    loopEnabled: state.loopEnabled, loopStart: state.loopStart, loopEnd: state.loopEnd,
    metronomeEnabled: state.metronomeEnabled, snapEnabled: state.snapEnabled,
    preRollBars: state.preRollBars,
    overdubEnabled: state.overdubEnabled,
    masterVolume: state.masterVolume, masterPan: state.masterPan,
    pluginPresets: state.pluginPresets,
    zoom: state.zoom,
    autoScroll: state.autoScroll,
    markers: (state.markers ?? []).map(m => ({ id: m.id, name: m.name, time: m.time, color: m.color })),
    aiConfig: {
      genre: state.aiConfig.genre,
      bpm: state.aiConfig.bpm,
      key: state.aiConfig.key,
      timeSignature: state.aiConfig.timeSignature,
      bars: state.aiConfig.bars,
      instruments: [...state.aiConfig.instruments],
      useAiArrangement: state.aiConfig.useAiArrangement,
      useLocalPatterns: state.aiConfig.useLocalPatterns,
    },
    tracks: state.tracks.map(track => ({
      id: track.id, name: track.name, type: track.type, color: track.color,
      armed: track.armed, muted: track.muted, soloed: track.soloed,
      volume: track.volume, pan: track.pan, height: track.height,
      inputMonitor: track.inputMonitor, meterMode: track.meterMode,
      stemGroupId: track.stemGroupId,
      stemRole: track.stemRole,
      stemSourceName: track.stemSourceName,
      automationLanes: track.automationLanes,
      automationLaneExpanded: track.automationLaneExpanded,
      plugins: track.plugins,
      clips: track.clips.map(clip => ({
        id: clip.id, name: clip.name, startTime: clip.startTime, duration: clip.duration,
        waveformPeaks: clip.waveformPeaks, color: clip.color, gain: clip.gain,
        fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, offset: clip.offset,
        ...(clip.midiNotes ? { midiNotes: clip.midiNotes } : {}),
        ...(clip.drumHits ? { drumHits: clip.drumHits } : {}),
        ...(clip.aiLink ? { aiLink: clip.aiLink } : {}),
        ...(includeAudio && clip.audioBuffer
          ? { audioData: encodeBuffer(clip.audioBuffer) }
          : {}),
      })),
      videoClips: track.videoClips.map(vc => ({
        id: vc.id, name: vc.name, startTime: vc.startTime, duration: vc.duration, color: vc.color,
        audioWaveformPeaks: vc.audioWaveformPeaks,
        trimIn: vc.trimIn, trimOut: vc.trimOut, opacity: vc.opacity, volume: vc.volume,
        layoutX: vc.layoutX, layoutY: vc.layoutY, layoutScale: vc.layoutScale,
        textOverlays: vc.textOverlays,
      })),
    })),
  };
}

// ─── Hydrate project file → DAW state ─────────────────────────────────────────

async function hydrateProject(
  file: RiffProjectFile,
  loadIDB: boolean,
): Promise<Partial<DAWState>> {
  const tracks: Track[] = await Promise.all(
    file.tracks.map(async (st): Promise<Track> => {
      const clips: AudioClip[] = await Promise.all(
        st.clips.map(async (sc): Promise<AudioClip> => {
          let audioBuffer: AudioBuffer | null = null;
          if (sc.audioData) {
            try { audioBuffer = decodeBuffer(sc.audioData); } catch { /* skip */ }
          } else if (loadIDB) {
            audioBuffer = await idbLoadBuffer(sc.id);
          }
          return {
            id: sc.id, name: sc.name, startTime: sc.startTime, duration: sc.duration,
            waveformPeaks: sc.waveformPeaks, color: sc.color, gain: sc.gain,
            fadeIn: sc.fadeIn, fadeOut: sc.fadeOut, offset: sc.offset,
            audioBuffer,
            midiNotes: sc.midiNotes ? [...sc.midiNotes] : undefined,
            drumHits: sc.drumHits ? [...sc.drumHits] : undefined,
            aiLink: sc.aiLink ? { ...sc.aiLink } : undefined,
          };
        }),
      );
      const videoClips: VideoClip[] = st.videoClips.map(vc => ({
        id: vc.id, name: vc.name, startTime: vc.startTime,
        duration: vc.duration, color: vc.color,
        src: '', thumbnailUrl: '',
        audioWaveformPeaks: vc.audioWaveformPeaks ? [...vc.audioWaveformPeaks] : [],
        trimIn: vc.trimIn ?? 0,
        trimOut: vc.trimOut ?? 0,
        opacity: vc.opacity ?? 1,
        volume: vc.volume ?? 1,
        layoutX: vc.layoutX ?? 0.5,
        layoutY: vc.layoutY ?? 0.5,
        layoutScale: vc.layoutScale ?? 1,
        textOverlays: (vc.textOverlays ?? []).map((overlay) => ({ ...overlay })),
      }));
      return {
        id: st.id, name: st.name, type: st.type as Track['type'], color: st.color,
        armed: st.armed, muted: st.muted, soloed: st.soloed,
        volume: st.volume, pan: st.pan, height: st.height, inputMonitor: st.inputMonitor,
        meterMode: st.meterMode ?? 'post',
        stemGroupId: st.stemGroupId,
        stemRole: st.stemRole,
        stemSourceName: st.stemSourceName,
        automationLanes: st.automationLanes ?? [],
        automationLaneExpanded: st.automationLaneExpanded ?? false,
        plugins: st.plugins, clips, videoClips,
      };
    }),
  );

  return {
    projectName: file.name,
    bpm: file.bpm,
    timeSignature: file.timeSignature as DAWState['timeSignature'],
    loopEnabled: file.loopEnabled, loopStart: file.loopStart, loopEnd: file.loopEnd,
    metronomeEnabled: file.metronomeEnabled, snapEnabled: file.snapEnabled,
    preRollBars: Math.max(0, Math.min(4, Math.round(file.preRollBars ?? 0))),
    overdubEnabled: file.overdubEnabled ?? true,
    masterVolume: file.masterVolume, masterPan: file.masterPan,
    pluginPresets: file.pluginPresets ?? {},
    zoom: file.zoom,
    autoScroll: file.autoScroll ?? true,
    markers: (file.markers ?? []).map(m => ({ id: m.id, name: m.name, time: Math.max(0, m.time), color: m.color })),
    aiConfig: {
      genre: file.aiConfig.genre as DAWState['aiConfig']['genre'],
      bpm: file.aiConfig.bpm,
      key: file.aiConfig.key,
      timeSignature: file.aiConfig.timeSignature as DAWState['aiConfig']['timeSignature'],
      bars: file.aiConfig.bars,
      instruments: file.aiConfig.instruments as DAWState['aiConfig']['instruments'],
      useAiArrangement: file.aiConfig.useAiArrangement,
      useLocalPatterns: file.aiConfig.useLocalPatterns,
      isGenerating: false, isRecordingSnippet: false, snippetDuration: 0, progress: 0,
    },
    tracks,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Save project structure to localStorage and all audio buffers to IndexedDB.
 * Fast for subsequent saves since IDB only updates what exists.
 */
export async function saveProjectLocally(state: DAWState): Promise<void> {
  localStorage.setItem(LS_KEY, JSON.stringify(serializeProject(state, false)));

  const buffers = new Map<string, AudioBuffer>();
  const keepIds = new Set<string>();
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      keepIds.add(clip.id);
      if (clip.audioBuffer) buffers.set(clip.id, clip.audioBuffer);
    }
  }
  await idbSaveAllBuffers(buffers);
  await idbPruneKeys(keepIds);
}

/**
 * Restore project from localStorage + IndexedDB.
 * Returns null if no saved project exists or schema is incompatible.
 */
export async function loadProjectLocally(): Promise<Partial<DAWState> | null> {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    const file: RiffProjectFile = JSON.parse(raw);
    if (file.schema !== SCHEMA_VERSION) {
      console.warn('riff: project schema mismatch — skipping restore');
      return null;
    }
    return await hydrateProject(file, true);
  } catch (err) {
    console.error('riff: failed to restore saved project', err);
    return null;
  }
}

/**
 * Download the project as a self-contained .riff JSON file.
 * Audio data is embedded as base64 PCM so the file is fully portable.
 */
export function downloadProjectFile(state: DAWState): void {
  const json = JSON.stringify(serializeProject(state, true));
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.projectName || 'untitled').replace(/[^a-z0-9]/gi, '_')}.riff`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Open a .riff file previously exported with downloadProjectFile().
 * Audio data embedded in the file is decoded without needing IndexedDB.
 */
export async function loadProjectFromFile(file: File): Promise<Partial<DAWState>> {
  const text = await file.text();
  const parsed: RiffProjectFile = JSON.parse(text);
  if (parsed.schema !== SCHEMA_VERSION) {
    throw new Error(`Unsupported .riff schema version: ${parsed.schema}`);
  }
  return hydrateProject(parsed, false);
}

/** Returns true if there is a project saved in localStorage. */
export function hasSavedProject(): boolean {
  return !!localStorage.getItem(LS_KEY);
}
