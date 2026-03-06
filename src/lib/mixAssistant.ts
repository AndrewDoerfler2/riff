import type { Track, PluginInstance, LoudnessPreset } from '../types/daw';

// ─── EQ Analysis Types ────────────────────────────────────────────────────────

export type EqProblemKind = 'mud' | 'boxiness' | 'harshness' | 'sibilance' | 'rumble';

export interface EqBandSuggestion {
  label: string;
  freq: number;
  gainDb: number;
  q: number;
  kind: EqProblemKind;
  severity: number;   // 0–1
  confidence: number; // 0–1
  reason: string;
}

export interface EqTrackProposal {
  trackId: string;
  trackName: string;
  role: MixRole;
  bands: EqBandSuggestion[];
  pluginParams: Record<string, number>;
}

export interface EqAnalysisReport {
  generatedAt: number;
  trackProposals: EqTrackProposal[];
}

// ─── Masking Analysis Types ───────────────────────────────────────────────────

export type MaskingBandKind = 'sub' | 'low' | 'mid' | 'presence' | 'air';

export interface MaskingConflict {
  id: string;
  band: MaskingBandKind;
  bandLabel: string;
  centerHz: number;
  severity: number;   // 0–1
  confidence: number; // 0–1
  trackAId: string;
  trackAName: string;
  trackARole: MixRole;
  trackBId: string;
  trackBName: string;
  trackBRole: MixRole;
  protectedTrackId: string;
  suggestedCutTrackId: string;
  suggestedCut: {
    freq: number;
    gainDb: number;
    q: number;
  };
  reason: string;
  recommendation: string;
}

export interface MaskingAnalysisReport {
  generatedAt: number;
  conflicts: MaskingConflict[];
}

// ─── Gain Analysis Types ──────────────────────────────────────────────────────

export interface MixTrackProposal {
  trackId: string;
  trackName: string;
  role: MixRole;
  currentVolume: number;
  suggestedVolume: number;
  peakDbfs: number;
  estimatedLufs: number;
  targetLufs: number;
  deltaDb: number;
  confidence: number;
  reason: string;
}

export interface MixAnalysisReport {
  generatedAt: number;
  trackProposals: MixTrackProposal[];
  masterPeakDbfs: number;
  masterEstimatedLufs: number;
}

type MixRole = 'drums' | 'bass' | 'vocal' | 'lead' | 'harmony' | 'fx' | 'instrumental';
type DynamicsRole = MixRole | 'bus' | 'master';
export type AutoBusGroup = 'drums' | 'vocal' | 'music';

type DynamicsPluginType = Extract<PluginInstance['type'], 'compressor' | 'limiter'>;

interface DynamicsPluginSuggestion {
  type: DynamicsPluginType;
  params: Record<string, number>;
  reason: string;
}

export interface DynamicsTrackProposal {
  trackId: string;
  trackName: string;
  role: Exclude<DynamicsRole, 'master'>;
  intensity: number;
  confidence: number;
  plugins: DynamicsPluginSuggestion[];
}

export interface DynamicsAnalysisReport {
  generatedAt: number;
  trackProposals: DynamicsTrackProposal[];
  masterProposal: {
    role: 'master';
    confidence: number;
    estimatedPeakDbfs: number;
    plugins: DynamicsPluginSuggestion[];
    reason: string;
  };
}

const TARGET_LUFS_BY_ROLE: Record<MixRole, number> = {
  drums: -16,
  bass: -18,
  vocal: -16,
  lead: -18,
  harmony: -20,
  fx: -24,
  instrumental: -19,
};

const MIN_LINEAR = 1e-5;
const MASTER_TARGET_PEAK_DBFS = -6;

interface MaskingBandSpec {
  kind: MaskingBandKind;
  label: string;
  loHz: number;
  hiHz: number;
  centerHz: number;
}

const MASKING_BANDS: MaskingBandSpec[] = [
  { kind: 'sub', label: 'Sub', loHz: 35, hiHz: 90, centerHz: 60 },
  { kind: 'low', label: 'Low', loHz: 90, hiHz: 260, centerHz: 170 },
  { kind: 'mid', label: 'Mid', loHz: 260, hiHz: 1600, centerHz: 800 },
  { kind: 'presence', label: 'Presence', loHz: 1600, hiHz: 5000, centerHz: 3000 },
  { kind: 'air', label: 'Air', loHz: 5000, hiHz: 12000, centerHz: 8500 },
];

