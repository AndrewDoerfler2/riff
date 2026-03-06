// ─── Audio Node Builders ────────────────────────────────────────────────────────
// Pure Web Audio API node factories and routing utilities.
// No React dependencies — all functions take AudioContext + typed params and
// return node graphs that can be wired together freely.

import type { Track, PluginInstance } from '../types/daw';

// ─── Interfaces ─────────────────────────────────────────────────────────────────

export interface PlaybackHandle {
  source: AudioBufferSourceNode;
  cleanup: () => void;
}

export interface PluginBinding {
  pluginId: string;
  update: (plugin: PluginInstance) => void;
}

export interface PluginNodeChain {
  input: AudioNode;
  output: AudioNode;
  pluginBindings: PluginBinding[];
  cleanup: () => void;
}

// Per-track bus: all clips on a track feed into sumInput; gain/pan + stereo metering
export interface TrackBusNode {
  trackId: string;
  sumInput: GainNode;
  preAnalyserL: AnalyserNode;
  preAnalyserR: AnalyserNode;
  trackGain: GainNode;
  trackPan: StereoPannerNode;
  postAnalyserL: AnalyserNode;
  postAnalyserR: AnalyserNode;
  pluginBindings: PluginBinding[];
  cleanup: () => void;
}

// Master output chain: plugins + compression + stereo analysers → destination
export interface MasterChainNode {
  input: GainNode;
  masterGain: GainNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  pluginBindings: PluginBinding[];
  cleanup: () => void;
}

export interface ClipPluginChainResult {
  input: AudioNode;
  cleanup: () => void;
}

// ─── RMS / Analyser ─────────────────────────────────────────────────────────────

export function makeAnalyser(ctx: AudioContext): AnalyserNode {
  const a = ctx.createAnalyser();
  a.fftSize = 256;
  a.smoothingTimeConstant = 0.55;
  return a;
}

export function getRmsLevel(analyser: AnalyserNode): number {
  const data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const s of data) sum += s * s;
  return Math.sqrt(sum / data.length);
}

// ─── Track Bus ──────────────────────────────────────────────────────────────────

