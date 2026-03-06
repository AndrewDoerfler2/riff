import { Badge, Button, Group, Modal, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import type { PreflightReport, PreflightWarning } from '../lib/bouncePreflightAnalyzer';

interface Props {
  report: PreflightReport;
  exportKind: 'mix' | 'stems';
  onProceed: () => void;
  onCancel: () => void;
  onAutoAdjust: () => void;
}

function SeverityIcon({ severity }: { severity: PreflightWarning['severity'] }) {
  if (severity === 'error') return <ThemeIcon color="red" variant="light" radius="xl">✕</ThemeIcon>;
  if (severity === 'warning') return <ThemeIcon color="yellow" variant="light" radius="xl">⚠</ThemeIcon>;
  return <ThemeIcon color="blue" variant="light" radius="xl">i</ThemeIcon>;
}

function formatPresetLabel(preset: NonNullable<PreflightReport['loudness']>['suggestedPreset']): string {
  return preset.charAt(0).toUpperCase() + preset.slice(1);
}

export default function BouncePreflightModal({ report, exportKind, onProceed, onCancel, onAutoAdjust }: Props) {
  const label = exportKind === 'mix' ? 'Bounce WAV' : 'Export Stems';
  const errors = report.warnings.filter(w => w.severity === 'error');
  const others = report.warnings.filter(w => w.severity !== 'error');
  const ordered = [...errors, ...others];

  const headlineText = report.hasErrors
    ? `${errors.length} issue${errors.length > 1 ? 's' : ''} may cause clipping`
    : report.hasWarnings
      ? 'Heads up before you bounce'
      : 'Ready to bounce';

  return (
    <Modal
      opened
      onClose={onCancel}
      title={headlineText}
      centered
      size="lg"
      withCloseButton={false}
      styles={{
        content: { background: '#121722', border: '1px solid #2a3140' },
        header: { background: '#121722' },
        title: { color: '#edf2ff', fontWeight: 700 },
      }}
    >
      <Stack gap="md">
        <Group>
          <Badge
            color={report.hasErrors ? 'red' : report.hasWarnings ? 'yellow' : 'green'}
            variant="light"
          >
            {report.hasErrors ? 'Errors' : report.hasWarnings ? 'Warnings' : 'Clean'}
          </Badge>
          <Text size="sm" c="dimmed">{exportKind === 'mix' ? 'Bounce WAV' : 'Export Stems'}</Text>
        </Group>

        {report.loudness && (
          <Paper withBorder p="md" radius="md" style={{ background: '#0f141d', borderColor: '#2a3140' }}>
            <Stack gap={6}>
              <Text fw={600}>Loudness Preview</Text>
              <Group gap="md">
                <Text size="sm">{report.loudness.integratedLufs.toFixed(1)} LUFS</Text>
                <Text size="sm">{report.loudness.truePeakDbfs.toFixed(1)} dBTP</Text>
              </Group>
              <Text size="sm" c="dimmed">
                Target {formatPresetLabel(report.loudness.suggestedPreset)}: {report.loudness.targetLufs.toFixed(1)} LUFS / {report.loudness.targetTruePeakDbfs.toFixed(1)} dBTP
              </Text>
            </Stack>
          </Paper>
        )}

        {report.isClean ? (
          <Text c="dimmed">No issues found. Proceeding with {label.toLowerCase()}...</Text>
        ) : (
          <Stack gap="sm">
            {ordered.map((warning, index) => (
              <Group
                key={`${warning.severity}-${index}`}
                align="flex-start"
                wrap="nowrap"
                p="sm"
                style={{
                  borderRadius: 10,
                  background: '#0f141d',
                  border: `1px solid ${
                    warning.severity === 'error' ? '#5c262b' : warning.severity === 'warning' ? '#5c4d24' : '#243b5c'
                  }`,
                }}
              >
                <SeverityIcon severity={warning.severity} />
                <Stack gap={2}>
                  <Text size="sm">{warning.message}</Text>
                  {warning.detail && <Text size="xs" c="dimmed">{warning.detail}</Text>}
                </Stack>
              </Group>
            ))}
          </Stack>
        )}

        <Group justify="flex-end">
          <Button variant="light" color="gray" onClick={onCancel}>
            Cancel
          </Button>
          {report.loudness && (
            <Button variant="light" color="blue" onClick={onAutoAdjust}>
              Auto Adjust ({formatPresetLabel(report.loudness.suggestedPreset)})
            </Button>
          )}
          <Button color={report.hasErrors ? 'red' : 'blue'} onClick={onProceed}>
            {report.hasErrors ? `${label} Anyway` : label}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