const ROLE_BAND_PRIORITY: Record<MaskingBandKind, Record<MixRole, number>> = {
  sub: { drums: 1, bass: 5, vocal: 0, lead: 0, harmony: 0, fx: 0, instrumental: 1 },
  low: { drums: 3, bass: 5, vocal: 1, lead: 1, harmony: 2, fx: 1, instrumental: 2 },
  mid: { drums: 1, bass: 1, vocal: 3, lead: 3, harmony: 4, fx: 2, instrumental: 3 },
  presence: { drums: 2, bass: 0, vocal: 5, lead: 4, harmony: 3, fx: 2, instrumental: 3 },
  air: { drums: 3, bass: 0, vocal: 4, lead: 4, harmony: 2, fx: 3, instrumental: 2 },
};

interface MaskingTrackProfile {
  id: string;
  name: string;
  role: MixRole;
  sampleRate: number;
  clipCount: number;
  bandLevelsDb: Record<MaskingBandKind, number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function linearToDb(value: number): number {
  return 20 * Math.log10(Math.max(value, MIN_LINEAR));
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

function inferRole(track: Track): MixRole {
  const name = track.name.toLowerCase();
  if (name.includes('drum') || name.includes('kick') || name.includes('snare') || name.includes('perc')) return 'drums';
  if (name.includes('bass') || name.includes('sub')) return 'bass';
  if (name.includes('vocal') || name.includes('vox')) return 'vocal';
  if (name.includes('lead') || name.includes('solo')) return 'lead';
  if (name.includes('pad') || name.includes('chord') || name.includes('piano') || name.includes('guitar') || name.includes('string')) return 'harmony';
  if (name.includes('fx') || name.includes('noise') || name.includes('atmo')) return 'fx';
  return 'instrumental';
}

export function inferAutoBusGroup(track: Track): AutoBusGroup | null {
  if (track.type === 'bus' || track.type === 'video') return null;
  const name = track.name.toLowerCase();
  if (
    name.includes('drum')
    || name.includes('kick')
    || name.includes('snare')
    || name.includes('perc')
    || name.includes('hat')
    || name.includes('808')
  ) return 'drums';
  if (
    name.includes('vocal')
    || name.includes('vox')
    || name.includes('singer')
    || name.includes('choir')
    || name.includes('adlib')
  ) return 'vocal';
  return 'music';
}

export function getAutoBusLabel(group: AutoBusGroup): string {
  const labels: Record<AutoBusGroup, string> = {
    drums: 'Drum Bus',
    vocal: 'Vocal Bus',
    music: 'Music Bus',
  };
  return labels[group];
}

function inferDynamicsRole(track: Track): Exclude<DynamicsRole, 'master'> {
  if (track.type === 'bus') return 'bus';
  return inferRole(track);
}

function analyzeBufferEnergy(buffer: AudioBuffer): { peak: number; rms: number } {
  let peak = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  const step = Math.max(1, Math.floor(buffer.length / 12000));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += step) {
      const sample = data[i] ?? 0;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  return { peak, rms };
}

function estimateIntensity(peak: number, rms: number): number {
  const crestDb = linearToDb(peak) - linearToDb(rms);
  const normalizedCrest = clamp((crestDb - 4) / 16, 0, 1);
  const normalizedRms = clamp((linearToDb(rms) + 36) / 30, 0, 1);
  return clamp(0.65 * normalizedRms + 0.35 * (1 - normalizedCrest), 0, 1);
}

function buildDynamicsSuggestions(role: DynamicsRole, intensity: number): DynamicsPluginSuggestion[] {
  if (role === 'master') {
    return [
      {
        type: 'compressor',
        params: {
          threshold: -22 + intensity * 6,
          ratio: 2 + intensity * 1.2,
          attack: 12,
          release: 110,
          knee: 6,
          makeupGain: 0,
        },
        reason: 'Gentle glue compression to stabilize overall mix dynamics',
      },
      {
        type: 'limiter',
        params: {
          threshold: -1.2,
          release: 90,
          gain: 0,
        },
        reason: 'True-peak safety ceiling before export',
      },
    ];
  }

  if (role === 'bus') {
    return [
      {
        type: 'compressor',
        params: {
          threshold: -20 + intensity * 5,
          ratio: 2.5 + intensity,
          attack: 15,
          release: 120,
          knee: 8,
          makeupGain: 0,
        },
        reason: 'Bus glue to bind grouped sources without heavy pumping',
      },
      {
        type: 'limiter',
        params: {
          threshold: -2,
          release: 100,
          gain: 0,
        },
        reason: 'Bus peak catch for downstream master headroom',
      },
    ];
  }

  if (role === 'vocal') {
    return [
      {
        type: 'compressor',
        params: {
          threshold: -24 + intensity * 9,
          ratio: 2.8 + intensity * 1.8,
          attack: 10 + (1 - intensity) * 12,
          release: 85 + intensity * 40,
          knee: 7,
          makeupGain: 1 + intensity * 1.5,
        },
        reason: 'Control phrase dynamics while keeping transients intelligible',
      },
    ];
  }

  if (role === 'bass') {
    return [
      {
        type: 'compressor',
        params: {
          threshold: -22 + intensity * 8,
          ratio: 3.5 + intensity * 1.5,
          attack: 18 + (1 - intensity) * 10,
          release: 110 + intensity * 60,
          knee: 6,
          makeupGain: 0.5 + intensity,
        },
        reason: 'Tighten low-end sustain and keep bass level consistent',
      },
    ];
  }

  if (role === 'drums') {
    return [
      {
        type: 'compressor',
        params: {
          threshold: -20 + intensity * 7,
          ratio: 4 + intensity * 2,
          attack: 20 + (1 - intensity) * 10,
          release: 70 + intensity * 45,
          knee: 4,
          makeupGain: 0,
        },
        reason: 'Add punch while retaining drum transients',
      },
    ];
  }

  return [
    {
      type: 'compressor',
      params: {
        threshold: -20 + intensity * 8,
        ratio: 2.2 + intensity * 1.6,
        attack: 14 + (1 - intensity) * 16,
        release: 95 + intensity * 55,
        knee: 6,
        makeupGain: 0.3 + intensity * 0.7,
      },
      reason: 'Moderate dynamic control for tonal balance',
    },
  ];
}

export function analyzeDynamicsSuggestions(tracks: Track[]): DynamicsAnalysisReport {
  const trackProposals: DynamicsTrackProposal[] = [];
  let masterPeak = 0;
  let masterRmsSq = 0;

  tracks.forEach(track => {
    if (track.type === 'video' || track.muted) return;
    const audioClips = track.clips.filter(c => c.audioBuffer);
    const role = inferDynamicsRole(track);

    let peak = 0;
    let weightedRmsSq = 0;
    let weightedDuration = 0;

    audioClips.forEach(clip => {
      if (!clip.audioBuffer) return;
      const { peak: clipPeak, rms: clipRms } = analyzeBufferEnergy(clip.audioBuffer);
      const clipGain = clamp(clip.gain, 0, 2);
      const clipVolume = track.type === 'bus' ? 1 : clamp(track.volume, 0, 1);
      const scaledPeak = clipPeak * clipGain * clipVolume;
      const scaledRms = clipRms * clipGain * clipVolume;
      const duration = Math.max(0.05, clip.duration);

      peak = Math.max(peak, scaledPeak);
      weightedRmsSq += scaledRms * scaledRms * duration;
      weightedDuration += duration;
    });

    const avgRms = weightedDuration > 0 ? Math.sqrt(weightedRmsSq / weightedDuration) : 0.09;
    const intensity = estimateIntensity(Math.max(peak, 0.12), Math.max(avgRms, 0.03));
    const plugins = buildDynamicsSuggestions(role, intensity);
    const confidence = audioClips.length
      ? clamp(0.55 + Math.min(0.35, audioClips.length * 0.08), 0.35, 0.95)
      : 0.6;

    trackProposals.push({
      trackId: track.id,
      trackName: track.name,
      role,
      intensity,
      confidence,
      plugins,
    });

    masterPeak = Math.max(masterPeak, peak);
    masterRmsSq += avgRms * avgRms;
  });

  trackProposals.sort((a, b) => b.intensity - a.intensity);

  const masterRms = Math.sqrt(masterRmsSq);
  const masterIntensity = estimateIntensity(Math.max(masterPeak, 0.14), Math.max(masterRms, 0.05));
  const masterProposal = {
    role: 'master' as const,
    confidence: clamp(0.65 + trackProposals.length * 0.03, 0.65, 0.95),
    estimatedPeakDbfs: linearToDb(masterPeak),
    plugins: buildDynamicsSuggestions('master', masterIntensity),
    reason: 'Master chain tuned for glue + limiter headroom protection',
  };

  return {
    generatedAt: Date.now(),
    trackProposals,
    masterProposal,
  };
}

export function analyzeMixGainTargets(tracks: Track[]): MixAnalysisReport {
  const proposals: MixTrackProposal[] = [];
  let masterRmsSq = 0;
  let masterPeak = 0;

  tracks.forEach(track => {
    if (track.type === 'bus' || track.type === 'video' || track.muted) return;
    const audioClips = track.clips.filter(clip => clip.audioBuffer);
    if (!audioClips.length) return;

    let weightedRmsSq = 0;
    let weightedDuration = 0;
    let peak = 0;

    audioClips.forEach(clip => {
      if (!clip.audioBuffer) return;
      const { peak: clipPeak, rms: clipRms } = analyzeBufferEnergy(clip.audioBuffer);
      const gain = clamp(clip.gain, 0, 2);
      const scaledPeak = clipPeak * gain;
      const scaledRms = clipRms * gain;
      const duration = Math.max(0.05, clip.duration);
      weightedRmsSq += scaledRms * scaledRms * duration;
      weightedDuration += duration;
      if (scaledPeak > peak) peak = scaledPeak;
    });

    if (weightedDuration <= 0) return;

    const clipMixRms = Math.sqrt(weightedRmsSq / weightedDuration);
    const currentVolume = clamp(track.volume, 0, 1);
    const postFaderRms = clipMixRms * currentVolume;
    const postFaderPeak = peak * currentVolume;
    const peakDbfs = linearToDb(postFaderPeak);
    const estimatedLufs = linearToDb(postFaderRms) - 0.7;
    const role = inferRole(track);
    const targetLufs = TARGET_LUFS_BY_ROLE[role];
    let deltaDb = clamp(targetLufs - estimatedLufs, -12, 12);
    const predictedPeak = peakDbfs + deltaDb;
    if (predictedPeak > MASTER_TARGET_PEAK_DBFS) {
      deltaDb -= predictedPeak - MASTER_TARGET_PEAK_DBFS;
    }
    deltaDb = clamp(deltaDb, -12, 12);

    const suggestedVolume = clamp(currentVolume * dbToLinear(deltaDb), 0, 1);
    const confidence = clamp(0.55 + Math.min(0.35, audioClips.length * 0.08), 0.1, 0.95);

    proposals.push({
      trackId: track.id,
      trackName: track.name,
      role,
      currentVolume,
      suggestedVolume,
      peakDbfs,
      estimatedLufs,
      targetLufs,
      deltaDb,
      confidence,
      reason: `${role} target ${targetLufs.toFixed(0)} LUFS with ${MASTER_TARGET_PEAK_DBFS.toFixed(0)} dBFS peak guard`,
    });

    masterRmsSq += postFaderRms * postFaderRms;
    masterPeak = Math.max(masterPeak, postFaderPeak);
  });

  proposals.sort((a, b) => Math.abs(b.deltaDb) - Math.abs(a.deltaDb));

  return {
    generatedAt: Date.now(),
    trackProposals: proposals,
    masterPeakDbfs: linearToDb(masterPeak),
    masterEstimatedLufs: linearToDb(Math.sqrt(masterRmsSq)) - 0.7,
  };
}

// ─── Spectral EQ Analysis ─────────────────────────────────────────────────────

const FFT_SIZE = 2048;

interface FreqBand {
  kind: EqProblemKind;
  label: string;
  loHz: number;
  hiHz: number;
  centerHz: number;
  /** dB above band average that flags a problem */
  threshold: number;
  /** maximum corrective cut in dB (always negative) */
  maxCut: number;
}

const PROBLEM_BANDS: FreqBand[] = [
  { kind: 'rumble',    label: 'Sub rumble',   loHz: 20,   hiHz: 80,   centerHz: 40,   threshold: 6,  maxCut: -8 },
  { kind: 'mud',       label: 'Mud',          loHz: 200,  hiHz: 500,  centerHz: 350,  threshold: 4,  maxCut: -6 },
  { kind: 'boxiness',  label: 'Boxiness',     loHz: 300,  hiHz: 800,  centerHz: 500,  threshold: 5,  maxCut: -5 },
  { kind: 'harshness', label: 'Harshness',    loHz: 2000, hiHz: 5000, centerHz: 3500, threshold: 4,  maxCut: -6 },
  { kind: 'sibilance', label: 'Sibilance',    loHz: 5000, hiHz: 9000, centerHz: 7000, threshold: 5,  maxCut: -5 },
];

/** Roles that are exempt from certain band checks. */
const ROLE_BAND_EXEMPTIONS: Partial<Record<MixRole, EqProblemKind[]>> = {
  bass:  ['mud'],           // bass inherently lives in the mud zone
  drums: ['rumble'],        // kick drum needs sub energy
  fx:    ['rumble', 'mud'], // FX tracks are intentionally textural
};

/**
 * Compute average spectral magnitude (linear) across all clips for a track.
 * Uses manual DFT on sampled windows — no OfflineAudioContext needed.
 */
function computeAverageSpectrum(clips: { audioBuffer: AudioBuffer | null }[], fftSize: number): Float64Array {
  const halfFFT = fftSize / 2;
  const accumulator = new Float64Array(halfFFT);
  let windowCount = 0;

  for (const clip of clips) {
    const buf = clip.audioBuffer;
    if (!buf) continue;

    // Analyze up to 6 evenly-spaced windows per clip
    const windowsPerClip = Math.min(6, Math.max(1, Math.floor(buf.length / fftSize)));
    const stride = Math.max(1, Math.floor((buf.length - fftSize) / windowsPerClip));

    for (let w = 0; w < windowsPerClip; w++) {
      const offset = w * stride;
      if (offset + fftSize > buf.length) break;

      // Sum channels into a mono window with Hann taper
      const window = new Float64Array(fftSize);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < fftSize; i++) {
          const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
          window[i] += (data[offset + i] ?? 0) * hann;
        }
      }
      // Normalize by channel count
      const chNorm = 1 / buf.numberOfChannels;
      for (let i = 0; i < fftSize; i++) window[i] *= chNorm;

      // Real-valued DFT magnitude for positive frequencies
      for (let k = 0; k < halfFFT; k++) {
        let re = 0;
        let im = 0;
        for (let n = 0; n < fftSize; n++) {
          const angle = (2 * Math.PI * k * n) / fftSize;
          re += window[n] * Math.cos(angle);
          im -= window[n] * Math.sin(angle);
        }
        accumulator[k] += Math.sqrt(re * re + im * im);
      }
      windowCount++;
    }
  }

