import type { Track, PluginInstance, LoudnessPreset } from '../types/daw';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightWarning {
  severity: PreflightSeverity;
  message: string;
  detail?: string;
  trackId?: string;
  trackName?: string;
}

export interface PreflightReport {
  warnings: PreflightWarning[];
  hasErrors: boolean;
  hasWarnings: boolean;
  isClean: boolean;
  /** Combined estimated peak of the mix bus in dBFS (pre-master-chain) */
  estimatedMixPeakDbfs: number;
  loudness: {
    integratedLufs: number;
    truePeakDbfs: number;
    suggestedPreset: LoudnessPreset;
    targetLufs: number;
    targetTruePeakDbfs: number;
    deltaToTargetDb: number;
  } | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const MIN_LINEAR = 1e-5;

function linearToDb(v: number): number {
  return 20 * Math.log10(Math.max(v, MIN_LINEAR));
}

const LOUDNESS_TARGETS: Record<LoudnessPreset, { lufs: number; truePeak: number }> = {
  streaming: { lufs: -14, truePeak: -1.0 },
  podcast: { lufs: -16, truePeak: -1.0 },
  club: { lufs: -9, truePeak: -0.3 },
};

function hasMasterLimiter(masterPlugins: PluginInstance[]): boolean {
  return masterPlugins.some(
    p => p.enabled && (p.type === 'limiter'),
  );
}

function masterLimiterCeilingDbfs(masterPlugins: PluginInstance[]): number | null {
  const limiter = masterPlugins.find(p => p.enabled && p.type === 'limiter');
  if (!limiter) return null;
  const threshold = Number(limiter.parameters['threshold'] ?? -1);
  const gain = Number(limiter.parameters['gain'] ?? 0);
  return Math.min(0, threshold + gain);
}

/**
 * Scan clip buffers on a single track and return the post-fader peak (linear).
 * Returns null if the track has no audio data (skip quietly).
 */
function trackPostFaderPeak(track: Track): number | null {
  const audioClips = track.clips.filter(c => c.audioBuffer);
  if (!audioClips.length) return null;

  let peak = 0;
  for (const clip of audioClips) {
    if (!clip.audioBuffer) continue;
    const buf = clip.audioBuffer;
    const step = Math.max(1, Math.floor(buf.length / 12_000));
    let clipPeak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i += step) {
        const abs = Math.abs(data[i] ?? 0);
        if (abs > clipPeak) clipPeak = abs;
      }
    }
    const gain = Math.min(Math.max(clip.gain, 0), 2);
    const scaled = clipPeak * gain;
    if (scaled > peak) peak = scaled;
  }

  const vol = Math.min(Math.max(track.volume, 0), 1);
  return peak * vol;
}

function trackPostFaderRms(track: Track): number | null {
  const audioClips = track.clips.filter(c => c.audioBuffer);
  if (!audioClips.length) return null;

  let weightedRmsSq = 0;
  let totalDuration = 0;
  for (const clip of audioClips) {
    if (!clip.audioBuffer) continue;
    const buf = clip.audioBuffer;
    const step = Math.max(1, Math.floor(buf.length / 12_000));
    let sumSq = 0;
    let sampleCount = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch += 1) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i += step) {
        const sample = data[i] ?? 0;
        sumSq += sample * sample;
        sampleCount += 1;
      }
    }
    if (!sampleCount) continue;
    const rms = Math.sqrt(sumSq / sampleCount);
    const gain = Math.min(Math.max(clip.gain, 0), 2);
    const duration = Math.max(0.05, clip.duration);
    weightedRmsSq += (rms * gain) * (rms * gain) * duration;
    totalDuration += duration;
  }
  if (totalDuration <= 0) return null;
  const vol = Math.min(Math.max(track.volume, 0), 1);
  return Math.sqrt(weightedRmsSq / totalDuration) * vol;
}

// ─── Main Analysis ─────────────────────────────────────────────────────────────

