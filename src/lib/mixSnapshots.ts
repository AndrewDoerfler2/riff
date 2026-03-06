import type { DAWState, PluginInstance } from '../types/daw';

export type MixSnapshotSlot = 'A' | 'B';

export interface MixSnapshotTrackState {
  id: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  busRouteId?: string;
  plugins: PluginInstance[];
}

export interface MixSnapshotState {
  capturedAt: number;
  masterVolume: number;
  trackSnapshots: MixSnapshotTrackState[];
  masterPlugins: PluginInstance[];
}

type MixSnapshotRecord = Partial<Record<MixSnapshotSlot, MixSnapshotState>>;

function clonePlugin(plugin: PluginInstance): PluginInstance {
  return {
    ...plugin,
    parameters: { ...plugin.parameters },
  };
}

export function captureMixSnapshot(
  state: Pick<DAWState, 'tracks' | 'masterPlugins' | 'masterVolume'>,
): MixSnapshotState {
  return {
    capturedAt: Date.now(),
    masterVolume: state.masterVolume,
    trackSnapshots: state.tracks.map(track => ({
      id: track.id,
      volume: track.volume,
      pan: track.pan,
      muted: track.muted,
      soloed: track.soloed,
      busRouteId: track.busRouteId,
      plugins: track.plugins.map(clonePlugin),
    })),
    masterPlugins: state.masterPlugins.map(clonePlugin),
  };
}

export function getAlternateSnapshotSlot(
  activeSlot: MixSnapshotSlot | null,
  snapshots: MixSnapshotRecord,
): MixSnapshotSlot | null {
  if (activeSlot === 'A' && snapshots.B) return 'B';
  if (activeSlot === 'B' && snapshots.A) return 'A';
  if (activeSlot === 'A' || activeSlot === 'B') return null;
  if (snapshots.A) return 'A';
  if (snapshots.B) return 'B';
  return null;
}