  if (windowCount > 0) {
    for (let k = 0; k < halfFFT; k++) accumulator[k] /= windowCount;
  }
  return accumulator;
}

/**
 * Given a magnitude spectrum, compute the average magnitude within a Hz range.
 */
function bandEnergy(spectrum: Float64Array, sampleRate: number, loHz: number, hiHz: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  const loBin = Math.max(1, Math.floor(loHz / binHz));
  const hiBin = Math.min(spectrum.length - 1, Math.ceil(hiHz / binHz));
  if (hiBin <= loBin) return 0;
  let sum = 0;
  for (let b = loBin; b <= hiBin; b++) sum += spectrum[b];
  return sum / (hiBin - loBin + 1);
}

function preferredProtectedTrack(
  band: MaskingBandKind,
  roleA: MixRole,
  roleB: MixRole,
): 'a' | 'b' {
  const prioA = ROLE_BAND_PRIORITY[band][roleA] ?? 0;
  const prioB = ROLE_BAND_PRIORITY[band][roleB] ?? 0;
  if (prioA === prioB) return roleA <= roleB ? 'a' : 'b';
  return prioA > prioB ? 'a' : 'b';
}

function buildMaskingTrackProfiles(tracks: Track[]): MaskingTrackProfile[] {
  const profiles: MaskingTrackProfile[] = [];
  for (const track of tracks) {
    if (track.type === 'bus' || track.type === 'video' || track.muted) continue;
    const audioClips = track.clips.filter(c => c.audioBuffer);
    if (!audioClips.length) continue;
    const sampleRate = audioClips[0].audioBuffer!.sampleRate;
    const spectrum = computeAverageSpectrum(audioClips, FFT_SIZE);
    const broadbandAvg = bandEnergy(spectrum, sampleRate, 80, 12000, FFT_SIZE);
    if (broadbandAvg < 1e-8) continue;

    const bandLevelsDb = MASKING_BANDS.reduce((acc, band) => {
      const energy = bandEnergy(spectrum, sampleRate, band.loHz, band.hiHz, FFT_SIZE);
      acc[band.kind] = linearToDb(Math.max(energy, 1e-9)) - linearToDb(Math.max(broadbandAvg, 1e-9));
      return acc;
    }, {} as Record<MaskingBandKind, number>);

    profiles.push({
      id: track.id,
      name: track.name,
      role: inferRole(track),
      sampleRate,
      clipCount: audioClips.length,
      bandLevelsDb,
    });
  }
  return profiles;
}

