// ─── Bounce / Export Renderer ───────────────────────────────────────────────
// Offline render of the full project mix (or per-stem) into 16-bit stereo WAV.
// Uses OfflineAudioContext so no audio plays to speakers during export.

import type { Track, PluginInstance, DAWState } from '../types/daw';
import { buildPluginNodes } from './audioNodes';

// ─── WAV Encoding ─────────────────────────────────────────────────────────────

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/** Encodes an AudioBuffer to a 16-bit PCM WAV ArrayBuffer. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = 2; // always stereo output
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);         // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write interleaved int16 samples; clamp and dither to avoid clipping artefacts
  const L = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(numSamples);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, L[i]));
    const r = Math.max(-1, Math.min(1, R[i]));
    view.setInt16(offset,     l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }
  return out;
}

/** Triggers a browser download of a WAV file. */
export function downloadWav(data: ArrayBuffer, filename: string): void {
  const blob = new Blob([data], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ─── Offline Render Core ──────────────────────────────────────────────────────

const EXPORT_SAMPLE_RATE = 48_000;
const TAIL_SECONDS = 2; // extra time after last clip for reverb/delay tails

/** Returns the end time (seconds) of the last audio clip across all tracks. */
function computeProjectLength(tracks: Track[]): number {
  let max = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.audioBuffer) {
        max = Math.max(max, clip.startTime + clip.duration);
      }
    }
  }
  return Math.max(1, max + TAIL_SECONDS);
}

/**
 * Builds and renders an OfflineAudioContext for the given tracks.
 * If soloTrackId is set, only that track's clips are rendered (stem mode).
 * Master plugins and bus compressor are skipped in stem mode for clean stems.
 */
