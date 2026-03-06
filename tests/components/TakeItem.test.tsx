import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TakeItem from '../../src/components/ai/TakeItem';
import type { AIGeneration } from '../../src/components/aiPanelUtils';

const generation: AIGeneration = {
  id: 'gen_1',
  takeNumber: 1,
  createdAt: Date.now(),
  genre: 'pop',
  bpm: 120,
  key: 'C',
  timeSignature: '4/4',
  bars: 8,
  tracks: [
    {
      instrument: 'piano',
      label: 'Piano',
      buffer: {} as AudioBuffer,
      sourceLabel: 'AI',
      notes: [{ midi: 60, startBeats: 0, durationBeats: 1, velocity: 0.8 }],
      drumHits: [],
    },
  ],
};

describe('TakeItem', () => {
  it('renders take controls and fires callbacks', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onStopPreview = vi.fn();
    const onUse = vi.fn();
    const onUseAsMidi = vi.fn();
    const onUseTrackAsMidi = vi.fn();
    const onDelete = vi.fn();
    const onRegenerateTrack = vi.fn();

    render(
      <TakeItem
        gen={generation}
        isPreviewing={false}
        regeneratingTrackId={null}
        isGenerating={false}
        onPreview={onPreview}
        onStopPreview={onStopPreview}
        onUse={onUse}
        onUseAsMidi={onUseAsMidi}
        onUseTrackAsMidi={onUseTrackAsMidi}
        onDelete={onDelete}
        onRegenerateTrack={onRegenerateTrack}
      />,
    );

    expect(screen.getByText('Take 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '▶' }));
    await user.click(screen.getByRole('button', { name: 'Use' }));
    await user.click(screen.getByRole('button', { name: 'MIDI' }));
    await user.click(screen.getByRole('button', { name: '↻ Piano' }));
    await user.click(screen.getByRole('button', { name: 'MIDI Piano' }));

    expect(onPreview).toHaveBeenCalledWith(generation);
    expect(onUse).toHaveBeenCalledWith(generation);
    expect(onUseAsMidi).toHaveBeenCalledWith(generation);
    expect(onRegenerateTrack).toHaveBeenCalledWith('gen_1', 'piano');
    expect(onUseTrackAsMidi).toHaveBeenCalledWith(generation, generation.tracks[0]);
    expect(onStopPreview).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