export function analyzeMaskingConflicts(tracks: Track[]): MaskingAnalysisReport {
  const profiles = buildMaskingTrackProfiles(tracks);
  const conflicts: MaskingConflict[] = [];

  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const a = profiles[i];
      const b = profiles[j];

      for (const band of MASKING_BANDS) {
        const aDb = Math.max(0, a.bandLevelsDb[band.kind]);
        const bDb = Math.max(0, b.bandLevelsDb[band.kind]);
        const overlapDb = Math.min(aDb, bDb);
        if (overlapDb < 2.5) continue;

        const levelDiff = Math.abs(aDb - bDb);
        const overlapScore = clamp((overlapDb - 2.5) / 7.5, 0, 1);
        const balanceScore = 1 - clamp(levelDiff / 8, 0, 1);
        const severity = clamp(overlapScore * 0.7 + balanceScore * 0.3, 0, 1);
        if (severity < 0.48) continue;

        const protectedSide = preferredProtectedTrack(band.kind, a.role, b.role);
        const protectedTrack = protectedSide === 'a' ? a : b;
        const cutTrack = protectedSide === 'a' ? b : a;
        const cutDb = Math.round(clamp(-(1.2 + severity * 3.8), -5, -1.5) * 10) / 10;
        const confidence = clamp(
          0.52 + Math.min(0.22, (a.clipCount + b.clipCount) * 0.03) + severity * 0.2,
          0.4,
          0.94,
        );

        conflicts.push({
          id: `${a.id}-${b.id}-${band.kind}`,
          band: band.kind,
          bandLabel: band.label,
          centerHz: band.centerHz,
          severity,
          confidence,
          trackAId: a.id,
          trackAName: a.name,
          trackARole: a.role,
          trackBId: b.id,
          trackBName: b.name,
          trackBRole: b.role,
          protectedTrackId: protectedTrack.id,
          suggestedCutTrackId: cutTrack.id,
          suggestedCut: {
            freq: band.centerHz,
            gainDb: cutDb,
            q: band.kind === 'sub' || band.kind === 'low' ? 0.9 : band.kind === 'mid' ? 1.2 : 1.6,
          },
          reason: `${band.label} overlap detected (${overlapDb.toFixed(1)} dB shared energy).`,
          recommendation: `Cut ${cutTrack.name} ${Math.abs(cutDb).toFixed(1)} dB @ ${band.centerHz} Hz to open ${protectedTrack.name}.`,
        });
      }
    }
  }

  conflicts.sort((a, b) => b.severity - a.severity);
  return {
    generatedAt: Date.now(),
    conflicts: conflicts.slice(0, 20),
  };
}

