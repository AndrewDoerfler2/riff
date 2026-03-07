import type { AudioClip, DAWState, Track } from '../types/daw';
import {
  buildClipPluginChain,
  createMasterChainNode,
  createTrackBusNode,
} from './audioNodes';

const EXPORT_SAMPLE_RATE = 44100;
const EXPORT_HEADROOM_SECONDS = 0.25;

function getAudibleTracks(state: DAWState): Track[] {
  const hasSolo = state.tracks.some(track => track.soloed);
  return state.tracks.filter((track) => {
    if (track.muted) return false;
    if (hasSolo && !track.soloed) return false;
    return track.clips.some(clip => clip.audioBuffer && clip.duration > 0);
  });
}

function collectAudibleClips(tracks: Track[]): AudioClip[] {
  return tracks.flatMap(track => track.clips.filter(clip => clip.audioBuffer && clip.duration > 0));
}

function clipEndTime(clip: AudioClip): number {
  return clip.startTime + Math.max(0, clip.duration);
}

function makeSafeFileStem(name: string): string {
  const normalized = (name || 'untitled')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]/gi, '')
    .slice(0, 80);
  return normalized || 'untitled';
}

function clamp01(sample: number): number {
  if (sample > 1) return 1;
  if (sample < -1) return -1;
  return sample;
}

function encodeWav16(buffer: AudioBuffer): Blob {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels));
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);
  let offset = 0;

  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
    offset += value.length;
  };

  const writeU32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };

  const writeU16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };

  writeString('RIFF');
  writeU32(36 + dataBytes);
  writeString('WAVE');
  writeString('fmt ');
  writeU32(16);
  writeU16(1);
  writeU16(channels);
  writeU32(buffer.sampleRate);
  writeU32(buffer.sampleRate * channels * bytesPerSample);
  writeU16(channels * bytesPerSample);
  writeU16(16);
  writeString('data');
  writeU32(dataBytes);

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;
  for (let i = 0; i < frames; i += 1) {
    const l = clamp01(left[i]);
    const l16 = l < 0 ? l * 0x8000 : l * 0x7fff;
    view.setInt16(offset, l16, true);
    offset += 2;

    if (channels > 1) {
      const r = clamp01(right[i]);
      const r16 = r < 0 ? r * 0x8000 : r * 0x7fff;
      view.setInt16(offset, r16, true);
      offset += 2;
    }
  }

  return new Blob([wav], { type: 'audio/wav' });
}

export type ExportProgressCallback = (done: number, total: number, label: string) => void;
export interface CancelToken { cancelled: boolean; }

export interface ProjectMixdown {
  blob: Blob;
  filename: string;
  durationSeconds: number;
}

function getRenderDurationSeconds(tracks: Track[]): number {
  const audibleClips = collectAudibleClips(tracks);
  if (!audibleClips.length) return 0;
  return Math.max(0.1, ...audibleClips.map(clipEndTime));
}

