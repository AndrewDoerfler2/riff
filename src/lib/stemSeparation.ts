export type StemId = 'vocals' | 'drums' | 'bass' | 'other';

export interface StemDefinition {
  id: StemId;
  name: string;
  color: string;
}

export interface SeparatedStem {
  id: StemId;
  name: string;
  color: string;
  audioBuffer: AudioBuffer;
}

interface SplitStemsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number, stage: string) => void;
}

export const STEM_DEFINITIONS: readonly StemDefinition[] = [
  { id: 'vocals', name: 'Vocals', color: '#ff5ea8' },
  { id: 'drums', name: 'Drums', color: '#ff9f0a' },
  { id: 'bass', name: 'Bass', color: '#64d2ff' },
  { id: 'other', name: 'Other', color: '#30d158' },
] as const;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Stem separation canceled.', 'AbortError');
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function lowPass(
  input: Float32Array,
  cutoffHz: number,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const output = new Float32Array(input.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * Math.max(10, cutoffHz));
  const alpha = dt / (rc + dt);
  let previous = input[0] ?? 0;
  for (let i = 0; i < input.length; i += 1) {
    if (i > 0 && i % 65536 === 0) {
      throwIfAborted(signal);
      await tick();
    }
    previous += alpha * (input[i] - previous);
    output[i] = previous;
  }
  throwIfAborted(signal);
  return output;
}

async function highPass(
  input: Float32Array,
  cutoffHz: number,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const output = new Float32Array(input.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * Math.max(10, cutoffHz));
  const alpha = rc / (rc + dt);
  let previousOutput = input[0] ?? 0;
  let previousInput = input[0] ?? 0;
  for (let i = 0; i < input.length; i += 1) {
    if (i > 0 && i % 65536 === 0) {
      throwIfAborted(signal);
      await tick();
    }
    const currentInput = input[i];
    const currentOutput = alpha * (previousOutput + currentInput - previousInput);
    output[i] = currentOutput;
    previousOutput = currentOutput;
    previousInput = currentInput;
  }
  throwIfAborted(signal);
  return output;
}

function normalizeChannels(channels: Float32Array[]): void {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const abs = Math.abs(channel[i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak <= 0.99 || peak === 0) return;
  const gain = 0.99 / peak;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] *= gain;
    }
  }
}

function makeAudioBuffer(sampleRate: number, channelData: Float32Array[]): AudioBuffer {
  const output = new AudioBuffer({
    sampleRate,
    numberOfChannels: channelData.length,
    length: channelData[0]?.length ?? 0,
  });
  channelData.forEach((channel, index) => {
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    output.copyToChannel(copy, index);
  });
  return output;
}

export async function splitAudioBufferIntoStems(source: AudioBuffer, options: SplitStemsOptions = {}): Promise<SeparatedStem[]> {
  const { signal, onProgress } = options;
  const channels = Math.max(1, source.numberOfChannels);
  const sampleRate = source.sampleRate;
  const sampleLength = source.length;
  const stemChannels: Record<StemId, Float32Array[]> = {
    vocals: [],
    drums: [],
    bass: [],
    other: [],
  };

  onProgress?.(24, 'Separating stems');

  for (let ch = 0; ch < channels; ch += 1) {
    throwIfAborted(signal);
    onProgress?.(
      24 + (ch / channels) * 38,
      `Separating channel ${ch + 1} of ${channels}`,
    );

    const input = new Float32Array(source.getChannelData(ch));
    const bass = await lowPass(input, 180, sampleRate, signal);
    const vocalBand = await highPass(
      await lowPass(input, 4200, sampleRate, signal),
      180,
      sampleRate,
      signal,
    );
    const drumBody = await highPass(
      await lowPass(input, 2200, sampleRate, signal),
      60,
      sampleRate,
      signal,
    );
    const drumAir = await highPass(input, 4200, sampleRate, signal);
    const drums = new Float32Array(sampleLength);
    const other = new Float32Array(sampleLength);

    for (let i = 0; i < sampleLength; i += 1) {
      if (i > 0 && i % 65536 === 0) {
        throwIfAborted(signal);
        await tick();
      }
      const drumValue = drumBody[i] * 0.75 + drumAir[i] * 0.55;
      drums[i] = drumValue;
      other[i] = input[i] - (bass[i] * 0.85 + vocalBand[i] * 0.95 + drumValue * 0.65);
    }

    stemChannels.vocals.push(vocalBand);
    stemChannels.drums.push(drums);
    stemChannels.bass.push(bass);
    stemChannels.other.push(await highPass(other, 70, sampleRate, signal));
    onProgress?.(
      24 + ((ch + 1) / channels) * 38,
      `Separated channel ${ch + 1} of ${channels}`,
    );
  }

  const stems: SeparatedStem[] = [];
  for (let i = 0; i < STEM_DEFINITIONS.length; i += 1) {
    throwIfAborted(signal);
    const definition = STEM_DEFINITIONS[i];
    const channelData = stemChannels[definition.id];
    normalizeChannels(channelData);
    stems.push({
      id: definition.id,
      name: definition.name,
      color: definition.color,
      audioBuffer: makeAudioBuffer(sampleRate, channelData),
    });
    onProgress?.(
      62 + ((i + 1) / STEM_DEFINITIONS.length) * 10,
      `Prepared ${definition.name} stem`,
    );
    await tick();
  }

  return stems;
}