/**
 * Analyze all non-bus audio tracks and return per-track EQ suggestions
 * that target mud, harshness, boxiness, rumble, and sibilance.
 */
export function analyzeEqProblems(tracks: Track[]): EqAnalysisReport {
  const proposals: EqTrackProposal[] = [];

  for (const track of tracks) {
    if (track.type === 'bus' || track.type === 'video' || track.muted) continue;
    const audioClips = track.clips.filter(c => c.audioBuffer);
    if (!audioClips.length) continue;

    const sampleRate = audioClips[0].audioBuffer!.sampleRate;
    const spectrum = computeAverageSpectrum(audioClips, FFT_SIZE);

    // Compute broadband average energy (100 Hz – 12 kHz) as a reference
    const broadbandAvg = bandEnergy(spectrum, sampleRate, 100, 12000, FFT_SIZE);
    if (broadbandAvg < 1e-8) continue; // silence

    const role = inferRole(track);
    const exemptions = ROLE_BAND_EXEMPTIONS[role] ?? [];
    const bands: EqBandSuggestion[] = [];

    for (const pb of PROBLEM_BANDS) {
      if (exemptions.includes(pb.kind)) continue;

      const energy = bandEnergy(spectrum, sampleRate, pb.loHz, pb.hiHz, FFT_SIZE);
      const ratioDb = linearToDb(energy) - linearToDb(broadbandAvg);

      if (ratioDb > pb.threshold) {
        const excess = ratioDb - pb.threshold;
        const severity = clamp(excess / 8, 0, 1);
        // Corrective cut: proportional to excess, bounded
        const gainDb = clamp(-(excess * 0.7 + 1), pb.maxCut, -0.5);
        const q = pb.kind === 'rumble' ? 0.7 : pb.kind === 'mud' || pb.kind === 'boxiness' ? 1.2 : 1.8;
        const confidence = clamp(0.5 + severity * 0.4, 0.3, 0.9);

        bands.push({
          label: pb.label,
          freq: pb.centerHz,
          gainDb: Math.round(gainDb * 10) / 10,
          q: Math.round(q * 10) / 10,
          kind: pb.kind,
          severity,
          confidence,
          reason: `${pb.label} detected: ${ratioDb.toFixed(1)} dB above broadband average (threshold ${pb.threshold} dB)`,
        });
      }
    }

    if (!bands.length) continue;

    // Map top-3 most severe bands into the 3-band EQ plugin params
    const sorted = [...bands].sort((a, b) => b.severity - a.severity).slice(0, 3);
    const pluginParams = mapBandsToEqPlugin(sorted);

    proposals.push({
      trackId: track.id,
      trackName: track.name,
      role,
      bands: sorted,
      pluginParams,
    });
  }

  // Sort by total severity (worst tracks first)
  proposals.sort((a, b) => {
    const sevA = a.bands.reduce((s, band) => s + band.severity, 0);
    const sevB = b.bands.reduce((s, band) => s + band.severity, 0);
    return sevB - sevA;
  });

  return { generatedAt: Date.now(), trackProposals: proposals };
}

