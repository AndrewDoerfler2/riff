// ─── Core DAW Types ───────────────────────────────────────────────────────────

export type TrackType = 'audio' | 'midi' | 'video' | 'bus';

export type Genre =
  | 'jazz' | 'blues' | 'rock' | 'pop' | 'hip-hop'
  | 'electronic' | 'classical' | 'country' | 'funk'
  | 'latin' | 'reggae' | 'metal' | 'soul' | 'rnb';

export type Instrument =
  | 'drums' | 'bass' | 'piano' | 'guitar-acoustic' | 'guitar-electric'
  | 'saxophone' | 'trumpet' | 'trombone' | 'violin' | 'cello'
  | 'synth-lead' | 'synth-pad' | 'strings' | 'choir' | 'organ'
  | 'flute' | 'clarinet' | 'vibraphone' | 'harp' | 'harmonica';

export type TimeSignature = '4/4' | '3/4' | '6/8' | '5/4' | '7/8';

export type LoudnessPreset = 'streaming' | 'podcast' | 'club';

export interface NoteEvent {
  midi: number;
  startBeats: number;
  durationBeats: number;
  velocity: number;
}

export interface DrumHitEvent {
  kind: 'kick' | 'snare' | 'hat' | 'openHat';
  startBeats: number;
  velocity: number;
}

export type ChordQuality =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'sus2'
  | 'sus4'
  | 'major7'
  | 'minor7'
  | 'dominant7';

export interface AudioClip {
  id: string;
  name: string;
  startTime: number;   // seconds from project start
  duration: number;    // seconds
  audioBuffer: AudioBuffer | null;
  waveformPeaks: number[];  // normalized 0–1 peak data for waveform display
  color: string;
  gain: number;        // 0–2
  fadeIn: number;      // seconds
  fadeOut: number;     // seconds
  offset: number;      // offset within original recording
  midiNotes?: NoteEvent[];
  drumHits?: DrumHitEvent[];
  aiLink?: {
    generationId: string;
    instrument: Instrument;
    sourceLabel: 'AI' | 'Local';
    role: 'audio' | 'midi';
    linkedTrackId?: string;
    linkedClipId?: string;
    autoUpdateLinkedAudio?: boolean;
    bpm: number;
    key: string;
    timeSignature: TimeSignature;
    genre: Genre;
  };
}

export interface VideoClip {
  id: string;
  name: string;
  startTime: number;   // seconds from project start (clip position on timeline)
  duration: number;    // full source media duration in seconds
  src: string;
  thumbnailUrl: string;
  color: string;
  audioWaveformPeaks: number[]; // normalized 0–1 embedded-audio peaks for timeline display
  trimIn: number;      // seconds to skip from source start (0 = no trim)
  trimOut: number;     // seconds to cut from source end (0 = no trim)
  opacity: number;     // 0–1 blend/PiP opacity (1 = fully opaque)
  volume: number;      // 0–1 gain for embedded audio track (1 = full)
  layoutX: number;     // 0–1 horizontal PiP anchor in preview area
  layoutY: number;     // 0–1 vertical PiP anchor in preview area
  layoutScale: number; // 0.2–2 PiP scale multiplier
  textOverlays: VideoTextOverlay[];
}

export interface VideoTextOverlay {
  id: string;
  text: string;
  startOffset: number; // seconds from visible clip start
  endOffset: number;   // seconds from visible clip start
  x: number;           // 0–1 horizontal anchor in preview
  y: number;           // 0–1 vertical anchor in preview
  fontSize: number;    // 12–72 px
  opacity: number;     // 0–1 text opacity
  bgOpacity: number;   // 0–1 subtitle background opacity
}

// ─── Plugin Types ──────────────────────────────────────────────────────────────

export type PluginType =
  | 'eq' | 'compressor' | 'reverb' | 'delay'
  | 'distortion' | 'chorus' | 'limiter' | 'gain' | 'autopan' | 'humRemover';

export interface PluginParameter {
  id: string;
  name: string;
  type: 'knob' | 'slider' | 'toggle';
  min: number;
  max: number;
  value: number;
  defaultValue: number;
  unit?: string;
  curve?: 'linear' | 'log';
}

export interface PluginDefinition {
  type: PluginType;
  name: string;
  color: string;
  parameters: Omit<PluginParameter, 'value'>[];
}

export interface PluginInstance {
  id: string;
  type: PluginType;
  name: string;
  enabled: boolean;
  parameters: Record<string, number>;
}

export interface PluginPreset {
  id: string;
  name: string;
  pluginType: PluginType;
  parameters: Record<string, number>;
}

export interface AutomationPoint {
  time: number;
  value: number;
}

