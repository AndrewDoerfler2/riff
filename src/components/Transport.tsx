import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  NativeSelect,
  Paper,
  Slider,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import * as Tone from 'tone';
import { useDAW, useAudioEngineCtx, formatTime, formatClock } from '../context/DAWContext';
import type { TimeSignature } from '../types/daw';

const TIME_SIGNATURE_OPTIONS: TimeSignature[] = ['4/4', '3/4', '6/8', '5/4', '7/8'];

function parseTimeSignature(value: string): TimeSignature {
  return TIME_SIGNATURE_OPTIONS.find((candidate) => candidate === value) ?? '4/4';
}

// ─── Transport Bar ─────────────────────────────────────────────────────────────

export default function Transport() {
  const { state, dispatch } = useDAW();
  const {
    startRecording,
    stopRecording,
    startPlayback,
    stopPlayback,
    currentAudioTime,
    availableInputs,
    selectedInputId,
    setSelectedInputId,
    refreshInputs,
    isRecordingActive,
  } = useAudioEngineCtx();
  const { isPlaying, isRecording, currentTime, bpm, timeSignature, loopEnabled,
          metronomeEnabled, snapEnabled, autoScroll, masterVolume, tracks } = state;

  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(currentTime);
  const metronomeRef = useRef<Tone.MembraneSynth | null>(null);
  const recordLatchRef = useRef(false);
  // Keep a live ref to tracks so startPlayback always has the latest clips
  const tracksRef = useRef(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { recordLatchRef.current = isRecording; }, [isRecording]);
  useEffect(() => {
    if (!isPlaying) lastTimeRef.current = currentTime;
  }, [currentTime, isPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        dispatch({ type: 'SET_PLAYING', payload: !isPlaying });
      }
      if (e.code === 'Home') dispatch({ type: 'SET_CURRENT_TIME', payload: 0 });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPlaying, dispatch]);

  // ── Tone.js Metronome ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying && metronomeEnabled) {
      // Sync Tone Transport to our BPM
      Tone.getTransport().bpm.value = bpm;

      // Create a MembraneSynth for the click sound
      const synth = new Tone.MembraneSynth({
        pitchDecay: 0.008,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.01 },
        volume: -6,
      }).toDestination();
      metronomeRef.current = synth;

      // Parse beats per bar from timeSignature
      const beatsPerBar = parseInt(timeSignature.split('/')[0] ?? '4', 10);
      let beat = 0;

      // Schedule repeating click on every quarter note
      const loopId = Tone.getTransport().scheduleRepeat((time) => {
        const isDownbeat = beat % beatsPerBar === 0;
        // Downbeat: higher pitch C2; other beats: C1
        synth.triggerAttackRelease(
          isDownbeat ? 'C2' : 'C1',
          '32n',
          time,
          isDownbeat ? 0.9 : 0.5,
        );
        beat++;
      }, '4n');

      Tone.getTransport().start();

      return () => {
        Tone.getTransport().stop();
        Tone.getTransport().cancel();
        Tone.getTransport().clear(loopId);
        synth.dispose();
        metronomeRef.current = null;
        beat = 0;
      };
    } else {
      // Stop metronome if playing stopped or metronome toggled off
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      if (metronomeRef.current) {
        metronomeRef.current.dispose();
        metronomeRef.current = null;
      }
    }
  }, [isPlaying, metronomeEnabled, bpm, timeSignature]);

  // ── Recording wiring ────────────────────────────────────────────────────────
  // Animate playhead – synced to the real AudioContext clock
  useEffect(() => {
    if (isPlaying) {
      const armedIds = tracksRef.current.filter(t => t.armed).map(t => t.id);

      const run = async () => {
        if (recordLatchRef.current) {
          if (armedIds.length === 0) {
            dispatch({ type: 'SET_PLAYING', payload: false });
            dispatch({ type: 'SET_RECORDING', payload: false });
            alert('Arm at least one track before starting recording.');
            return;
          }

          if (!isRecordingActive()) {
            try {
              await startRecording(armedIds);
            } catch (err) {
              console.error('Recording failed:', err);
              dispatch({ type: 'SET_RECORDING', payload: false });
              dispatch({ type: 'SET_PLAYING', payload: false });
              return;
            }
          }
        }

        startPlayback(lastTimeRef.current, tracksRef.current);

        const tick = () => {
          const t = currentAudioTime();
          dispatch({ type: 'SET_CURRENT_TIME', payload: t });
          lastTimeRef.current = t;
          animFrameRef.current = requestAnimationFrame(tick);
        };
        animFrameRef.current = requestAnimationFrame(tick);
      };

      run().catch(err => {
        console.error('Playback start failed:', err);
        dispatch({ type: 'SET_PLAYING', payload: false });
      });
    } else {
      stopPlayback();
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      lastTimeRef.current = currentTime;

      if (isRecordingActive()) {
        stopRecording().then((clipMap) => {
          clipMap.forEach((clip, trackId) => {
            dispatch({ type: 'ADD_CLIP', payload: { trackId, clip } });
          });
        }).catch((err: unknown) => {
          console.error('Stop recording failed:', err);
        });
      }
    }
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isRecording || !isRecordingActive()) return;

    stopRecording().then((clipMap) => {
      clipMap.forEach((clip, trackId) => {
        dispatch({ type: 'ADD_CLIP', payload: { trackId, clip } });
      });
    }).catch((err: unknown) => {
      console.error('Stop recording failed:', err);
    });
  }, [isRecording, stopRecording, isRecordingActive, dispatch]);

  const handlePlayPause = useCallback(() => {
    if (!isPlaying) lastTimeRef.current = currentTime;
    dispatch({ type: 'SET_PLAYING', payload: !isPlaying });
  }, [currentTime, isPlaying, dispatch]);

  const handleStop = useCallback(() => {
    dispatch({ type: 'SET_PLAYING', payload: false });
    dispatch({ type: 'SET_RECORDING', payload: false });
    dispatch({ type: 'SET_CURRENT_TIME', payload: 0 });
    lastTimeRef.current = 0;
  }, [dispatch]);

  const handleRecord = useCallback(() => {
    const armedCount = tracks.filter(t => t.armed).length;
    if (!isRecording) {
      if (armedCount === 0) {
        alert('Arm at least one track before recording.');
        return;
      }
      dispatch({ type: 'SET_RECORDING', payload: true });
    } else {
      dispatch({ type: 'SET_RECORDING', payload: false });
    }
  }, [isRecording, tracks, dispatch]);

  const handleBpmCommit = useCallback(() => {
    const v = parseInt(bpmInput, 10);
    if (!isNaN(v)) dispatch({ type: 'SET_BPM', payload: v });
    else setBpmInput(String(bpm));
    setEditingBpm(false);
  }, [bpm, bpmInput, dispatch]);

  const armedCount = tracks.filter(t => t.armed).length;
  const inputOptions = availableInputs.length > 0 ? availableInputs : [];
  const isRecordReady = isRecording && !isPlaying;

  return (
    <Paper
      radius={0}
      withBorder
      px="md"
      py="xs"
      style={{
        borderLeft: 0,
        borderRight: 0,
        borderTop: 0,
        borderColor: '#232937',
        background: 'rgba(16, 20, 28, 0.97)',
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon variant="light" color="gray" size="lg" title="Rewind to Start (Home)" onClick={() => { dispatch({ type: 'SET_CURRENT_TIME', payload: 0 }); lastTimeRef.current = 0; }}>⏮</ActionIcon>
          <ActionIcon variant="light" color="gray" size="lg" title="Step Back" onClick={() => dispatch({ type: 'SET_CURRENT_TIME', payload: Math.max(0, currentTime - (60 / bpm)) })}>◀◀</ActionIcon>
          <ActionIcon variant={isPlaying ? 'filled' : 'light'} color={isPlaying ? 'green' : 'gray'} size="xl" title="Play / Pause (Space)" onClick={handlePlayPause}>{isPlaying ? '⏸' : '▶'}</ActionIcon>
          <ActionIcon variant="light" color="gray" size="lg" title="Stop" onClick={handleStop}>■</ActionIcon>
          <ActionIcon variant={isRecording ? 'filled' : 'light'} color={isRecordReady || isRecording ? 'red' : 'gray'} size="xl" title={`Record Arm${armedCount > 0 ? ` (${armedCount} tracks armed)` : ' - arm tracks first'}`} onClick={handleRecord}>●</ActionIcon>
          <ActionIcon variant="light" color="gray" size="lg" title="Step Forward" onClick={() => dispatch({ type: 'SET_CURRENT_TIME', payload: currentTime + (60 / bpm) })}>▶▶</ActionIcon>
          {armedCount > 0 && <Badge color="red" variant="light">{armedCount} armed</Badge>}
        </Group>

        <Group gap="md" wrap="nowrap" style={{ flex: 1, justifyContent: 'center' }}>
          <Paper withBorder px="md" py={6} radius="md" style={{ background: '#0e131d', borderColor: '#2a3140', minWidth: 132 }}>
            <Stack gap={0} align="center">
              <Text ff="monospace" fw={700} size="lg" c="green.3">{formatTime(currentTime, bpm)}</Text>
              <Text ff="monospace" size="xs" c="dimmed">{formatClock(currentTime)}</Text>
            </Stack>
          </Paper>

          <Group gap="xs" wrap="nowrap">
            <Stack gap={2}>
              <Text size="xs" c="dimmed">BPM</Text>
              {editingBpm ? (
                <TextInput
                  value={bpmInput}
                  autoFocus
                  onChange={e => setBpmInput(e.currentTarget.value)}
                  onBlur={handleBpmCommit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleBpmCommit();
                    if (e.key === 'Escape') { setEditingBpm(false); setBpmInput(String(bpm)); }
                  }}
                  size="xs"
                  w={68}
                />
              ) : (
                <Paper withBorder px="sm" py={4} radius="md" onDoubleClick={() => { setEditingBpm(true); setBpmInput(String(bpm)); }} style={{ cursor: 'text', background: '#0e131d', borderColor: '#2a3140' }}>
                  <Text ff="monospace" c="yellow.3">{bpm}</Text>
                </Paper>
              )}
            </Stack>
            <Stack gap={2}>
              <ActionIcon size="sm" variant="light" color="gray" onClick={() => dispatch({ type: 'SET_BPM', payload: bpm + 1 })}>+</ActionIcon>
              <ActionIcon size="sm" variant="light" color="gray" onClick={() => dispatch({ type: 'SET_BPM', payload: Math.max(20, bpm - 1) })}>-</ActionIcon>
            </Stack>
          </Group>

          <NativeSelect
            label="Input"
            size="xs"
            value={selectedInputId}
            onChange={e => setSelectedInputId(e.currentTarget.value)}
            data={[
              { value: 'default', label: 'System Default' },
              ...inputOptions.map(device => ({
                value: device.deviceId,
                label: device.label || `Input ${device.deviceId.slice(0, 6)}`,
              })),
            ]}
            styles={{ input: { minWidth: 180 } }}
          />

          <ActionIcon variant="light" color="gray" size="lg" title="Refresh audio devices" onClick={() => { refreshInputs().catch(err => console.error('Failed to refresh audio devices:', err)); }}>↻</ActionIcon>

          <NativeSelect
            label="Time"
            size="xs"
            value={timeSignature}
            onChange={e => dispatch({ type: 'SET_TIME_SIGNATURE', payload: parseTimeSignature(e.currentTarget.value) })}
            data={TIME_SIGNATURE_OPTIONS}
          />
        </Group>

        <Group gap="md" wrap="nowrap">
          <Button size="xs" variant={loopEnabled ? 'filled' : 'light'} color={loopEnabled ? 'blue' : 'gray'} onClick={() => dispatch({ type: 'TOGGLE_LOOP' })}>Loop</Button>
          <Button size="xs" variant={metronomeEnabled ? 'filled' : 'light'} color={metronomeEnabled ? 'blue' : 'gray'} onClick={() => dispatch({ type: 'TOGGLE_METRONOME' })}>Click</Button>
          <Button size="xs" variant={snapEnabled ? 'filled' : 'light'} color={snapEnabled ? 'blue' : 'gray'} onClick={() => dispatch({ type: 'TOGGLE_SNAP' })}>Snap</Button>
          <Button size="xs" variant={autoScroll ? 'filled' : 'light'} color={autoScroll ? 'blue' : 'gray'} onClick={() => dispatch({ type: 'TOGGLE_AUTO_SCROLL' })}>Follow</Button>

          <Box w={110}>
            <Text size="xs" c="dimmed" mb={4}>Master {Math.round(masterVolume * 100)}%</Text>
            <Slider value={Math.round(masterVolume * 100)} onChange={value => dispatch({ type: 'SET_MASTER_VOLUME', payload: value / 100 })} size="sm" color="blue" label={value => `${value}%`} />
          </Box>
        </Group>
      </Group>
    </Paper>
  );
}
