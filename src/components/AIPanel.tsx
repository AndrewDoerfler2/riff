import { useCallback, useMemo, useRef, useState } from 'react';
import { useDAW } from '../context/DAWContext';
import type { AIConfig, Instrument } from '../types/daw';
import {
  createClipFromBuffer,
  generateLocalBackingTrackPlan,
  instrumentColor,
  prewarmSamples,
  renderInstrumentPlan,
  type BackingTrackPlan,
  type BackingTrackRequest,
} from '../lib/backingTrackRenderer';
import {
  createMidiClipFromGenerationTrack,
  GENRES,
  INSTRUMENT_GROUPS,
  INSTRUMENTS,
  MAX_GENERATIONS,
  renderPlansWithConcurrency,
  type AIGeneration,
  type AIGenerationTrack,
} from './aiPanelUtils';
import { AIGenerationList, AIPanelControls, AIPanelSummary } from './AIPanelSections';

const AI_RENDER_CONCURRENCY = 2;

let takeCounter = 0;

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AIPanel() {
  const { state, dispatch, createTrack } = useDAW();
  const { aiConfig } = state;
  const generationTokenRef = useRef(0);

  // Generation history (session-only; AudioBuffers can't be persisted)
  const [generations, setGenerations] = useState<AIGeneration[]>([]);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [regeneratingTrackId, setRegeneratingTrackId] = useState<string | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const updateAI = useCallback((updates: Partial<AIConfig>) => {
    dispatch({ type: 'UPDATE_AI_CONFIG', payload: updates });
  }, [dispatch]);

  const toggleInstrument = useCallback((id: Instrument) => {
    dispatch({ type: 'TOGGLE_INSTRUMENT', payload: id });
  }, [dispatch]);

  const getSelectedSourcesLabel = useCallback(() => {
    const labels = [
      aiConfig.useAiArrangement ? 'AI arrangement' : null,
      aiConfig.useLocalPatterns ? 'Local patterns' : null,
    ].filter(Boolean);
    return labels.join(' + ');
  }, [aiConfig.useAiArrangement, aiConfig.useLocalPatterns]);

  const fetchAiPlan = useCallback(async (request: BackingTrackRequest) => {
    const response = await fetch('/api/ai/backing-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error ?? 'Failed to generate backing track plan.');
    }

    const plan = await response.json() as BackingTrackPlan;
    if (!plan.instrumentPlans?.length) {
      throw new Error('The backend returned an empty arrangement.');
    }

    return plan;
  }, []);

  // Stop any currently playing preview
  const stopPreview = useCallback(() => {
    for (const src of previewSourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    previewSourcesRef.current = [];
    setPreviewingId(null);
  }, []);

  // Preview a generation by playing all its audio buffers simultaneously
  const handlePreview = useCallback((gen: AIGeneration) => {
    stopPreview();

    if (!previewCtxRef.current || previewCtxRef.current.state === 'closed') {
      previewCtxRef.current = new AudioContext();
    }
    const ctx = previewCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const sources: AudioBufferSourceNode[] = [];
    const startAt = ctx.currentTime + 0.05;
    const maxDuration = Math.max(...gen.tracks.map(t => t.buffer.duration), 0);

    for (const track of gen.tracks) {
      const src = ctx.createBufferSource();
      src.buffer = track.buffer;
      src.connect(ctx.destination);
      src.start(startAt);
      sources.push(src);
    }

    previewSourcesRef.current = sources;
    setPreviewingId(gen.id);

    // Auto-clear preview state after the longest track finishes
    setTimeout(() => {
      setPreviewingId(id => id === gen.id ? null : id);
    }, (maxDuration + 0.5) * 1000);
  }, [stopPreview]);

  // Add all tracks from a generation to the timeline
  const handleUseGeneration = useCallback((gen: AIGeneration) => {
    stopPreview();
    for (const renderedTrack of gen.tracks) {
      const color = instrumentColor(renderedTrack.instrument);
      const audioTrack = createTrack('audio');
      audioTrack.name = `${renderedTrack.sourceLabel} ${renderedTrack.label}`;
      audioTrack.color = color;
      const midiTrack = createTrack('midi');
      midiTrack.name = `${renderedTrack.sourceLabel} ${renderedTrack.label} MIDI`;
      midiTrack.color = color;

      const audioClip = createClipFromBuffer(
        renderedTrack.buffer,
        `${renderedTrack.label} • ${gen.genre} ${gen.key} ${gen.bpm}bpm`,
        color,
      );
      const midiClip = createMidiClipFromGenerationTrack(gen, renderedTrack, color);

      audioClip.aiLink = {
        generationId: gen.id,
        instrument: renderedTrack.instrument,
        sourceLabel: renderedTrack.sourceLabel,
        role: 'audio',
        linkedTrackId: midiTrack.id,
        linkedClipId: midiClip.id,
        bpm: gen.bpm,
        key: gen.key,
        timeSignature: gen.timeSignature,
        genre: gen.genre,
      };
      midiClip.aiLink = {
        generationId: gen.id,
        instrument: renderedTrack.instrument,
        sourceLabel: renderedTrack.sourceLabel,
        role: 'midi',
        linkedTrackId: audioTrack.id,
        linkedClipId: audioClip.id,
        autoUpdateLinkedAudio: true,
        bpm: gen.bpm,
        key: gen.key,
        timeSignature: gen.timeSignature,
        genre: gen.genre,
      };

      dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: audioTrack });
      dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: midiTrack });
      dispatch({ type: 'ADD_CLIP', payload: { trackId: audioTrack.id, clip: audioClip } });
      dispatch({ type: 'ADD_CLIP', payload: { trackId: midiTrack.id, clip: midiClip } });
    }
  }, [createTrack, dispatch, stopPreview]);

  const handleUseGenerationAsMidi = useCallback((gen: AIGeneration) => {
    stopPreview();
    for (const renderedTrack of gen.tracks) {
      const color = instrumentColor(renderedTrack.instrument);
      const track = createTrack('midi');
      track.name = `${renderedTrack.sourceLabel} ${renderedTrack.label} MIDI`;
      track.color = color;
      const clip = createMidiClipFromGenerationTrack(gen, renderedTrack, color);
      dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: track });
      dispatch({ type: 'ADD_CLIP', payload: { trackId: track.id, clip } });
    }
  }, [createTrack, dispatch, stopPreview]);

  const handleUseTrackAsMidi = useCallback((gen: AIGeneration, renderedTrack: AIGenerationTrack) => {
    const color = instrumentColor(renderedTrack.instrument);
    const track = createTrack('midi');
    track.name = `${renderedTrack.sourceLabel} ${renderedTrack.label} MIDI`;
    track.color = color;
    const clip = createMidiClipFromGenerationTrack(gen, renderedTrack, color);
    dispatch({ type: 'ADD_TRACK_WITH_DATA', payload: track });
    dispatch({ type: 'ADD_CLIP', payload: { trackId: track.id, clip } });
  }, [createTrack, dispatch]);

  const handleDeleteGeneration = useCallback((id: string) => {
    if (previewingId === id) stopPreview();
    setGenerations(prev => prev.filter(g => g.id !== id));
  }, [previewingId, stopPreview]);

  const handleRegenerateTrack = useCallback(async (genId: string, instrument: Instrument) => {
    const generation = generations.find(gen => gen.id === genId);
    if (!generation) return;
    const existingTrack = generation.tracks.find(track => track.instrument === instrument);
    if (!existingTrack) return;

    const regenId = `${genId}:${instrument}`;
    setRegeneratingTrackId(regenId);

    const request: BackingTrackRequest = {
      genre: generation.genre,
      bpm: generation.bpm,
      key: generation.key,
      timeSignature: generation.timeSignature,
      bars: generation.bars,
      instruments: [instrument],
    };

    try {
      const plan = existingTrack.sourceLabel === 'AI'
        ? await fetchAiPlan(request)
        : generateLocalBackingTrackPlan(request);
      const instrumentPlan = plan.instrumentPlans.find(item => item.instrument === instrument)
        ?? plan.instrumentPlans[0];
      if (!instrumentPlan) {
        throw new Error(`No arrangement returned for ${existingTrack.label}.`);
      }

      await prewarmSamples([instrument]);
      const buffer = await renderInstrumentPlan(request, instrumentPlan);
      stopPreview();

      setGenerations(prev => prev.map(gen => {
        if (gen.id !== genId) return gen;
        return {
          ...gen,
          createdAt: Date.now(),
          tracks: gen.tracks.map(track => (
            track.instrument === instrument
              ? {
                  ...track,
                  buffer,
                  notes: instrumentPlan.notes ? [...instrumentPlan.notes] : [],
                  drumHits: instrumentPlan.drumHits ? [...instrumentPlan.drumHits] : [],
                }
              : track
          )),
        };
      }));
    } catch (error) {
      console.error('Per-track regeneration failed:', error);
      const fallback = `Failed to regenerate ${existingTrack.label}.`;
      alert(error instanceof Error ? error.message : fallback);
    } finally {
      setRegeneratingTrackId(current => (current === regenId ? null : current));
    }
  }, [fetchAiPlan, generations, stopPreview]);

  const handleGenerate = useCallback(async () => {
    if (!aiConfig.instruments.length) {
      alert('Select at least one instrument.');
      return;
    }

    if (!aiConfig.useAiArrangement && !aiConfig.useLocalPatterns) {
      alert('Select at least one backing-track source.');
      return;
    }

    const request: BackingTrackRequest = {
      genre: aiConfig.genre,
      bpm: aiConfig.bpm,
      key: aiConfig.key,
      timeSignature: aiConfig.timeSignature,
      bars: aiConfig.bars,
      instruments: aiConfig.instruments,
    };

    const token = Date.now();
    generationTokenRef.current = token;
    updateAI({ isGenerating: true, progress: 5 });

    try {
      updateAI({ progress: 16 });
      let plan: BackingTrackPlan;
      let sourceLabel: 'AI' | 'Local';

      if (aiConfig.useAiArrangement) {
        try {
          updateAI({ progress: 22 });
          plan = await fetchAiPlan(request);
          sourceLabel = 'AI';
        } catch (error) {
          if (!aiConfig.useLocalPatterns) throw error;
          console.warn('AI backing track generation failed, using local patterns instead.', error);
          updateAI({ progress: 28 });
          plan = generateLocalBackingTrackPlan(request);
          sourceLabel = 'Local';
        }
      } else {
        plan = generateLocalBackingTrackPlan(request);
        sourceLabel = 'Local';
      }

      updateAI({ progress: 30 });
      await prewarmSamples(request.instruments);
      if (generationTokenRef.current !== token) {
        throw new Error('Generation cancelled.');
      }
      updateAI({ progress: 34 });

      const renderedTracks = await renderPlansWithConcurrency(
        plan.instrumentPlans,
        AI_RENDER_CONCURRENCY,
        async (instrumentPlan, index): Promise<AIGenerationTrack> => {
          if (generationTokenRef.current !== token) {
            throw new Error('Generation cancelled.');
          }

          const instrument = instrumentPlan.instrument;
          const label = INSTRUMENTS.find(item => item.id === instrument)?.label ?? instrument;
          const buffer = await renderInstrumentPlan(request, instrumentPlan);
          const notes = instrumentPlan.notes ? [...instrumentPlan.notes] : [];
          const drumHits = instrumentPlan.drumHits ? [...instrumentPlan.drumHits] : [];

          updateAI({
            progress: 38 + Math.round(((index + 1) / plan.instrumentPlans.length) * 57),
          });

          return { instrument, label, buffer, sourceLabel, notes, drumHits };
        },
      );

      if (generationTokenRef.current !== token) return;

      // Store as a take — user picks which take to send to the timeline
      takeCounter += 1;
      const gen: AIGeneration = {
        id: `gen_${Date.now()}`,
        takeNumber: takeCounter,
        createdAt: Date.now(),
        genre: aiConfig.genre,
        bpm: aiConfig.bpm,
        key: aiConfig.key,
        timeSignature: aiConfig.timeSignature,
        bars: aiConfig.bars,
        tracks: renderedTracks,
      };

      setGenerations(prev => [gen, ...prev].slice(0, MAX_GENERATIONS));
      updateAI({ isGenerating: false, progress: 100 });
    } catch (error) {
      console.error('Backing track generation failed:', error);
      if (generationTokenRef.current === token) {
        updateAI({ isGenerating: false, progress: 0 });
      }
      if (error instanceof Error && error.message !== 'Generation cancelled.') {
        alert(error.message);
      }
    }
  }, [aiConfig, fetchAiPlan, updateAI]);

  const handleCancel = useCallback(() => {
    generationTokenRef.current = 0;
    updateAI({ isGenerating: false, progress: 0 });
  }, [updateAI]);

  const groupedInstruments = useMemo(() => (
    INSTRUMENT_GROUPS.map(group => ({
      group,
      instruments: INSTRUMENTS.filter(i => i.group === group),
    }))
  ), []);

  return (
    <div className="ai-panel">
      <div className="panel-header">
        <span className="panel-title">🤖 AI Backing Track Creator</span>
        <span className="panel-subtitle">Generate multiple takes · preview them · pick your favourite</span>
      </div>

      <div className="ai-panel-body">
        <AIPanelControls
          aiConfig={aiConfig}
          genres={GENRES}
          groupedInstruments={groupedInstruments}
          onUpdateAI={updateAI}
          onToggleInstrument={toggleInstrument}
        />

        <div className="ai-right-col">
          <AIPanelSummary
            aiConfig={aiConfig}
            selectedSourcesLabel={getSelectedSourcesLabel()}
            onGenerate={handleGenerate}
            onCancel={handleCancel}
          />
          <AIGenerationList
            aiIsGenerating={aiConfig.isGenerating}
            generations={generations}
            previewingId={previewingId}
            regeneratingTrackId={regeneratingTrackId}
            onStopPreview={stopPreview}
            onPreview={handlePreview}
            onUseGeneration={handleUseGeneration}
            onUseGenerationAsMidi={handleUseGenerationAsMidi}
            onDeleteGeneration={handleDeleteGeneration}
            onRegenerateTrack={handleRegenerateTrack}
            onUseTrackAsMidi={handleUseTrackAsMidi}
          />
        </div>
      </div>
    </div>
  );
}