export type AutomationTarget =
  | { kind: 'trackVolume' }
  | { kind: 'trackPan' }
  | { kind: 'pluginParam'; pluginId: string; parameterId: string };

export interface AutomationLane {
  id: string;
  target: AutomationTarget;
  points: AutomationPoint[];
}

// ─── Track ─────────────────────────────────────────────────────────────────────

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  armed: boolean;
  muted: boolean;
  soloed: boolean;
  volume: number;   // 0–1
  pan: number;      // -1 to 1
  clips: AudioClip[];
  videoClips: VideoClip[];
  plugins: PluginInstance[];
  automationLanes: AutomationLane[];
  automationLaneExpanded: boolean;
  height: number;
  inputMonitor: boolean;
  busRouteId?: string;       // undefined = route to master
  meterMode: 'pre' | 'post'; // pre-fader or post-fader metering
}

// ─── AI Config ──────────────────────────────────────────────────────────────────

export interface AIConfig {
  genre: Genre;
  bpm: number;
  key: string;
  timeSignature: TimeSignature;
  bars: number;
  instruments: Instrument[];
  useAiArrangement: boolean;
  useLocalPatterns: boolean;
  isGenerating: boolean;
  isRecordingSnippet: boolean;
  snippetDuration: number;
  progress: number;  // 0-100 generation progress
}

// ─── DAW State ─────────────────────────────────────────────────────────────────

export type ActivePanel = 'ai' | 'plugins' | 'mixer' | 'video' | 'settings' | null;

export interface DAWState {
  // Project
  projectName: string;

  // Transport
  isPlaying: boolean;
  isRecording: boolean;
  currentTime: number;
  bpm: number;
  timeSignature: TimeSignature;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  metronomeEnabled: boolean;
  snapEnabled: boolean;
  preRollBars: number;
  overdubEnabled: boolean;

  // Tracks
  tracks: Track[];
  selectedTrackId: string | null;
  masterVolume: number;
  masterPan: number;

  // Timeline view
  zoom: number;         // pixels per second
  scrollLeft: number;
  viewDuration: number; // seconds visible in timeline
  autoScroll: boolean;  // keep playhead in view during playback/recording

  // UI Panels
  activePanel: ActivePanel;
  pluginRackTrackId: string | null;

  // Master bus
  masterPlugins: PluginInstance[];
  pluginPresets: Partial<Record<PluginType, PluginPreset[]>>;
  loudnessPreset: LoudnessPreset | null;

