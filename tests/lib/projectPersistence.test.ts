import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DAWState } from '../../src/types/daw';
import { initialDAWState } from '../../src/context/dawReducer';
import {
  SCHEMA_VERSION,
  downloadProjectFile,
  loadProjectFromFile,
  loadProjectLocally,
} from '../../src/lib/projectPersistence';

class MockAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }

  copyToChannel(source: Float32Array, channel: number): void {
    this.channels[channel].set(source.subarray(0, this.length));
  }
}

function makeState(): DAWState {
  const track = initialDAWState.tracks[0];
  const audio = new MockAudioBuffer({ numberOfChannels: 2, length: 4, sampleRate: 44100 });
  audio.copyToChannel(new Float32Array([0.1, -0.25, 0.5, -0.125]), 0);
  audio.copyToChannel(new Float32Array([0.05, -0.15, 0.3, -0.2]), 1);

  return {
    ...initialDAWState,
    projectName: 'Persistence Roundtrip',
    bpm: 126,
    preRollBars: 2,
    tracks: [
      {
        ...track,
        name: 'MIDI Bass',
        meterMode: 'pre',
        clips: [
          {
            id: 'clip-persist-1',
            name: 'Pattern',
            startTime: 1,
            duration: 2,
            audioBuffer: audio as unknown as AudioBuffer,
            waveformPeaks: [0.1, 0.2, 0.3],
            color: '#30d158',
            gain: 0.9,
            fadeIn: 0.02,
            fadeOut: 0.03,
            offset: 0.01,
            midiNotes: [
              { midi: 48, startBeats: 0, durationBeats: 1, velocity: 88 },
              { midi: 55, startBeats: 1, durationBeats: 1, velocity: 83 },
            ],
            drumHits: [{ kind: 'kick', startBeats: 0, velocity: 101 }],
          },
        ],
        videoClips: [],
      },
    ],
  };
}

describe('projectPersistence', () => {
  let objectUrlBlob: Blob | null = null;
  let originalAudioBuffer: typeof AudioBuffer | undefined;

  beforeEach(() => {
    objectUrlBlob = null;
    originalAudioBuffer = globalThis.AudioBuffer;
    (globalThis as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer =
      MockAudioBuffer as unknown as typeof AudioBuffer;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      objectUrlBlob = blob as Blob;
      return 'blob:riff-test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAudioBuffer) {
      (globalThis as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer = originalAudioBuffer;
    } else {
      delete (globalThis as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer;
    }
    localStorage.clear();
  });

  it('round-trips .riff export/import with clip note data and audio payload', async () => {
    const state = makeState();
    downloadProjectFile(state);
    expect(objectUrlBlob).not.toBeNull();

    const json = await objectUrlBlob!.text();
    const file = new File([json], 'roundtrip.riff', { type: 'application/json' });
    const loaded = await loadProjectFromFile(file);

    expect(loaded.projectName).toBe('Persistence Roundtrip');
    expect(loaded.bpm).toBe(126);
    expect(loaded.preRollBars).toBe(2);
    expect(loaded.tracks).toHaveLength(1);
    const clip = loaded.tracks?.[0].clips[0];
    expect(clip?.midiNotes).toHaveLength(2);
    expect(clip?.drumHits?.[0].kind).toBe('kick');
    expect(clip?.audioBuffer).toBeInstanceOf(MockAudioBuffer);
    expect(clip?.audioBuffer?.getChannelData(0)[2]).toBeCloseTo(0.5, 5);
  });

  it('rejects incompatible schema from localStorage restore payload', async () => {
    localStorage.setItem('riff-project-v1', JSON.stringify({
      schema: SCHEMA_VERSION + 1,
      name: 'Future File',
      savedAt: new Date().toISOString(),
      bpm: 120,
      timeSignature: '4/4',
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 8,
      metronomeEnabled: false,
      snapEnabled: true,
      masterVolume: 1,
      masterPan: 0,
      zoom: 100,
      aiConfig: {
        genre: 'rock',
        bpm: 120,
        key: 'C',
        timeSignature: '4/4',
        bars: 8,
        instruments: ['drums'],
        useAiArrangement: true,
        useLocalPatterns: true,
      },
      tracks: [],
    }));

    await expect(loadProjectLocally()).resolves.toBeNull();
  });

  it('rejects incompatible schema from .riff file import', async () => {
    const file = new File([JSON.stringify({
      schema: SCHEMA_VERSION + 1,
      name: 'Future File',
      savedAt: new Date().toISOString(),
      bpm: 120,
      timeSignature: '4/4',
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 8,
      metronomeEnabled: false,
      snapEnabled: true,
      masterVolume: 1,
      masterPan: 0,
      zoom: 100,
      aiConfig: {
        genre: 'rock',
        bpm: 120,
        key: 'C',
        timeSignature: '4/4',
        bars: 8,
        instruments: ['drums'],
        useAiArrangement: true,
        useLocalPatterns: true,
      },
      tracks: [],
    })], 'future.riff', { type: 'application/json' });

    await expect(loadProjectFromFile(file)).rejects.toThrow('Unsupported .riff schema version');
  });
});
