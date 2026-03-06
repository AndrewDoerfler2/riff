import React, {
  createContext, useContext, useReducer, useCallback, useEffect,
  useRef, type ReactNode,
} from 'react';
import type {
  DAWState, DAWAction, Track, TrackType, AudioClip, PluginInstance, PluginType,
} from '../types/daw';
import {
  getRmsLevel,
  createTrackBusNode, syncTrackBusNode,
  createMasterChainNode, buildClipPluginChain,
  type TrackBusNode, type MasterChainNode, type PlaybackHandle,
} from '../lib/audioNodes';
import { computePeaks, readFileAsArrayBuffer } from '../lib/audioUtils';
import {
  makePlugin, makeTrack, dawReducer, initialDAWState,
} from './dawReducer';
export { PLUGIN_DEFINITIONS } from './dawReducer';

// ─── Context ───────────────────────────────────────────────────────────────────

interface DAWContextValue {
  state: DAWState;
  dispatch: React.Dispatch<DAWAction>;
  // Helpers
  makePlugin: (type: PluginType) => PluginInstance;
  createTrack: (type: TrackType) => Track;
}

const DAWContext = createContext<DAWContextValue | null>(null);

export function DAWProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dawReducer, initialDAWState);
  const value: DAWContextValue = { state, dispatch, makePlugin, createTrack: makeTrack };
  return <DAWContext.Provider value={value}>{children}</DAWContext.Provider>;
}

export function useDAW() {
  const ctx = useContext(DAWContext);
  if (!ctx) throw new Error('useDAW must be used within DAWProvider');
  return ctx;
}

// ─── Audio Engine Context ───────────────────────────────────────────────────────
// Provides a single shared audio engine instance across all components.

const AudioEngineContext = createContext<AudioEngineReturn | null>(null);

export function AudioEngineProvider({ children }: { children: ReactNode }) {
  const engine = useAudioEngine();
  return (
    <AudioEngineContext.Provider value={engine}>
      {children}
    </AudioEngineContext.Provider>
  );
}

export function useAudioEngineCtx(): AudioEngineReturn {
  const ctx = useContext(AudioEngineContext);
  if (!ctx) throw new Error('useAudioEngineCtx must be used within AudioEngineProvider');
  return ctx;
}

// ─── Audio Engine Hook ─────────────────────────────────────────────────────────

interface AudioEngineReturn {
  startPlayback: (fromTime: number, tracks: Track[]) => void;
  stopPlayback: () => void;
  startRecording: (armedTrackIds: string[]) => Promise<void>;
  stopRecording: () => Promise<Map<string, AudioClip>>;
  createClipFromFile: (
    file: File,
    options?: { name?: string; startTime?: number; color?: string; onProgress?: (progress: number, stage: string) => void }
  ) => Promise<AudioClip>;
  currentAudioTime: () => number;
  isEngineReady: boolean;
  availableInputs: MediaDeviceInfo[];
  selectedInputId: string;
  setSelectedInputId: (deviceId: string) => void;
  refreshInputs: () => Promise<void>;
  isRecordingActive: () => boolean;
  // analyserRef: ref for low-level canvas drawing (no re-render)
  analyserRef: React.RefObject<AnalyserNode | null>;
  // analyserNode: React state — triggers re-render when mic connects/disconnects
  analyserNode: AnalyserNode | null;
  // Meter level reads (call from rAF loop)
  getTrackLevel: (trackId: string, mode: 'pre' | 'post') => [number, number];
  getMasterLevel: () => [number, number];
}

