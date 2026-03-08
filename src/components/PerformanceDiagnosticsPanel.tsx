import { useMemo } from 'react';
import {
  Badge,
  Box,
  Grid,
  Group,
  Paper,
  Progress,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useDAW } from '../context/DAWContext';
import {
  estimatePluginPerformance,
  sumPluginPerformance,
  formatCpuPercent,
  formatLatency,
} from '../lib/pluginPerformance';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cpuColor(pct: number): string {
  if (pct >= 30) return 'red';
  if (pct >= 12) return 'yellow';
  return 'teal';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateAudioBufferBytes(buf: AudioBuffer | null): number {
  if (!buf) return 0;
  // Float32 = 4 bytes per sample
  return buf.length * buf.numberOfChannels * 4;
}

interface StatChipProps {
  label: string;
  value: string | number;
  color?: string;
}

function StatChip({ label, value, color = 'gray' }: StatChipProps) {
  return (
    <Paper withBorder radius="sm" p="xs" style={{ background: '#0d1118', borderColor: '#252e3f' }}>
      <Stack gap={2} align="center">
        <Text size="lg" fw={700} c={`${color}.3`}>{value}</Text>
        <Text size="xs" c="dimmed">{label}</Text>
      </Stack>
    </Paper>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PerformanceDiagnosticsPanel() {
  const { state } = useDAW();
  const { tracks, masterPlugins } = state;

  const stats = useMemo(() => {
    let totalClips = 0;
    let totalVideoClips = 0;
    let totalMidiNotes = 0;
    let totalAutomationPoints = 0;
    let totalAutomationLanes = 0;
    let totalPlugins = 0;
    let audioBufferBytes = 0;
    let waveformPeakCount = 0;

    const trackCounts = { audio: 0, midi: 0, video: 0, bus: 0 };

    for (const track of tracks) {
      trackCounts[track.type] = (trackCounts[track.type] ?? 0) + 1;
      totalClips += track.clips.length;
      totalVideoClips += track.videoClips.length;
      totalPlugins += track.plugins.length;
      totalAutomationLanes += track.automationLanes.length;

      for (const lane of track.automationLanes) {
        totalAutomationPoints += lane.points.length;
      }

      for (const clip of track.clips) {
        totalMidiNotes += clip.midiNotes?.length ?? 0;
        totalMidiNotes += clip.drumHits?.length ?? 0;
        audioBufferBytes += estimateAudioBufferBytes(clip.audioBuffer);
        waveformPeakCount += clip.waveformPeaks.length;
      }
    }

    // Waveform peaks are stored as float32 (4 bytes each)
    const waveformBytes = waveformPeakCount * 4;

    return {
      trackCounts,
      totalTracks: tracks.length,
      totalClips,
      totalVideoClips,
      totalMidiNotes,
      totalAutomationLanes,
      totalAutomationPoints,
      totalPlugins: totalPlugins + masterPlugins.length,
      audioBufferBytes,
      waveformBytes,
    };
  }, [tracks, masterPlugins]);

  const pluginRows = useMemo(() => {
    return tracks
      .filter(t => t.plugins.length > 0)
      .map(track => {
        const chain = sumPluginPerformance(track.plugins);
        return {
          id: track.id,
          name: track.name,
          type: track.type,
          color: track.color,
          pluginCount: track.plugins.length,
          cpu: chain.cpuPercent,
          latency: chain.latencySamples,
          bypassedCount: track.plugins.filter(p => !p.enabled).length,
        };
      })
      .sort((a, b) => b.cpu - a.cpu);
  }, [tracks]);

  const masterChain = useMemo(() => sumPluginPerformance(masterPlugins), [masterPlugins]);

  const totalCpu = useMemo(() => {
    const tracksCpu = pluginRows.reduce((sum, r) => sum + r.cpu, 0);
    return Math.round((tracksCpu + masterChain.cpuPercent) * 10) / 10;
  }, [pluginRows, masterChain]);

  const cpuBarValue = Math.min(100, (totalCpu / 60) * 100); // 60% = full bar

  return (
    <Box p="md">
      <Stack gap="md">

        {/* ── Session Overview ──────────────────────────────────────────────── */}
        <Paper withBorder radius="md" p="md" style={{ background: '#101722', borderColor: '#273247' }}>
          <Stack gap="sm">
            <Text fw={700} c="gray.1" size="sm">Session Overview</Text>
            <Grid gutter="xs">
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Tracks" value={stats.totalTracks} color="blue" />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Audio" value={stats.trackCounts.audio} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="MIDI" value={stats.trackCounts.midi} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Video" value={stats.trackCounts.video} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Bus" value={stats.trackCounts.bus} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Clips" value={stats.totalClips} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="MIDI Notes" value={stats.totalMidiNotes} color="violet" />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Plugins" value={stats.totalPlugins} color="orange" />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Auto. Lanes" value={stats.totalAutomationLanes} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Auto. Points" value={stats.totalAutomationPoints} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, xs: 4, sm: 3, md: 2 }}>
                <StatChip label="Video Clips" value={stats.totalVideoClips} />
              </Grid.Col>
            </Grid>
          </Stack>
        </Paper>

        {/* ── CPU Estimates ─────────────────────────────────────────────────── */}
        <Paper withBorder radius="md" p="md" style={{ background: '#101722', borderColor: '#273247' }}>
          <Stack gap="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700} c="gray.1" size="sm">Estimated Plugin CPU</Text>
              <Badge color={cpuColor(totalCpu)} variant="light">
                {formatCpuPercent(totalCpu)} total
              </Badge>
            </Group>

            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed">Total load</Text>
                <Text size="xs" c="dimmed">{totalCpu.toFixed(1)}% / ~60% ceiling</Text>
              </Group>
              <Progress
                value={cpuBarValue}
                color={cpuColor(totalCpu)}
                radius="xl"
                size="sm"
              />
            </Stack>

            {(pluginRows.length > 0 || masterPlugins.length > 0) && (
              <Box style={{ overflowX: 'auto' }}>
                <Table
                  striped
                  highlightOnHover
                  withTableBorder={false}
                  withColumnBorders={false}
                  fz="xs"
                  styles={{
                    table: { background: 'transparent' },
                    tr: { borderColor: '#1e2633' },
                  }}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Track</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Plugins</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Est. CPU</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Latency</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {pluginRows.map(row => (
                      <Table.Tr key={row.id}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Box
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: row.color,
                                flexShrink: 0,
                              }}
                            />
                            <Text size="xs" truncate style={{ maxWidth: 140 }}>{row.name}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color="gray">{row.type}</Badge>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text size="xs" c="dimmed">
                            {row.pluginCount}
                            {row.bypassedCount > 0 && (
                              <Text span c="yellow.6"> ({row.bypassedCount} bp)</Text>
                            )}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text size="xs" c={cpuColor(row.cpu) === 'teal' ? 'teal.4' : cpuColor(row.cpu) === 'yellow' ? 'yellow.4' : 'red.4'}>
                            {formatCpuPercent(row.cpu)}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text size="xs" c="dimmed">{formatLatency(row.latency)}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}

                    {masterPlugins.length > 0 && (
                      <Table.Tr>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Box
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: '#5c6bc0',
                                flexShrink: 0,
                              }}
                            />
                            <Text size="xs" c="blue.3">Master Chain</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color="blue">master</Badge>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text size="xs" c="dimmed">{masterPlugins.length}</Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text size="xs" c={cpuColor(masterChain.cpuPercent) === 'teal' ? 'teal.4' : cpuColor(masterChain.cpuPercent) === 'yellow' ? 'yellow.4' : 'red.4'}>
                            {formatCpuPercent(masterChain.cpuPercent)}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text size="xs" c="dimmed">{formatLatency(masterChain.latencySamples)}</Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Box>
            )}

            {pluginRows.length === 0 && masterPlugins.length === 0 && (
              <Text size="xs" c="dimmed">No plugins loaded — add FX to tracks or the master chain to see estimates.</Text>
            )}

            <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
              * CPU figures are heuristic estimates based on plugin type and parameters, not live measurements.
            </Text>
          </Stack>
        </Paper>

        {/* ── Memory Estimates ──────────────────────────────────────────────── */}
        <Paper withBorder radius="md" p="md" style={{ background: '#101722', borderColor: '#273247' }}>
          <Stack gap="sm">
            <Text fw={700} c="gray.1" size="sm">Memory Estimates</Text>
            <Grid gutter="xs">
              <Grid.Col span={{ base: 6, sm: 4 }}>
                <StatChip
                  label="Audio Buffers"
                  value={formatBytes(stats.audioBufferBytes)}
                  color={stats.audioBufferBytes > 200 * 1024 * 1024 ? 'red' : stats.audioBufferBytes > 80 * 1024 * 1024 ? 'yellow' : 'teal'}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 4 }}>
                <StatChip
                  label="Waveform Cache"
                  value={formatBytes(stats.waveformBytes)}
                  color="gray"
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 4 }}>
                <StatChip
                  label="Total (est.)"
                  value={formatBytes(stats.audioBufferBytes + stats.waveformBytes)}
                  color={stats.audioBufferBytes + stats.waveformBytes > 250 * 1024 * 1024 ? 'red' : 'teal'}
                />
              </Grid.Col>
            </Grid>
            <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
              * Audio buffer memory is approximate (Float32 × channels × samples). Browser heap usage may differ.
            </Text>
          </Stack>
        </Paper>

        {/* ── Per-plugin breakdown for selected track ───────────────────────── */}
        {state.selectedTrackId && (() => {
          const track = tracks.find(t => t.id === state.selectedTrackId);
          if (!track || track.plugins.length === 0) return null;
          return (
            <Paper withBorder radius="md" p="md" style={{ background: '#101722', borderColor: '#273247' }}>
              <Stack gap="sm">
                <Group gap="xs" wrap="nowrap">
                  <Box style={{ width: 10, height: 10, borderRadius: '50%', background: track.color }} />
                  <Text fw={700} c="gray.1" size="sm">Selected Track: {track.name}</Text>
                </Group>
                <Box style={{ overflowX: 'auto' }}>
                  <Table
                    striped
                    highlightOnHover
                    withTableBorder={false}
                    fz="xs"
                    styles={{
                      table: { background: 'transparent' },
                      tr: { borderColor: '#1e2633' },
                    }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Plugin</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Status</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Est. CPU</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>Latency</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {track.plugins.map((plugin) => {
                        const perf = estimatePluginPerformance(plugin);
                        return (
                          <Table.Tr key={plugin.id}>
                            <Table.Td>
                              <Text size="xs">{plugin.name}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Badge size="xs" variant="light" color="gray">{plugin.type}</Badge>
                            </Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>
                              <Badge size="xs" variant="light" color={plugin.enabled ? 'teal' : 'gray'}>
                                {plugin.enabled ? 'ON' : 'BP'}
                              </Badge>
                            </Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>
                              <Text size="xs" c={plugin.enabled ? 'teal.4' : 'dimmed'}>
                                {formatCpuPercent(perf.cpuPercent)}
                              </Text>
                            </Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>
                              <Text size="xs" c="dimmed">{formatLatency(perf.latencySamples)}</Text>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Box>
                <Text size="xs" c="dimmed">
                  Chain total: {formatCpuPercent(sumPluginPerformance(track.plugins).cpuPercent)}
                  {' · '}
                  {formatLatency(sumPluginPerformance(track.plugins).latencySamples)} latency
                </Text>
              </Stack>
            </Paper>
          );
        })()}

      </Stack>
    </Box>
  );
}
