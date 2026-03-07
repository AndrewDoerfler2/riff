import { useMemo } from 'react';
import {
  Box,
  Button,
  Divider,
  Grid,
  Group,
  NumberInput,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useDAW } from '../context/DAWContext';
import type { TimeSignature } from '../types/daw';

const TIME_SIGNATURE_OPTIONS: Array<{ value: TimeSignature; label: TimeSignature }> = [
  { value: '4/4', label: '4/4' },
  { value: '3/4', label: '3/4' },
  { value: '6/8', label: '6/8' },
  { value: '5/4', label: '5/4' },
  { value: '7/8', label: '7/8' },
];

function toggleToValue(
  nextChecked: boolean,
  currentChecked: boolean,
  toggle: () => void,
): void {
  if (nextChecked !== currentChecked) toggle();
}

export default function ProjectSettingsPanel() {
  const { state, dispatch } = useDAW();

  const loopLength = useMemo(
    () => Math.max(0, state.loopEnd - state.loopStart),
    [state.loopEnd, state.loopStart],
  );

  return (
    <Box p="md">
      <Stack gap="md">
        <Paper withBorder radius="md" p="md" style={{ background: '#101722', borderColor: '#273247' }}>
          <Stack gap="sm">
            <Text fw={700} c="gray.1">Project</Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Project name"
                  value={state.projectName}
                  onChange={event => dispatch({ type: 'SET_PROJECT_NAME', payload: event.currentTarget.value })}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, md: 3 }}>
                <NumberInput
                  label="Tempo (BPM)"
                  value={state.bpm}
                  min={20}
                  max={300}
                  onChange={(value) => {
                    if (typeof value === 'number' && Number.isFinite(value)) {
                      dispatch({ type: 'SET_BPM', payload: value });
                    }
                  }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, md: 3 }}>
                <Select
                  label="Time signature"
                  data={TIME_SIGNATURE_OPTIONS}
                  value={state.timeSignature}
                  onChange={(value) => {
                    if (value) dispatch({ type: 'SET_TIME_SIGNATURE', payload: value as TimeSignature });
                  }}
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </Paper>

        <Paper withBorder radius="md" p="md" style={{ background: '#101722', borderColor: '#273247' }}>
          <Stack gap="sm">
            <Text fw={700} c="gray.1">Transport Defaults</Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Switch
                  label="Loop enabled"
                  checked={state.loopEnabled}
                  onChange={event => toggleToValue(
                    event.currentTarget.checked,
                    state.loopEnabled,
                    () => dispatch({ type: 'TOGGLE_LOOP' }),
                  )}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Switch
                  label="Metronome enabled"
                  checked={state.metronomeEnabled}
                  onChange={event => toggleToValue(
                    event.currentTarget.checked,
                    state.metronomeEnabled,
                    () => dispatch({ type: 'TOGGLE_METRONOME' }),
                  )}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <NumberInput
                  label="Pre-roll bars"
                  value={state.preRollBars}
                  min={0}
                  max={4}
                  step={1}
                  onChange={(value) => {
                    if (typeof value === 'number' && Number.isFinite(value)) {
                      dispatch({ type: 'SET_PRE_ROLL_BARS', payload: value });
                    }
                  }}
                />
              </Grid.Col>
            </Grid>

            <Divider color="#273247" />

            <Grid>
              <Grid.Col span={{ base: 6, md: 3 }}>
                <NumberInput
                  label="Loop start (s)"
                  value={state.loopStart}
                  min={0}
                  max={Math.max(0, state.loopEnd - 0.1)}
                  step={0.1}
                  decimalScale={2}
                  onChange={(value) => {
                    if (typeof value === 'number' && Number.isFinite(value)) {
                      const nextStart = Math.max(0, Math.min(value, state.loopEnd - 0.1));
                      dispatch({ type: 'SET_LOOP_RANGE', payload: { start: nextStart, end: state.loopEnd } });
                    }
                  }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, md: 3 }}>
                <NumberInput
                  label="Loop end (s)"
                  value={state.loopEnd}
                  min={state.loopStart + 0.1}
                  step={0.1}
                  decimalScale={2}
                  onChange={(value) => {
                    if (typeof value === 'number' && Number.isFinite(value)) {
                      const nextEnd = Math.max(state.loopStart + 0.1, value);
                      dispatch({ type: 'SET_LOOP_RANGE', payload: { start: state.loopStart, end: nextEnd } });
                    }
                  }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Text size="sm" c="dimmed" mt={26}>
                  Loop length: {loopLength.toFixed(2)}s
                </Text>
              </Grid.Col>
            </Grid>
          </Stack>
        </Paper>

        <Paper withBorder radius="md" p="md" style={{ background: '#101722', borderColor: '#273247' }}>
          <Stack gap="sm">
            <Text fw={700} c="gray.1">Timeline & Monitoring</Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Switch
                  label="Snap to beat"
                  checked={state.snapEnabled}
                  onChange={event => toggleToValue(
                    event.currentTarget.checked,
                    state.snapEnabled,
                    () => dispatch({ type: 'TOGGLE_SNAP' }),
                  )}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Switch
                  label="Auto-scroll playback"
                  checked={state.autoScroll}
                  onChange={event => toggleToValue(
                    event.currentTarget.checked,
                    state.autoScroll,
                    () => dispatch({ type: 'TOGGLE_AUTO_SCROLL' }),
                  )}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Switch
                  label="Overdub mode"
                  checked={state.overdubEnabled}
                  onChange={event => toggleToValue(
                    event.currentTarget.checked,
                    state.overdubEnabled,
                    () => dispatch({ type: 'TOGGLE_OVERDUB' }),
                  )}
                />
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Text size="sm" c="dimmed" mb={6}>Zoom: {Math.round(state.zoom)} px/s</Text>
                <Slider
                  value={Math.round(state.zoom)}
                  min={20}
                  max={600}
                  step={1}
                  onChange={value => dispatch({ type: 'SET_ZOOM', payload: value })}
                  label={value => `${value} px/s`}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Text size="sm" c="dimmed" mb={6}>Master output: {Math.round(state.masterVolume * 100)}%</Text>
                <Slider
                  value={Math.round(state.masterVolume * 100)}
                  min={0}
                  max={100}
                  step={1}
                  onChange={value => dispatch({ type: 'SET_MASTER_VOLUME', payload: value / 100 })}
                  label={value => `${value}%`}
                />
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Text size="sm" c="dimmed" mb={6}>Master pan: {state.masterPan.toFixed(2)}</Text>
                <Slider
                  value={Math.round(state.masterPan * 100)}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={value => dispatch({ type: 'SET_MASTER_PAN', payload: value / 100 })}
                  label={value => `${value > 0 ? '+' : ''}${(value / 100).toFixed(2)}`}
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </Paper>

        <Group justify="flex-end">
          <Button
            variant="light"
            color="gray"
            onClick={() => dispatch({
              type: 'LOAD_PROJECT',
              payload: {
                bpm: 120,
                timeSignature: '4/4',
                loopEnabled: false,
                loopStart: 0,
                loopEnd: 8,
                metronomeEnabled: false,
                snapEnabled: true,
                preRollBars: 0,
                overdubEnabled: true,
                autoScroll: true,
                zoom: 100,
                masterVolume: 0.85,
                masterPan: 0,
              },
            })}
          >
            Reset Settings To Defaults
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
