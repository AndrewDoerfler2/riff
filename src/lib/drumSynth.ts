/**
 * drumSynth.ts — Synth drum engine using only Web Audio API.
 * No external dependencies; pure synthesis using OfflineAudioContext nodes.
 */

// ─── Utilities ────────────────────────────────────────────────────────────────

export function createNoiseBuffer(ctx: OfflineAudioContext, duration: number): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index++) data[index] = Math.random() * 2 - 1;
  return buffer;
}

export function createImpulseResponse(
  ctx: OfflineAudioContext,
  roomSize: number,
  dampening: number,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * (0.35 + roomSize * 1.9)));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  const decay = Math.max(0.2, 1.2 + roomSize * 2.4);
  const damping = Math.max(0.08, 1 - dampening * 0.82);

  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * damping;
    }
  }

  return impulse;
}

// ─── Drum hit synthesizers ────────────────────────────────────────────────────

export function scheduleKick(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  start: number,
  velocity = 1,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const click = ctx.createBufferSource();
  const clickFilter = ctx.createBiquadFilter();
  const clickGain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, start);
  osc.frequency.exponentialRampToValueAtTime(36, start + 0.2);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.95 * velocity, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
  osc.connect(gain);
  gain.connect(destination);

  click.buffer = createNoiseBuffer(ctx, 0.03);
  clickFilter.type = 'highpass';
  clickFilter.frequency.value = 2800;
  clickGain.gain.setValueAtTime(0.0001, start);
  clickGain.gain.exponentialRampToValueAtTime(0.12 * velocity, start + 0.002);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.018);
  click.connect(clickFilter);
  clickFilter.connect(clickGain);
  clickGain.connect(destination);

  osc.start(start);
  click.start(start);
  osc.stop(start + 0.24);
  click.stop(start + 0.03);
}

export function scheduleSnare(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  start: number,
  velocity = 1,
): void {
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.18);
  const noiseFilter = ctx.createBiquadFilter();
  const noiseGain = ctx.createGain();
  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();

  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1500;
  noiseGain.gain.setValueAtTime(0.0001, start);
  noiseGain.gain.exponentialRampToValueAtTime(0.62 * velocity, start + 0.008);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(destination);

  body.type = 'triangle';
  body.frequency.setValueAtTime(220, start);
  body.frequency.exponentialRampToValueAtTime(160, start + 0.08);
  bodyGain.gain.setValueAtTime(0.0001, start);
  bodyGain.gain.exponentialRampToValueAtTime(0.28 * velocity, start + 0.004);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
  body.connect(bodyGain);
  bodyGain.connect(destination);

  noise.start(start);
  body.start(start);
  noise.stop(start + 0.18);
  body.stop(start + 0.13);
}

export function scheduleHat(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  start: number,
  open = false,
  velocity = 1,
): void {
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, open ? 0.2 : 0.08);
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const metal = ctx.createOscillator();
  const metalGain = ctx.createGain();

  filter.type = 'highpass';
  filter.frequency.value = 4200;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.14 * velocity, start + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + (open ? 0.18 : 0.055));
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  metal.type = 'square';
  metal.frequency.value = open ? 7800 : 8600;
  metalGain.gain.setValueAtTime(0.0001, start);
  metalGain.gain.exponentialRampToValueAtTime(0.025 * velocity, start + 0.002);
  metalGain.gain.exponentialRampToValueAtTime(0.0001, start + (open ? 0.09 : 0.03));
  metal.connect(metalGain);
  metalGain.connect(destination);

  noise.start(start);
  metal.start(start);
  noise.stop(start + (open ? 0.18 : 0.08));
  metal.stop(start + (open ? 0.1 : 0.04));
}