/**
 * Map up to 3 EQ band suggestions into the existing 3-band EQ plugin parameters.
 * Band assignment: lowest-freq → low shelf, mid-range → peaking mid, highest → high shelf.
 */
function mapBandsToEqPlugin(bands: EqBandSuggestion[]): Record<string, number> {
  const params: Record<string, number> = {
    low: 0, lowFreq: 80,
    mid: 0, midFreq: 1000,
    high: 0, highFreq: 10000,
  };

  if (!bands.length) return params;

  const sorted = [...bands].sort((a, b) => a.freq - b.freq);

  if (sorted.length === 1) {
    const b = sorted[0];
    if (b.freq <= 500) {
      params.low = b.gainDb; params.lowFreq = b.freq;
    } else if (b.freq <= 4000) {
      params.mid = b.gainDb; params.midFreq = b.freq;
    } else {
      params.high = b.gainDb; params.highFreq = b.freq;
    }
  } else if (sorted.length === 2) {
    params.low = sorted[0].gainDb; params.lowFreq = sorted[0].freq;
    if (sorted[1].freq > 4000) {
      params.high = sorted[1].gainDb; params.highFreq = sorted[1].freq;
    } else {
      params.mid = sorted[1].gainDb; params.midFreq = sorted[1].freq;
    }
  } else {
    params.low = sorted[0].gainDb; params.lowFreq = sorted[0].freq;
    params.mid = sorted[1].gainDb; params.midFreq = sorted[1].freq;
    params.high = sorted[2].gainDb; params.highFreq = sorted[2].freq;
  }

  return params;
}