export function useAudioEngine(): AudioEngineReturn {
  const { state } = useDAW();
  const { tracks } = state;
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingActiveRef = useRef(false);
  const chunksRef = useRef<Map<string, Blob[]>>(new Map());
  const sourceNodesRef = useRef<PlaybackHandle[]>([]);
  const trackBusMapRef = useRef<Map<string, TrackBusNode>>(new Map());
  const masterChainRef = useRef<MasterChainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const projectStartRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [isEngineReady, setIsEngineReady] = React.useState(false);
  const [analyserNode, setAnalyserNode] = React.useState<AnalyserNode | null>(null);
  const [availableInputs, setAvailableInputs] = React.useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputIdState] = React.useState('default');

  const refreshInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAvailableInputs([]);
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    setAvailableInputs(audioInputs);

    setSelectedInputIdState(current => {
      if (!audioInputs.length) return 'default';
      if (current === 'default') return current;
      return audioInputs.some(device => device.deviceId === current)
        ? current
        : (audioInputs[0]?.deviceId ?? 'default');
    });
  }, []);

  const setSelectedInputId = useCallback((deviceId: string) => {
    setSelectedInputIdState(deviceId);
  }, []);

  useEffect(() => {
    refreshInputs().catch(err => {
      console.error('Failed to enumerate audio inputs:', err);
    });

    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      refreshInputs().catch(err => {
        console.error('Failed to refresh audio inputs:', err);
      });
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshInputs]);

  const getCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      setIsEngineReady(true);
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    sourceNodesRef.current.forEach(({ source, cleanup }) => {
      try { source.stop(); } catch {}
      cleanup();
    });
    sourceNodesRef.current = [];
    trackBusMapRef.current.forEach(bus => bus.cleanup());
    trackBusMapRef.current.clear();
    masterChainRef.current?.cleanup();
    masterChainRef.current = null;
  }, []);

  const startPlayback = useCallback((fromTime: number, tracks: Track[]) => {
    const ctx = getCtx();
    stopPlayback();
    startTimeRef.current = ctx.currentTime - fromTime;
    projectStartRef.current = fromTime;

    // 1. Create master chain (compressor + analysers → destination)
    const masterGainVal = state.masterVolume;
    const master = createMasterChainNode(ctx, masterGainVal, state.masterPlugins);
    masterChainRef.current = master;

    // 2. Process bus tracks first (so regular tracks can route into them)
    const sortedTracks = [
      ...tracks.filter(t => t.type === 'bus'),
      ...tracks.filter(t => t.type !== 'bus'),
    ];

    sortedTracks.forEach(track => {
      if (track.muted) return;

      // Determine audio output destination
      let dest: AudioNode = master.input;
      if (track.type !== 'bus' && track.busRouteId) {
        const busNode = trackBusMapRef.current.get(track.busRouteId);
        if (busNode) dest = busNode.sumInput;
      }

      // Create per-track bus (summing node + gain/pan + stereo analysers)
      const bus = createTrackBusNode(ctx, track, dest);
      trackBusMapRef.current.set(track.id, bus);

      // Schedule clips — each gets its own plugin chain feeding the bus
      track.clips.forEach(clip => {
        if (!clip.audioBuffer) return;
        const clipOffsetAtPlayhead = Math.max(0, fromTime - clip.startTime);
        if (clipOffsetAtPlayhead >= clip.duration) return;

        const src = ctx.createBufferSource();
        src.buffer = clip.audioBuffer;
        const clipGain = ctx.createGain();
        clipGain.gain.value = clip.gain;

        const pluginOut = buildClipPluginChain(ctx, track.plugins, bus.sumInput);
        src.connect(clipGain);
        clipGain.connect(pluginOut.input);

        const when = Math.max(0, ctx.currentTime + (clip.startTime - fromTime));
        const sourceOffset = clip.offset + clipOffsetAtPlayhead;
        const playbackDuration = Math.max(0.01, clip.duration - clipOffsetAtPlayhead);
        src.start(when, sourceOffset, playbackDuration);

        const cleanup = () => {
          try { src.disconnect(); } catch {}
          try { clipGain.disconnect(); } catch {}
          pluginOut.cleanup();
        };
        src.onended = cleanup;
        sourceNodesRef.current.push({ source: src, cleanup });
      });
    });
  }, [getCtx, stopPlayback, state.masterVolume, state.masterPlugins]);

  useEffect(() => {
    if (!trackBusMapRef.current.size) return;
    tracks.forEach(track => {
      const bus = trackBusMapRef.current.get(track.id);
      if (bus) syncTrackBusNode(bus, track);
    });
    // Sync master volume
    if (masterChainRef.current) {
      masterChainRef.current.masterGain.gain.value = state.masterVolume;
    }
  }, [tracks, state.masterVolume]);

  const startRecording = useCallback(async (armedTrackIds: string[]) => {
    if (!armedTrackIds.length || recordingActiveRef.current) return;
    try {
      const ctx = getCtx();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedInputId && selectedInputId !== 'default'
          ? { deviceId: { exact: selectedInputId } }
          : true,
        video: false,
      });
      streamRef.current = stream;
      recordingActiveRef.current = true;

      refreshInputs().catch(err => {
        console.error('Failed to refresh audio inputs after stream start:', err);
      });

      // Set up AnalyserNode for live waveform visualization
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      const micSource = ctx.createMediaStreamSource(stream);
      micSource.connect(analyser);
      // Note: don't connect analyser to destination to avoid feedback
      analyserRef.current = analyser;
      setAnalyserNode(analyser);  // triggers re-render so Timeline shows live waveform

      const chunks: Blob[] = [];
      chunksRef.current = new Map(armedTrackIds.map(id => [id, chunks]));
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(100);
      recorderRef.current = recorder;
    } catch (err) {
      recordingActiveRef.current = false;
      console.error('Microphone access denied:', err);
      throw err;
    }
  }, [getCtx, refreshInputs, selectedInputId]);

  const stopRecording = useCallback(async (): Promise<Map<string, AudioClip>> => {
    const result = new Map<string, AudioClip>();
    if (!recorderRef.current) return result;

    return new Promise(resolve => {
      const recorder = recorderRef.current!;
      recorder.onstop = async () => {
        const ctx = getCtx();
        for (const [trackId, chunks] of chunksRef.current) {
          if (!chunks.length) continue;
          try {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            const peaks = computePeaks(audioBuffer, 200);
            const clip: AudioClip = {
              id: `clip_${Date.now()}_${trackId}`,
              name: 'Recording',
              startTime: projectStartRef.current,
              duration: audioBuffer.duration,
              audioBuffer,
              waveformPeaks: peaks,
              color: '#30d158',
              gain: 1,
              fadeIn: 0,
              fadeOut: 0,
              offset: 0,
            };
            result.set(trackId, clip);
          } catch (err) {
            console.error('Failed to decode audio:', err);
          }
        }
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        recordingActiveRef.current = false;
        analyserRef.current = null;
        setAnalyserNode(null);  // triggers re-render so live waveform disappears
        resolve(result);
      };
      recorder.stop();
    });
  }, [getCtx]);

  const currentAudioTime = useCallback((): number => {
    if (!audioCtxRef.current) return 0;
    return audioCtxRef.current.currentTime - startTimeRef.current;
  }, []);

  const createClipFromFile = useCallback(async (
    file: File,
    options: { name?: string; startTime?: number; color?: string; onProgress?: (progress: number, stage: string) => void } = {},
  ): Promise<AudioClip> => {
    const ctx = getCtx();
    options.onProgress?.(0, 'Preparing file');
    const arrayBuffer = await readFileAsArrayBuffer(file, (progress) => {
      options.onProgress?.(progress * 0.7, 'Reading file');
    });
    options.onProgress?.(78, 'Decoding audio');
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    options.onProgress?.(92, 'Generating waveform');
    const peaks = computePeaks(audioBuffer, 200);
    options.onProgress?.(100, 'Complete');

    return {
      id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: options.name ?? file.name.replace(/\.[^/.]+$/, ''),
      startTime: options.startTime ?? 0,
      duration: audioBuffer.duration,
      audioBuffer,
      waveformPeaks: peaks,
      color: options.color ?? '#64d2ff',
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      offset: 0,
    };
  }, [getCtx]);

  const isRecordingActive = useCallback(() => recordingActiveRef.current, []);

  const getTrackLevel = useCallback((trackId: string, mode: 'pre' | 'post'): [number, number] => {
    const bus = trackBusMapRef.current.get(trackId);
    if (!bus) return [0, 0];
    const [la, ra] = mode === 'pre'
      ? [bus.preAnalyserL, bus.preAnalyserR]
      : [bus.postAnalyserL, bus.postAnalyserR];
    return [getRmsLevel(la), getRmsLevel(ra)];
  }, []);

  const getMasterLevel = useCallback((): [number, number] => {
    const m = masterChainRef.current;
    if (!m) return [0, 0];
    return [getRmsLevel(m.analyserL), getRmsLevel(m.analyserR)];
  }, []);

  return {
    startPlayback,
    stopPlayback,
    startRecording,
    stopRecording,
    createClipFromFile,
    currentAudioTime,
    isEngineReady,
    availableInputs,
    selectedInputId,
    setSelectedInputId,
    refreshInputs,
    isRecordingActive,
    analyserRef,
    analyserNode,
    getTrackLevel,
    getMasterLevel,
  };
}

// Re-export pure utilities so existing imports continue to work.
export { formatTime, formatClock } from '../lib/audioUtils';