export function createTrackBusNode(ctx: AudioContext, track: Track, destination: AudioNode): TrackBusNode {
  const sumInput = ctx.createGain();
  const trackGain = ctx.createGain();
  const trackPan = ctx.createStereoPanner();
  const preSplitter = ctx.createChannelSplitter(2);
  const postSplitter = ctx.createChannelSplitter(2);
  const preAnalyserL = makeAnalyser(ctx);
  const preAnalyserR = makeAnalyser(ctx);
  const postAnalyserL = makeAnalyser(ctx);
  const postAnalyserR = makeAnalyser(ctx);

  trackGain.gain.value = track.volume;
  trackPan.pan.value = track.pan;

  // Pre-fader tap (fork, doesn't interrupt signal)
  sumInput.connect(preSplitter);
  preSplitter.connect(preAnalyserL, 0);
  preSplitter.connect(preAnalyserR, 1);

  // Signal path: sumInput → trackGain → trackPan → destination
  sumInput.connect(trackGain);
  trackGain.connect(trackPan);
  trackPan.connect(destination);

  // Post-fader tap
  trackPan.connect(postSplitter);
  postSplitter.connect(postAnalyserL, 0);
  postSplitter.connect(postAnalyserR, 1);

  return {
    trackId: track.id,
    sumInput,
    preAnalyserL, preAnalyserR,
    trackGain, trackPan,
    postAnalyserL, postAnalyserR,
    pluginBindings: [],
    cleanup: () => {
      [sumInput, preSplitter, trackGain, trackPan, postSplitter,
       preAnalyserL, preAnalyserR, postAnalyserL, postAnalyserR].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
  };
}

export function syncTrackBusNode(bus: TrackBusNode, track: Track): void {
  bus.trackGain.gain.value = track.volume;
  bus.trackPan.pan.value = track.pan;
  bus.pluginBindings.forEach(binding => {
    const plugin = track.plugins.find(p => p.id === binding.pluginId);
    if (plugin) binding.update(plugin);
  });
}

// ─── Master Chain ───────────────────────────────────────────────────────────────

export function createMasterChainNode(
  ctx: AudioContext,
  masterVolume: number,
  masterPlugins: PluginInstance[],
): MasterChainNode {
  const input = ctx.createGain();
  const masterGain = ctx.createGain();
  masterGain.gain.value = masterVolume;

  // Output bus compression: 4:1, -18dB, 10ms attack, 100ms release
  const busComp = ctx.createDynamicsCompressor();
  busComp.ratio.value = 4;
  busComp.threshold.value = -18;
  busComp.attack.value = 0.01;
  busComp.release.value = 0.1;
  busComp.knee.value = 6;

  const splitter = ctx.createChannelSplitter(2);
  const analyserL = makeAnalyser(ctx);
  const analyserR = makeAnalyser(ctx);

  const cleanupCallbacks: Array<() => void> = [];
  const pluginBindings: PluginBinding[] = [];

  let currentNode: AudioNode = input;
  masterPlugins.forEach(plugin => {
    if (!plugin.enabled) return;
    const built = buildPluginNodes(ctx, plugin);
    if (!built) return;
    currentNode.connect(built.input);
    currentNode = built.output;
    cleanupCallbacks.push(built.cleanup);
    pluginBindings.push(...built.pluginBindings);
  });

  currentNode.connect(masterGain);
  masterGain.connect(busComp);
  busComp.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
  busComp.connect(ctx.destination);

  return {
    input,
    masterGain,
    analyserL,
    analyserR,
    pluginBindings,
    cleanup: () => {
      cleanupCallbacks.forEach(fn => fn());
      [input, masterGain, busComp, splitter, analyserL, analyserR].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
  };
}

// ─── Clip Plugin Chain ──────────────────────────────────────────────────────────

export function buildClipPluginChain(
  ctx: AudioContext,
  plugins: PluginInstance[],
  destination: AudioNode,
): ClipPluginChainResult {
  const input = ctx.createGain();
  const cleanupCallbacks: Array<() => void> = [];

  let currentNode: AudioNode = input;
  plugins.forEach(plugin => {
    if (!plugin.enabled) return;
    const built = buildPluginNodes(ctx, plugin);
    if (!built) return;
    currentNode.connect(built.input);
    currentNode = built.output;
    cleanupCallbacks.push(built.cleanup);
  });
  currentNode.connect(destination);

  return {
    input,
    cleanup: () => {
      cleanupCallbacks.forEach(fn => fn());
      try { input.disconnect(); } catch {}
    },
  };
}

// ─── Plugin Node Dispatch ────────────────────────────────────────────────────────

export function buildPluginNodes(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain | null {
  switch (plugin.type) {
    case 'gain':       return createGainPlugin(ctx, plugin);
    case 'eq':         return createEqPlugin(ctx, plugin);
    case 'compressor': return createDynamicsPlugin(ctx, plugin, false);
    case 'limiter':    return createDynamicsPlugin(ctx, plugin, true);
    case 'delay':      return createDelayPlugin(ctx, plugin);
    case 'distortion': return createDistortionPlugin(ctx, plugin);
    case 'chorus':     return createChorusPlugin(ctx, plugin);
    case 'autopan':    return createAutoPanPlugin(ctx, plugin);
    case 'humRemover': return createHumRemoverPlugin(ctx, plugin);
    case 'reverb':     return createReverbPlugin(ctx, plugin);
    default:           return null;
  }
}

// ─── Plugin Factories ────────────────────────────────────────────────────────────

function createGainPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const gain = ctx.createGain();
  const update = (instance: PluginInstance) => {
    gain.gain.value = dbToGain((instance.parameters.gain ?? 0) + (instance.parameters.trim ?? 0));
  };
  update(plugin);
  return {
    input: gain,
    output: gain,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => { try { gain.disconnect(); } catch {} },
  };
}

function createEqPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';

  const update = (instance: PluginInstance) => {
    low.frequency.value = instance.parameters.lowFreq ?? 80;
    low.gain.value = instance.parameters.low ?? 0;
    mid.frequency.value = instance.parameters.midFreq ?? 1000;
    mid.gain.value = instance.parameters.mid ?? 0;
    high.frequency.value = instance.parameters.highFreq ?? 10000;
    high.gain.value = instance.parameters.high ?? 0;
  };
  update(plugin);
  low.connect(mid);
  mid.connect(high);

  return {
    input: low,
    output: high,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      try { low.disconnect(); } catch {}
      try { mid.disconnect(); } catch {}
      try { high.disconnect(); } catch {}
    },
  };
}

function createDynamicsPlugin(ctx: AudioContext, plugin: PluginInstance, limiter: boolean): PluginNodeChain {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();

  const update = (instance: PluginInstance) => {
    comp.threshold.value = instance.parameters.threshold ?? (limiter ? -1 : -18);
    comp.knee.value = limiter ? 0 : (instance.parameters.knee ?? 6);
    comp.ratio.value = limiter ? 20 : (instance.parameters.ratio ?? 4);
    comp.attack.value = (instance.parameters.attack ?? 10) / 1000;
    comp.release.value = (instance.parameters.release ?? 100) / 1000;
    makeup.gain.value = dbToGain(
      (instance.parameters.makeupGain ?? 0) + (limiter ? (instance.parameters.gain ?? 0) : 0),
    );
  };
  update(plugin);
  comp.connect(makeup);

  return {
    input: comp,
    output: makeup,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      try { comp.disconnect(); } catch {}
      try { makeup.disconnect(); } catch {}
    },
  };
}

function createDelayPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(4);
  const feedback = ctx.createGain();

  const update = (instance: PluginInstance) => {
    delay.delayTime.value = instance.parameters.time ?? 0.25;
    feedback.gain.value = Math.min(0.95, instance.parameters.feedback ?? 0.3);
    wet.gain.value = instance.parameters.wet ?? 0.3;
    dry.gain.value = instance.parameters.dry ?? 0.7;
  };
  update(plugin);

  input.connect(dry);
  dry.connect(output);
  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(output);

  return {
    input,
    output,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      [input, output, dry, wet, delay, feedback].forEach(n => { try { n.disconnect(); } catch {} });
    },
  };
}

function createDistortionPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const tone = ctx.createBiquadFilter();

  shaper.oversample = '4x';
  tone.type = 'lowpass';

  const update = (instance: PluginInstance) => {
    shaper.curve = makeDistortionCurve(80 + (instance.parameters.drive ?? 0.5) * 320);
    tone.frequency.value = 600 + (instance.parameters.tone ?? 0.5) * 7400;
    wet.gain.value = instance.parameters.mix ?? 0.5;
    dry.gain.value = 1 - (instance.parameters.mix ?? 0.5);
  };
  update(plugin);

  input.connect(dry);
  dry.connect(output);
  input.connect(shaper);
  shaper.connect(tone);
  tone.connect(wet);
  wet.connect(output);

  return {
    input,
    output,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      [input, output, dry, wet, shaper, tone].forEach(n => { try { n.disconnect(); } catch {} });
    },
  };
}

function createChorusPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(0.1);
  const depth = ctx.createGain();
  const lfo = ctx.createOscillator();
  const feedback = ctx.createGain();

  const update = (instance: PluginInstance) => {
    delay.delayTime.value = (instance.parameters.delay ?? 12) / 1000;
    depth.gain.value = (instance.parameters.depth ?? 0.5) * 0.015;
    lfo.frequency.value = instance.parameters.rate ?? 0.5;
    feedback.gain.value = Math.min(0.8, instance.parameters.feedback ?? 0.2);
    wet.gain.value = instance.parameters.mix ?? 0.5;
    dry.gain.value = 1 - (instance.parameters.mix ?? 0.5);
  };
  update(plugin);

  lfo.connect(depth);
  depth.connect(delay.delayTime);
  lfo.start();

  input.connect(dry);
  dry.connect(output);
  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(output);

  return {
    input,
    output,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      try { lfo.stop(); } catch {}
      [input, output, dry, wet, delay, depth, feedback, lfo].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
  };
}

function createAutoPanPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const input = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();

  const update = (instance: PluginInstance) => {
    depth.gain.value = instance.parameters.depth ?? 0.5;
    lfo.frequency.value = instance.parameters.rate ?? 0.5;
  };
  update(plugin);

  lfo.connect(depth);
  depth.connect(panner.pan);
  lfo.start();
  input.connect(panner);

  return {
    input,
    output: panner,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      try { lfo.stop(); } catch {}
      [input, panner, lfo, depth].forEach(n => { try { n.disconnect(); } catch {} });
    },
  };
}

function createReverbPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();

  const update = (instance: PluginInstance) => {
    convolver.buffer = createImpulseResponse(
      ctx,
      instance.parameters.roomSize ?? 0.5,
      instance.parameters.dampening ?? 0.5,
    );
    wet.gain.value = instance.parameters.wet ?? 0.3;
    dry.gain.value = instance.parameters.dry ?? 0.7;
  };
  update(plugin);

  input.connect(dry);
  dry.connect(output);
  input.connect(convolver);
  convolver.connect(wet);
  wet.connect(output);

  return {
    input,
    output,
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      [input, output, dry, wet, convolver].forEach(n => { try { n.disconnect(); } catch {} });
    },
  };
}

function createHumRemoverPlugin(ctx: AudioContext, plugin: PluginInstance): PluginNodeChain {
  const fundamentals = [1, 2, 3, 4].map(() => ctx.createBiquadFilter());
  fundamentals.forEach(f => { f.type = 'notch'; });
  for (let i = 0; i < fundamentals.length - 1; i++) {
    fundamentals[i].connect(fundamentals[i + 1]);
  }

  const update = (instance: PluginInstance) => {
    const humFreq = instance.parameters.humFreq ?? 60;
    const q = instance.parameters.q ?? 14;
    const reduction = instance.parameters.reduction ?? 18;
    fundamentals.forEach((f, i) => {
      f.frequency.value = humFreq * (i + 1);
      f.Q.value = q;
      f.gain.value = -Math.abs(reduction);
    });
  };
  update(plugin);

  return {
    input: fundamentals[0],
    output: fundamentals[fundamentals.length - 1],
    pluginBindings: [{ pluginId: plugin.id, update }],
    cleanup: () => {
      fundamentals.forEach(f => { try { f.disconnect(); } catch {} });
    },
  };
}

// ─── Math Helpers ────────────────────────────────────────────────────────────────

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 44100;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function createImpulseResponse(ctx: AudioContext, roomSize: number, dampening: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * (0.6 + roomSize * 2.4)));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  const decay = Math.max(0.1, 1.5 + roomSize * 2.5);
  const damping = Math.max(0.05, 1 - dampening * 0.85);

  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * damping;
    }
  }
  return impulse;
}