/**
 * Create a PluginInstance with the suggested EQ params ready to dispatch.
 */
export function makeEqPluginFromSuggestion(proposal: EqTrackProposal): PluginInstance {
  return {
    id: `eq-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'eq',
    name: 'AI EQ Fix',
    enabled: true,
    parameters: { ...proposal.pluginParams },
  };
}

export function makeDynamicsPluginFromSuggestion(
  type: DynamicsPluginType,
  params: Record<string, number>,
): PluginInstance {
  return {
    id: `${type}-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    name: type === 'compressor' ? 'AI Dynamics Comp' : 'AI Dynamics Limiter',
    enabled: true,
    parameters: { ...params },
  };
}

// ─── Loudness Target Presets ──────────────────────────────────────────────────

interface LoudnessPresetConfig {
  id: LoudnessPreset;
  label: string;
  description: string;
  targetLufs: number;
  targetTruePeakDbfs: number;
  baseCompressor: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    knee: number;
    makeupGain: number;
  };
  limiter: {
    threshold: number;
    release: number;
    gain: number;
  };
}

export const LOUDNESS_PRESETS: Record<LoudnessPreset, LoudnessPresetConfig> = {
  streaming: {
    id: 'streaming',
    label: 'Streaming',
    description: 'Spotify / Apple Music · −14 LUFS / −1 dBTP',
    targetLufs: -14,
    targetTruePeakDbfs: -1.0,
    baseCompressor: { threshold: -24, ratio: 2.0, attack: 10, release: 100, knee: 8, makeupGain: 4 },
    limiter: { threshold: -1.0, release: 60, gain: 0 },
  },
  podcast: {
    id: 'podcast',
    label: 'Podcast',
    description: 'Podcast / Broadcast · −16 LUFS / −1 dBTP',
    targetLufs: -16,
    targetTruePeakDbfs: -1.0,
    baseCompressor: { threshold: -20, ratio: 1.8, attack: 12, release: 120, knee: 6, makeupGain: 2 },
    limiter: { threshold: -1.0, release: 80, gain: 0 },
  },
  club: {
    id: 'club',
    label: 'Club',
    description: 'Club / DJ · −9 LUFS / −0.3 dBTP',
    targetLufs: -9,
    targetTruePeakDbfs: -0.3,
    baseCompressor: { threshold: -18, ratio: 4.0, attack: 8, release: 80, knee: 4, makeupGain: 8 },
    limiter: { threshold: -0.3, release: 40, gain: 0 },
  },
};