  // AI
  aiConfig: AIConfig;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

export type DAWAction =
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_PLAYING'; payload: boolean }
  | { type: 'SET_RECORDING'; payload: boolean }
  | { type: 'SET_CURRENT_TIME'; payload: number }
  | { type: 'SET_BPM'; payload: number }
  | { type: 'SET_TIME_SIGNATURE'; payload: TimeSignature }
  | { type: 'TOGGLE_LOOP' }
  | { type: 'SET_LOOP_RANGE'; payload: { start: number; end: number } }
  | { type: 'TOGGLE_METRONOME' }
  | { type: 'TOGGLE_SNAP' }
  | { type: 'SET_PRE_ROLL_BARS'; payload: number }
  | { type: 'TOGGLE_OVERDUB' }
  | { type: 'TOGGLE_AUTO_SCROLL' }
  | { type: 'ADD_TRACK'; payload: TrackType }
  | { type: 'ADD_TRACK_WITH_DATA'; payload: Track }
  | { type: 'MOVE_TRACK'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'REMOVE_TRACK'; payload: string }
  | { type: 'UPDATE_TRACK'; payload: { id: string; updates: Partial<Track> } }
  | { type: 'ARM_TRACK'; payload: { id: string; armed: boolean } }
  | { type: 'MUTE_TRACK'; payload: { id: string; muted: boolean } }
  | { type: 'SOLO_TRACK'; payload: { id: string; soloed: boolean } }
  | { type: 'SELECT_TRACK'; payload: string | null }
  | { type: 'SET_MASTER_VOLUME'; payload: number }
  | { type: 'SET_MASTER_PAN'; payload: number }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SET_SCROLL_LEFT'; payload: number }
  | { type: 'SET_ACTIVE_PANEL'; payload: ActivePanel }
  | { type: 'SET_PLUGIN_RACK_TRACK'; payload: string | null }
  | { type: 'ADD_CLIP'; payload: { trackId: string; clip: AudioClip } }
  | { type: 'ADD_MIDI_NOTE'; payload: { trackId: string; clipId: string; note: NoteEvent } }
  | { type: 'UPDATE_MIDI_NOTE'; payload: { trackId: string; clipId: string; noteIndex: number; updates: Partial<NoteEvent> } }
  | { type: 'REMOVE_MIDI_NOTE'; payload: { trackId: string; clipId: string; noteIndex: number } }
  | { type: 'QUANTIZE_MIDI_CLIP'; payload: { trackId: string; clipId: string; gridBeats: number; swing: number } }
  | { type: 'NUDGE_MIDI_CLIP'; payload: { trackId: string; clipId: string; deltaBeats: number } }
  | { type: 'REPLACE_MIDI_CHORD'; payload: { trackId: string; clipId: string; atBeat: number; root: string; quality: ChordQuality } }
  | { type: 'UPDATE_CLIP'; payload: { trackId: string; clipId: string; updates: Partial<AudioClip> } }
  | { type: 'REMOVE_CLIP'; payload: { trackId: string; clipId: string } }
  | { type: 'ADD_PLUGIN'; payload: { trackId: string; plugin: PluginInstance } }
  | { type: 'REMOVE_PLUGIN'; payload: { trackId: string; pluginId: string } }
  | { type: 'UPDATE_PLUGIN'; payload: { trackId: string; pluginId: string; updates: Partial<PluginInstance> } }
  | { type: 'REORDER_PLUGIN'; payload: { trackId: string; fromIndex: number; toIndex: number } }
  | { type: 'SAVE_PLUGIN_PRESET'; payload: { pluginType: PluginType; name: string; parameters: Record<string, number> } }
  | { type: 'DELETE_PLUGIN_PRESET'; payload: { pluginType: PluginType; presetId: string } }
  | { type: 'TOGGLE_TRACK_AUTOMATION_LANES'; payload: { trackId: string } }
  | { type: 'ADD_AUTOMATION_LANE'; payload: { trackId: string; target: AutomationTarget } }
  | { type: 'REMOVE_AUTOMATION_LANE'; payload: { trackId: string; laneId: string } }
  | { type: 'UPSERT_AUTOMATION_POINT'; payload: { trackId: string; laneId: string; pointId?: string; time: number; value: number } }
  | { type: 'UPDATE_AUTOMATION_POINT'; payload: { trackId: string; laneId: string; pointIndex: number; time: number; value: number } }
  | { type: 'REMOVE_AUTOMATION_POINT'; payload: { trackId: string; laneId: string; pointIndex: number } }
  | { type: 'REORDER_MASTER_PLUGIN'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'UPDATE_AI_CONFIG'; payload: Partial<AIConfig> }
  | { type: 'TOGGLE_INSTRUMENT'; payload: Instrument }
  | { type: 'SET_PROJECT_NAME'; payload: string }
  | { type: 'LOAD_PROJECT'; payload: Partial<DAWState> }
  | { type: 'SET_TRACK_METER_MODE'; payload: { id: string; mode: 'pre' | 'post' } }
  | { type: 'SET_TRACK_BUS_ROUTE'; payload: { id: string; busRouteId: string | undefined } }
  | { type: 'ADD_MASTER_PLUGIN'; payload: PluginInstance }
  | { type: 'REMOVE_MASTER_PLUGIN'; payload: string }
  | { type: 'UPDATE_MASTER_PLUGIN'; payload: { pluginId: string; updates: Partial<PluginInstance> } }
  | { type: 'APPLY_LOUDNESS_PRESET'; payload: { preset: LoudnessPreset; compressor: PluginInstance; limiter: PluginInstance } }
  | { type: 'CLEAR_LOUDNESS_PRESET' }
  | { type: 'SPLIT_CLIP'; payload: { trackId: string; clipId: string; splitTime: number } }
  | { type: 'ADD_VIDEO_CLIP'; payload: { trackId: string; clip: VideoClip } }
  | { type: 'REMOVE_VIDEO_CLIP'; payload: { trackId: string; clipId: string } }
  | { type: 'UPDATE_VIDEO_CLIP'; payload: { trackId: string; clipId: string; updates: Partial<VideoClip> } }
  | { type: 'MOVE_VIDEO_CLIP'; payload: { trackId: string; clipId: string; startTime: number } }
  | { type: 'SPLIT_VIDEO_CLIP'; payload: { trackId: string; clipId: string; splitTime: number } }
  | { type: 'ADD_VIDEO_TEXT_OVERLAY'; payload: { trackId: string; clipId: string; overlay: VideoTextOverlay } }
  | {
    type: 'UPDATE_VIDEO_TEXT_OVERLAY';
    payload: { trackId: string; clipId: string; overlayId: string; updates: Partial<VideoTextOverlay> };
  }
  | { type: 'REMOVE_VIDEO_TEXT_OVERLAY'; payload: { trackId: string; clipId: string; overlayId: string } };