async function renderOffline(
  tracks: Track[],
  masterPlugins: PluginInstance[],
  masterVolume: number,
  soloTrackId: string | null,
  onProgress: (p: number, label: string) => void,
): Promise<AudioBuffer> {
  const totalLength = computeProjectLength(tracks);
  const numSamples = Math.ceil(totalLength * EXPORT_SAMPLE_RATE);

  onProgress(5, 'Building render graph…');

  const offCtx = new OfflineAudioContext(2, numSamples, EXPORT_SAMPLE_RATE);
  // OfflineAudioContext has the same BaseAudioContext API; plugin factories accept AudioContext
  const ctx = offCtx as unknown as AudioContext;
  const cleanups: Array<() => void> = [];

  // ── Master output chain ───────────────────────────────────────────────────
  // stem mode: unity-gain direct to destination (no master chain)
  let masterInput: AudioNode;

  if (soloTrackId !== null) {
    // Stem: just a pass-through gain so clips can connect
    const passGain = offCtx.createGain();
    passGain.connect(offCtx.destination);
    masterInput = passGain;
  } else {
    // Full mix: plugins → bus compressor → master gain → destination
    const inputGain = offCtx.createGain();
    let currentNode: AudioNode = inputGain;

    masterPlugins.forEach(plugin => {
      if (!plugin.enabled) return;
      const built = buildPluginNodes(ctx, plugin);
      if (!built) return;
      currentNode.connect(built.input);
      currentNode = built.output;
      cleanups.push(built.cleanup);
    });

    const busComp = offCtx.createDynamicsCompressor();
    busComp.ratio.value = 4;
    busComp.threshold.value = -18;
    busComp.attack.value = 0.01;
    busComp.release.value = 0.1;
    busComp.knee.value = 6;
    currentNode.connect(busComp);

    const mgain = offCtx.createGain();
    mgain.gain.value = masterVolume;
    busComp.connect(mgain);
    mgain.connect(offCtx.destination);

    masterInput = inputGain;
  }

  // ── Build bus-type track summing nodes (so regular tracks can route into them) ─
  const busDestMap = new Map<string, AudioNode>(); // trackId → sumNode for bus tracks

  const sortedTracks = [
    ...tracks.filter(t => t.type === 'bus'),
    ...tracks.filter(t => t.type !== 'bus'),
  ];

  // First pass: create bus track routing nodes
  sortedTracks.forEach(track => {
    if (track.type !== 'bus') return;
    if (soloTrackId !== null && track.id !== soloTrackId) return;
    if (track.muted && soloTrackId === null) return;

    const sumInput = offCtx.createGain(); // accepts routed tracks
    const trackGain = offCtx.createGain();
    trackGain.gain.value = track.volume;
    const trackPan = offCtx.createStereoPanner();
    trackPan.pan.value = track.pan;
    sumInput.connect(trackGain);
    trackGain.connect(trackPan);
    trackPan.connect(masterInput);
    busDestMap.set(track.id, sumInput);
  });

  // Second pass: schedule all clips
  onProgress(12, 'Scheduling clips…');

  sortedTracks.forEach(track => {
    if (soloTrackId !== null && track.id !== soloTrackId) return;
    if (track.muted && soloTrackId === null) return;
    if (track.type === 'bus') return; // bus clips handled via routing

    // Resolve output destination for this track
    let trackDest: AudioNode = masterInput;
    if (soloTrackId === null && track.busRouteId) {
      const busNode = busDestMap.get(track.busRouteId);
      if (busNode) trackDest = busNode;
    }

    // Per-track: volume + pan
    const trackGain = offCtx.createGain();
    trackGain.gain.value = track.volume;
    const trackPan = offCtx.createStereoPanner();
    trackPan.pan.value = track.pan;
    trackGain.connect(trackPan);
    trackPan.connect(trackDest);

    // Per-clip: source → clipGain → [plugin chain] → trackGain
    track.clips.forEach(clip => {
      if (!clip.audioBuffer) return;

      const src = offCtx.createBufferSource();
      src.buffer = clip.audioBuffer;

      const clipGain = offCtx.createGain();
      clipGain.gain.value = clip.gain;
      src.connect(clipGain);

      // Build track plugin chain inline (mirrors buildClipPluginChain)
      let pluginNode: AudioNode = clipGain;
      track.plugins.forEach(plugin => {
        if (!plugin.enabled) return;
        const built = buildPluginNodes(ctx, plugin);
        if (!built) return;
        pluginNode.connect(built.input);
        pluginNode = built.output;
        cleanups.push(built.cleanup);
      });
      pluginNode.connect(trackGain);

      // Schedule with clip's offset and duration
      const when = clip.startTime; // OfflineAudioContext time = project time
      const bufOffset = Math.max(0, clip.offset);
      const dur = Math.max(0.001, clip.duration);
      src.start(when, bufOffset, dur);
    });
  });

  onProgress(20, 'Rendering (this may take a moment)…');

  const rendered = await offCtx.startRendering();

  cleanups.forEach(fn => { try { fn(); } catch {} });

  return rendered;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Bounce the full project mix to 16-bit 48 kHz stereo WAV.
 * Applies all track plugins, bus routing, master plugins, and master compressor.
 */
export async function bounceProjectToWav(
  state: DAWState,
  onProgress: (p: number, label: string) => void,
): Promise<ArrayBuffer> {
  const buffer = await renderOffline(
    state.tracks,
    state.masterPlugins,
    state.masterVolume,
    null,
    onProgress,
  );
  onProgress(88, 'Encoding WAV…');
  const wav = encodeWav(buffer);
  onProgress(100, 'Complete');
  return wav;
}

/**
 * Bounce a single track to 16-bit 48 kHz stereo WAV (dry stem, no master chain).
 * The stem has track volume/pan and track plugins applied but no master processing.
 */
export async function bounceStemToWav(
  track: Track,
  state: DAWState,
  onProgress: (p: number, label: string) => void,
): Promise<ArrayBuffer> {
  const buffer = await renderOffline(
    state.tracks,
    [],     // no master plugins for stems
    1.0,    // unity master gain for stems
    track.id,
    onProgress,
  );
  onProgress(88, 'Encoding WAV…');
  const wav = encodeWav(buffer);
  onProgress(100, 'Complete');
  return wav;
}

/** Returns true if the project has at least one audio clip to export. */
export function projectHasAudio(tracks: Track[]): boolean {
  return tracks.some(t => t.clips.some(c => c.audioBuffer !== null));
}