/**
 * Build a master compressor + limiter pair tuned toward the given loudness
 * target preset. Uses a quick energy estimate of the mix to calculate a
 * makeup gain offset, then bounds the final gain to a safe range.
 */
export function buildLoudnessPresetMasterChain(
  preset: LoudnessPreset,
  tracks: Track[],
): { compressor: PluginInstance; limiter: PluginInstance } {
  const config = LOUDNESS_PRESETS[preset];

  // Quick energy estimate: sum per-track duration-weighted RMS²
  let masterRmsSq = 0;
  let trackCount = 0;
  tracks.forEach(track => {
    if (track.type === 'bus' || track.type === 'video' || track.muted) return;
    const audioClips = track.clips.filter(c => c.audioBuffer);
    if (!audioClips.length) return;

    let weightedRmsSq = 0;
    let weightedDuration = 0;
    audioClips.forEach(clip => {
      if (!clip.audioBuffer) return;
      const { rms } = analyzeBufferEnergy(clip.audioBuffer);
      const gain = clamp(clip.gain, 0, 2);
      const vol = clamp(track.volume, 0, 1);
      const scaledRms = rms * gain * vol;
      const duration = Math.max(0.05, clip.duration);
      weightedRmsSq += scaledRms * scaledRms * duration;
      weightedDuration += duration;
    });
    if (weightedDuration > 0) {
      masterRmsSq += weightedRmsSq / weightedDuration;
      trackCount++;
    }
  });

  const estimatedLufs = trackCount > 0 ? linearToDb(Math.sqrt(masterRmsSq)) - 0.7 : -20;
  // Makeup gain delta: 60% of what's needed (compressor gain reduction handles the rest)
  const makeupAdjustDb = clamp((config.targetLufs - estimatedLufs) * 0.6, -4, 10);
  const finalMakeupGain = clamp(config.baseCompressor.makeupGain + makeupAdjustDb, 0, 16);

  const ts = Date.now();
  const compressor: PluginInstance = {
    id: `compressor-lufs-${ts}`,
    type: 'compressor',
    name: `${config.label} Target Comp`,
    enabled: true,
    parameters: {
      threshold: config.baseCompressor.threshold,
      ratio: config.baseCompressor.ratio,
      attack: config.baseCompressor.attack,
      release: config.baseCompressor.release,
      knee: config.baseCompressor.knee,
      makeupGain: Math.round(finalMakeupGain * 10) / 10,
    },
  };

  const limiter: PluginInstance = {
    id: `limiter-lufs-${ts + 1}`,
    type: 'limiter',
    name: `${config.label} Limiter ${config.targetTruePeakDbfs} dBTP`,
    enabled: true,
    parameters: { ...config.limiter },
  };

  return { compressor, limiter };
}