async function renderTracksToBuffer(state: DAWState, tracks: Track[]): Promise<{ rendered: AudioBuffer; durationSeconds: number }> {
  const durationSeconds = getRenderDurationSeconds(tracks);
  if (durationSeconds <= 0) {
    throw new Error('No audible audio clips found to export.');
  }
  const totalFrames = Math.max(
    1,
    Math.ceil((durationSeconds + EXPORT_HEADROOM_SECONDS) * EXPORT_SAMPLE_RATE),
  );

  const ctx = new OfflineAudioContext(2, totalFrames, EXPORT_SAMPLE_RATE);
  const nodeContext = ctx as unknown as AudioContext;
  const master = createMasterChainNode(nodeContext, state.masterVolume, state.masterPlugins);
  const trackBusMap = new Map<string, ReturnType<typeof createTrackBusNode>>();

  const sortedTracks = [
    ...tracks.filter(track => track.type === 'bus'),
    ...tracks.filter(track => track.type !== 'bus'),
  ];

  sortedTracks.forEach((track) => {
    let destination: AudioNode = master.input;
    if (track.type !== 'bus' && track.busRouteId) {
      const busNode = trackBusMap.get(track.busRouteId);
      if (busNode) destination = busNode.sumInput;
    }

    const bus = createTrackBusNode(nodeContext, track, destination);
    trackBusMap.set(track.id, bus);

    track.clips.forEach((clip) => {
      if (!clip.audioBuffer || clip.duration <= 0) return;

      const sourceOffset = Math.max(0, Math.min(clip.offset, Math.max(0, clip.audioBuffer.duration - 0.01)));
      const maxPlayable = Math.max(0, clip.audioBuffer.duration - sourceOffset);
      const playbackDuration = Math.min(clip.duration, maxPlayable);
      if (playbackDuration <= 0) return;

      const source = ctx.createBufferSource();
      source.buffer = clip.audioBuffer;

      const clipGain = ctx.createGain();

      const pluginOut = buildClipPluginChain(nodeContext, track.plugins, bus.sumInput);
      source.connect(clipGain);
      clipGain.connect(pluginOut.input);

      // Apply clip fade-in / fade-out automation
      const fadeIn = clip.fadeIn ?? 0;
      const fadeOut = clip.fadeOut ?? 0;
      const baseGain = clip.gain;
      const startWhen = Math.max(0, clip.startTime);
      if (fadeIn > 0 || fadeOut > 0) {
        clipGain.gain.setValueAtTime(fadeIn > 0 ? 0 : baseGain, startWhen);
        if (fadeIn > 0) {
          clipGain.gain.linearRampToValueAtTime(baseGain, startWhen + fadeIn);
        }
        if (fadeOut > 0) {
          const fadeOutStart = startWhen + playbackDuration - fadeOut;
          clipGain.gain.setValueAtTime(baseGain, Math.max(startWhen, fadeOutStart));
          clipGain.gain.linearRampToValueAtTime(0, startWhen + playbackDuration);
        }
      } else {
        clipGain.gain.value = baseGain;
      }

      source.start(startWhen, sourceOffset, playbackDuration);
      source.onended = () => {
        try { source.disconnect(); } catch {}
        try { clipGain.disconnect(); } catch {}
        pluginOut.cleanup();
      };
    });
  });

  const rendered = await ctx.startRendering();
  trackBusMap.forEach(bus => bus.cleanup());
  master.cleanup();

  return { rendered, durationSeconds };
}

export async function exportProjectMixToWav(
  state: DAWState,
  onProgress?: ExportProgressCallback,
  cancel?: CancelToken,
): Promise<ProjectMixdown> {
  onProgress?.(0, 2, 'Setting up…');
  const audibleTracks = getAudibleTracks(state);
  if (!audibleTracks.length) throw new Error('No audible audio clips found to export.');
  if (cancel?.cancelled) return { blob: new Blob(), filename: '', durationSeconds: 0 };

  onProgress?.(1, 2, 'Rendering…');
  const { rendered, durationSeconds } = await renderTracksToBuffer(state, audibleTracks);

  onProgress?.(2, 2, 'Encoding WAV…');
  return {
    blob: encodeWav16(rendered),
    filename: `${makeSafeFileStem(state.projectName)}_mixdown.wav`,
    durationSeconds,
  };
}

export interface TrackStemExport {
  trackId: string;
  trackName: string;
  blob: Blob;
  filename: string;
  durationSeconds: number;
}

export async function exportProjectTrackStemsToWav(
  state: DAWState,
  onProgress?: ExportProgressCallback,
  cancel?: CancelToken,
): Promise<TrackStemExport[]> {
  const audibleTracks = getAudibleTracks(state).filter(
    track => track.clips.some(clip => clip.audioBuffer && clip.duration > 0),
  );
  if (!audibleTracks.length) {
    throw new Error('No audible tracks with audio clips found to export as stems.');
  }

  const stems: TrackStemExport[] = [];
  const stemPrefix = makeSafeFileStem(state.projectName);
  const usedNames = new Map<string, number>();
  const total = audibleTracks.length;

  for (let i = 0; i < audibleTracks.length; i++) {
    if (cancel?.cancelled) break;
    const track = audibleTracks[i];
    onProgress?.(i, total, `Rendering "${track.name}"…`);

    const { rendered, durationSeconds } = await renderTracksToBuffer(state, [track]);
    if (cancel?.cancelled) break;

    const baseTrackName = makeSafeFileStem(track.name || 'track');
    const seenCount = usedNames.get(baseTrackName) ?? 0;
    usedNames.set(baseTrackName, seenCount + 1);
    const dedupedName = seenCount === 0 ? baseTrackName : `${baseTrackName}_${seenCount + 1}`;

    stems.push({
      trackId: track.id,
      trackName: track.name,
      blob: encodeWav16(rendered),
      filename: `${stemPrefix}_stem_${dedupedName}.wav`,
      durationSeconds,
    });

    onProgress?.(i + 1, total, i + 1 === total ? 'All stems rendered' : `Rendered "${track.name}"`);
  }

  return stems;
}
