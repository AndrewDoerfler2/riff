import { Group, Kbd, Modal, Stack, Table, Text, Title } from '@mantine/core';

interface ShortcutItem {
  keys: string[];
  action: string;
  scope: string;
}

const SHORTCUT_GROUPS: Array<{ title: string; items: ShortcutItem[] }> = [
  {
    title: 'Transport',
    items: [
      { keys: ['Space'], action: 'Play / Pause', scope: 'Global' },
      { keys: ['Home'], action: 'Rewind to project start', scope: 'Global' },
      { keys: ['Ctrl/Cmd', 'S'], action: 'Save project now', scope: 'Global' },
      { keys: ['?'], action: 'Open keyboard shortcuts', scope: 'Global' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: ['Ctrl/Cmd', 'Z'], action: 'Undo', scope: 'Global' },
      { keys: ['Ctrl/Cmd', 'Shift', 'Z'], action: 'Redo', scope: 'Global' },
      { keys: ['Ctrl/Cmd', 'Y'], action: 'Redo', scope: 'Global' },
    ],
  },
  {
    title: 'Timeline Editing',
    items: [
      { keys: ['Ctrl/Cmd', 'A'], action: 'Select all clips', scope: 'Timeline' },
      { keys: ['S'], action: 'Split selected clips at playhead', scope: 'Timeline' },
      { keys: ['Delete / Backspace'], action: 'Delete selected clips/tracks', scope: 'Timeline' },
    ],
  },
];

type KeyboardShortcutsModalProps = {
  opened: boolean;
  onClose: () => void;
};

export default function KeyboardShortcutsModal({ opened, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Keyboard shortcuts"
      centered
      size="lg"
      overlayProps={{ backgroundOpacity: 0.62, blur: 2 }}
      styles={{
        content: { background: '#111722', border: '1px solid #2a3140' },
        header: { background: '#111722' },
        title: { color: '#edf2ff', fontWeight: 700 },
      }}
    >
      <Stack gap="lg">
        {SHORTCUT_GROUPS.map((group) => (
          <Stack key={group.title} gap={6}>
            <Title order={5} c="gray.1">{group.title}</Title>
            <Table withRowBorders={false} striped={false} verticalSpacing="xs">
              <Table.Tbody>
                {group.items.map((item) => (
                  <Table.Tr key={`${group.title}:${item.action}`}>
                    <Table.Td w={220}>
                      <Group gap={6}>
                        {item.keys.map((key) => (
                          <Kbd key={`${item.action}:${key}`}>{key}</Kbd>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text c="gray.2" size="sm">{item.action}</Text>
                    </Table.Td>
                    <Table.Td w={90}>
                      <Text c="dimmed" size="xs">{item.scope}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        ))}
      </Stack>
    </Modal>
  );
}