/**
 * Run preflight checks on tracks + master chain and return a structured report.
 * This is intentionally fast (samples every ~12k frames) so it can block the
 * "Bounce" button click without perceptible lag.
 */
export function runBouncePreflightAnalysis(
  tracks: Track[],
  masterPlugins: PluginInstance[],
): PreflightReport {
  const warnings: PreflightWarning[] = [];

  const audibleTracks = tracks.filter(
    t => t.type !== 'video' && !t.muted,
  );

  // ── 1. Check there is anything to export ───────────────────────────────────
  const tracksWithAudio = audibleTracks.filter(t => t.clips.some(c => c.audioBuffer));
  if (!tracksWithAudio.length) {
    warnings.push({
      severity: 'info',
      message: 'No audio to export',
      detail: 'No audible tracks have audio clips with loaded buffers. The bounce will be silence.',
    });
  }

  // ── 2. Per-track peak inspection ───────────────────────────────────────────
  let sumOfPeaksSq = 0;
  let sumOfRmsSq = 0;
  let mixPeakLinear = 0;
  let rmsTrackCount = 0;

  for (const track of audibleTracks) {
    const postFaderPeak = trackPostFaderPeak(track);
    if (postFaderPeak === null) continue;

    // Accumulate mix bus estimate (naive power sum — conservative)
    sumOfPeaksSq += postFaderPeak * postFaderPeak;
    if (postFaderPeak > mixPeakLinear) mixPeakLinear = postFaderPeak;
    const postFaderRms = trackPostFaderRms(track);
    if (postFaderRms !== null) {
      sumOfRmsSq += postFaderRms * postFaderRms;
      rmsTrackCount += 1;
    }

    const peakDbfs = linearToDb(postFaderPeak);

    if (peakDbfs > 0) {
      warnings.push({
        severity: 'error',
        message: `"${track.name}" is clipping`,
        detail: `Post-fader peak is ${peakDbfs.toFixed(1)} dBFS. Lower the track fader or clip gain to prevent distortion in the bounce.`,
        trackId: track.id,
        trackName: track.name,
      });
    } else if (peakDbfs > -2) {
      warnings.push({
        severity: 'warning',
        message: `"${track.name}" is running very hot`,
        detail: `Post-fader peak is ${peakDbfs.toFixed(1)} dBFS. Consider leaving at least 2 dB of headroom for mixing and master processing.`,
        trackId: track.id,
        trackName: track.name,
      });
    }
  }

  // ── 3. Estimated mix bus peak ──────────────────────────────────────────────
  // Use RMS-power-sum as a conservative estimate (real mixing adds phase cancellation)
  const estimatedMixPeakDbfs = tracksWithAudio.length
    ? linearToDb(Math.sqrt(sumOfPeaksSq))
    : -Infinity;

  const limiterCeilingDbfs = masterLimiterCeilingDbfs(masterPlugins);
  const estimatedTruePeakDbfs = Number.isFinite(estimatedMixPeakDbfs)
    ? (
      limiterCeilingDbfs === null
        ? estimatedMixPeakDbfs
        : Math.min(estimatedMixPeakDbfs, limiterCeilingDbfs)
    )
    : -Infinity;

  const estimatedIntegratedLufs = rmsTrackCount > 0
    ? linearToDb(Math.sqrt(sumOfRmsSq)) - 0.7
    : -Infinity;

  if (Number.isFinite(estimatedMixPeakDbfs) && estimatedMixPeakDbfs > 0) {
    warnings.push({
      severity: 'error',
      message: 'Mix bus is likely clipping before master chain',
      detail: `Estimated combined peak is ${estimatedMixPeakDbfs.toFixed(1)} dBFS. Lower individual track faders or apply gain-staging before bouncing.`,
    });
  } else if (Number.isFinite(estimatedMixPeakDbfs) && estimatedMixPeakDbfs > -3) {
    warnings.push({
      severity: 'warning',
      message: 'Mix bus headroom is tight',
      detail: `Estimated combined peak is ${estimatedMixPeakDbfs.toFixed(1)} dBFS. A limiter on the master chain is strongly recommended.`,
    });
  }

  // ── 4. Master chain safety check ──────────────────────────────────────────
  if (tracksWithAudio.length > 0 && !hasMasterLimiter(masterPlugins)) {
    warnings.push({
      severity: 'warning',
      message: 'No limiter on master chain',
      detail: 'Without a limiter, peaks above 0 dBFS will cause hard clipping in the exported WAV. Add a Limiter plugin to the master chain in the Mixer panel.',
    });
  }

  let loudness: PreflightReport['loudness'] = null;
  if (tracksWithAudio.length > 0 && Number.isFinite(estimatedIntegratedLufs) && Number.isFinite(estimatedTruePeakDbfs)) {
    const presets = Object.entries(LOUDNESS_TARGETS) as [LoudnessPreset, { lufs: number; truePeak: number }][];
    let suggestedPreset: LoudnessPreset = 'streaming';
    let bestScore = Infinity;
    for (const [preset, target] of presets) {
      const score = Math.abs(estimatedIntegratedLufs - target.lufs) + Math.abs(estimatedTruePeakDbfs - target.truePeak) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        suggestedPreset = preset;
      }
    }
    const suggestedTarget = LOUDNESS_TARGETS[suggestedPreset];
    loudness = {
      integratedLufs: estimatedIntegratedLufs,
      truePeakDbfs: estimatedTruePeakDbfs,
      suggestedPreset,
      targetLufs: suggestedTarget.lufs,
      targetTruePeakDbfs: suggestedTarget.truePeak,
      deltaToTargetDb: suggestedTarget.lufs - estimatedIntegratedLufs,
    };

    if (estimatedTruePeakDbfs > 0) {
      warnings.push({
        severity: 'error',
        message: 'True peak will clip on bounce',
        detail: `Estimated true peak is ${estimatedTruePeakDbfs.toFixed(1)} dBFS. Lower mix level or apply loudness auto-adjust before export.`,
      });
    } else if (estimatedTruePeakDbfs > -1.0) {
      warnings.push({
        severity: 'warning',
        message: 'True peak margin is below 1 dB',
        detail: `Estimated true peak is ${estimatedTruePeakDbfs.toFixed(1)} dBFS. Use loudness auto-adjust to set safer master limiting.`,
      });
    }

    if (estimatedIntegratedLufs > -8) {
      warnings.push({
        severity: 'warning',
        message: 'Integrated loudness is very high',
        detail: `Estimated loudness is ${estimatedIntegratedLufs.toFixed(1)} LUFS. Streaming platforms will likely apply heavy loudness normalization.`,
      });
    } else if (estimatedIntegratedLufs < -20) {
      warnings.push({
        severity: 'warning',
        message: 'Integrated loudness is very low',
        detail: `Estimated loudness is ${estimatedIntegratedLufs.toFixed(1)} LUFS. Bounce may sound too quiet relative to common release targets.`,
      });
    }
  }

  // ── 5. Muted-track notice ──────────────────────────────────────────────────
  const mutedWithContent = tracks.filter(
    t => t.muted && t.clips.some(c => c.audioBuffer),
  );
  if (mutedWithContent.length > 0) {
    const names = mutedWithContent.map(t => `"${t.name}"`).join(', ');
    warnings.push({
      severity: 'info',
      message: `${mutedWithContent.length} muted track${mutedWithContent.length > 1 ? 's' : ''} will be excluded`,
      detail: `${names} ${mutedWithContent.length > 1 ? 'are' : 'is'} muted and will not appear in the bounce. Un-mute to include.`,
    });
  }

  const hasErrors = warnings.some(w => w.severity === 'error');
  const hasWarnings = warnings.some(w => w.severity === 'warning');

  return {
    warnings,
    hasErrors,
    hasWarnings,
    isClean: !hasErrors && !hasWarnings,
    estimatedMixPeakDbfs,
    loudness,
  };
}
