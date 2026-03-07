import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AIPanel from '../../src/components/AIPanel';
import type { AIConfig } from '../../src/types/daw';

const dispatchMock = vi.fn();
const createTrackMock = vi.fn(() => ({ id: 'track_1', type: 'audio', name: 'Track 1', color: '#fff' }));

const useDAWMock = vi.fn(() => ({
  state: {
    aiConfig: {
      genre: 'pop',
      bpm: 120,
      key: 'C',
      timeSignature: '4/4',
      bars: 8,
      instruments: ['piano'],
      useAiArrangement: false,
      useLocalPatterns: true,
      isGenerating: false,
      isRecordingSnippet: false,
      snippetDuration: 0,
      progress: 0,
    } satisfies AIConfig,
  },
  dispatch: dispatchMock,
  createTrack: createTrackMock,
}));

const generateLocalBackingTrackPlanMock = vi.fn(() => ({
  instrumentPlans: [{ instrument: 'piano', notes: [], drumHits: [] }],
}));

const prewarmSamplesMock = vi.fn(() => Promise.resolve());
const renderInstrumentPlanMock = vi.fn(() => Promise.resolve({ duration: 2 } as AudioBuffer));

vi.mock('../../src/context/DAWContext', () => ({
  useDAW: () => useDAWMock(),
}));

vi.mock('../../src/lib/backingTrackRenderer', () => ({
  createClipFromBufferAsync: vi.fn(),
  generateLocalBackingTrackPlan: (request: unknown) => generateLocalBackingTrackPlanMock(request),
  instrumentColor: vi.fn(() => '#33aa55'),
  prewarmSamples: (instruments: unknown) => prewarmSamplesMock(instruments),
  renderInstrumentPlan: (request: unknown, plan: unknown) => renderInstrumentPlanMock(request, plan),
}));

describe('AIPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
  });

  it('dispatches config actions from panel controls', async () => {
    const user = userEvent.setup();
    render(<AIPanel />);

    await user.click(screen.getByRole('button', { name: /Rock/i }));
    await user.click(screen.getByRole('button', { name: /Piano/i }));

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'UPDATE_AI_CONFIG', payload: { genre: 'rock' } });
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'TOGGLE_INSTRUMENT', payload: 'piano' });
  });

  it('shows a validation alert when no generation source is selected', async () => {
    const user = userEvent.setup();
    useDAWMock.mockReturnValueOnce({
      state: {
        aiConfig: {
          genre: 'pop',
          bpm: 120,
          key: 'C',
          timeSignature: '4/4',
          bars: 8,
          instruments: ['piano'],
          useAiArrangement: false,
          useLocalPatterns: false,
          isGenerating: false,
          isRecordingSnippet: false,
          snippetDuration: 0,
          progress: 0,
        } satisfies AIConfig,
      },
      dispatch: dispatchMock,
      createTrack: createTrackMock,
    });

    render(<AIPanel />);
    await user.click(screen.getByRole('button', { name: /Generate Take/i }));

    expect(globalThis.alert).toHaveBeenCalledWith('Select at least one backing-track source.');
    expect(generateLocalBackingTrackPlanMock).not.toHaveBeenCalled();
  });

  it('generates and displays a local take', async () => {
    const user = userEvent.setup();
    render(<AIPanel />);

    await user.click(screen.getByRole('button', { name: /Generate Take/i }));

    await waitFor(() => {
      expect(screen.getByText('Takes (1/5)')).toBeInTheDocument();
    });

    expect(generateLocalBackingTrackPlanMock).toHaveBeenCalledWith({
      genre: 'pop',
      bpm: 120,
      key: 'C',
      timeSignature: '4/4',
      bars: 8,
      instruments: ['piano'],
    });
    expect(prewarmSamplesMock).toHaveBeenCalledWith(['piano']);
    expect(renderInstrumentPlanMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'UPDATE_AI_CONFIG', payload: { isGenerating: true, progress: 5 } });
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'UPDATE_AI_CONFIG', payload: { isGenerating: false, progress: 100 } });
  });
});
