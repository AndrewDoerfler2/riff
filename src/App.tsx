import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Flex,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { DAWProvider, AudioEngineProvider, useDAW } from './context/DAWContext';
import Transport from './components/Transport';
import Timeline from './components/Timeline';
import Mixer from './components/Mixer';
import AIPanel from './components/AIPanel';
import PluginRack from './components/PluginRack';
import VideoEditor from './components/VideoEditor';
import ProjectSettingsPanel from './components/ProjectSettingsPanel';
import PerformanceDiagnosticsPanel from './components/PerformanceDiagnosticsPanel';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import {
  saveProjectLocally,
  loadProjectLocally,
  downloadProjectFile,
  loadProjectFromFile,
  hasSavedProject,
} from './lib/projectPersistence';
import {
  exportProjectMixToWav,
  exportProjectTrackStemsToWav,
  type CancelToken,
} from './lib/audioExport';
import { runBouncePreflightAnalysis, type PreflightReport } from './lib/bouncePreflightAnalyzer';
import { buildLoudnessPresetMasterChain } from './lib/mixAssistant';
import BouncePreflightModal from './components/BouncePreflightModal';
import './App.css';

// ─── Save status type ──────────────────────────────────────────────────────────

type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';
type ProjectLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

// ─── Export operation state ────────────────────────────────────────────────────

interface ExportOp {
  kind: 'mix' | 'stems';
  label: string;
  done: number;
  total: number;
  error: string | null;
}

// ─── Inner App (has access to DAW context) ────────────────────────────────────

function DAWApp() {
  const { state, dispatch } = useDAW();
  const { activePanel } = state;
  const [bottomPanelHeight, setBottomPanelHeight] = useState(320);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('unsaved');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);
  const isInitialMount = useRef(true);
  const lastStructureCountsRef = useRef({ tracks: state.tracks.length, clips: 0 });
  const [exportOp, setExportOp] = useState<ExportOp | null>(null);
  const cancelExportRef = useRef<CancelToken>({ cancelled: false });
  const [preflight, setPreflight] = useState<{ report: PreflightReport; kind: 'mix' | 'stems' } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [projectLoadStatus, setProjectLoadStatus] = useState<ProjectLoadStatus>('idle');
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);

  const getPanelMinHeight = useCallback(() => (window.innerWidth <= 900 ? 180 : 220), []);

  const getTotalClipCount = useCallback(() => (
    state.tracks.reduce((sum, track) => sum + track.clips.length, 0)
  ), [state.tracks]);

  // ── Auto-load on first mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!hasSavedProject()) return;
    setProjectLoadStatus('loading');
    setProjectLoadError(null);
    loadProjectLocally()
      .then(partial => {
        if (partial) {
          dispatch({ type: 'LOAD_PROJECT', payload: partial });
          setSaveStatus('saved');
        }
        setProjectLoadStatus('loaded');
        window.setTimeout(() => {
          setProjectLoadStatus(current => (current === 'loaded' ? 'idle' : current));
        }, 2400);
      })
      .catch(err => {
        console.error('riff: auto-load failed', err);
        setProjectLoadStatus('error');
        setProjectLoadError(err instanceof Error ? err.message : 'Failed to load local project.');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save with 5s debounce on state changes ────────────────────────────
  useEffect(() => {
    const currentCounts = {
      tracks: state.tracks.length,
      clips: getTotalClipCount(),
    };

    if (isInitialMount.current) {
      isInitialMount.current = false;
      lastStructureCountsRef.current = currentCounts;
      return;
    }

    const previousCounts = lastStructureCountsRef.current;
    const isDeletion =
      currentCounts.tracks < previousCounts.tracks
      || currentCounts.clips < previousCounts.clips;
    lastStructureCountsRef.current = currentCounts;

    setSaveStatus('unsaved');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const persist = () => {
      setSaveStatus('saving');
      saveProjectLocally(state)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
    };

    if (isDeletion) {
      persist();
    } else {
      autoSaveTimerRef.current = setTimeout(persist, 5000);
    }

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [getTotalClipCount, state]);

  const handleSaveNow = useCallback(() => {
    setSaveStatus('saving');
    saveProjectLocally(state)
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('error'));
  }, [state]);

  const handleDownload = useCallback(() => {
    downloadProjectFile(state);
  }, [state]);

  // ── Internal execute helpers (called after preflight passes/is dismissed) ──

  const executeBounceWav = useCallback(async () => {
    const cancel: CancelToken = { cancelled: false };
    cancelExportRef.current = cancel;
    setExportOp({ kind: 'mix', label: 'Setting up…', done: 0, total: 2, error: null });
    try {
      const mixdown = await exportProjectMixToWav(
        state,
        (done, total, label) => setExportOp(o => o ? { ...o, done, total, label } : o),
        cancel,
      );
      if (cancel.cancelled || !mixdown.blob.size) { setExportOp(null); return; }
      setExportOp(o => o ? { ...o, label: 'Downloading…', done: 2, total: 2 } : o);
      const url = URL.createObjectURL(mixdown.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mixdown.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportOp(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export WAV mixdown.';
      console.error('riff: WAV export failed', err);
      setExportOp(o => o ? { ...o, error: message } : o);
    }
  }, [state]);

  const executeExportStems = useCallback(async () => {
    const cancel: CancelToken = { cancelled: false };
    cancelExportRef.current = cancel;
    setExportOp({ kind: 'stems', label: 'Preparing stems…', done: 0, total: 1, error: null });
    try {
      const stems = await exportProjectTrackStemsToWav(
        state,
        (done, total, label) => setExportOp(o => o ? { ...o, done, total, label } : o),
        cancel,
      );
      if (cancel.cancelled) { setExportOp(null); return; }
      setExportOp(o => o ? { ...o, label: 'Downloading files…' } : o);
      for (const stem of stems) {
        const url = URL.createObjectURL(stem.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = stem.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        await new Promise<void>(r => setTimeout(r, 80));
      }
      setExportOp(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export stems.';
      console.error('riff: stem export failed', err);
      setExportOp(o => o ? { ...o, error: message } : o);
    }
  }, [state]);

  // ── Preflight gate ─────────────────────────────────────────────────────────

  const handleBounceWav = useCallback(() => {
    if (exportOp) return;
    const report = runBouncePreflightAnalysis(state.tracks, state.masterPlugins);
    if (report.isClean) {
      void executeBounceWav();
    } else {
      setPreflight({ report, kind: 'mix' });
    }
  }, [exportOp, state.tracks, state.masterPlugins, executeBounceWav]);

  const handleExportStems = useCallback(() => {
    if (exportOp) return;
    const report = runBouncePreflightAnalysis(state.tracks, state.masterPlugins);
    if (report.isClean) {
      void executeExportStems();
    } else {
      setPreflight({ report, kind: 'stems' });
    }
  }, [exportOp, state.tracks, state.masterPlugins, executeExportStems]);

  const handlePreflightProceed = useCallback(() => {
    if (!preflight) return;
    const kind = preflight.kind;
    setPreflight(null);
    if (kind === 'mix') void executeBounceWav();
    else void executeExportStems();
  }, [preflight, executeBounceWav, executeExportStems]);

  const handlePreflightCancel = useCallback(() => {
    setPreflight(null);
  }, []);

  const handlePreflightAutoAdjust = useCallback(() => {
    if (!preflight?.report.loudness) return;
    const preset = preflight.report.loudness.suggestedPreset;
    const { compressor, limiter } = buildLoudnessPresetMasterChain(preset, state.tracks);
    dispatch({ type: 'APPLY_LOUDNESS_PRESET', payload: { preset, compressor, limiter } });
    const projectedMasterPlugins = [
      ...state.masterPlugins.filter(
        p => !p.id.startsWith('compressor-lufs-') && !p.id.startsWith('limiter-lufs-'),
      ),
      compressor,
      limiter,
    ];
    const refreshed = runBouncePreflightAnalysis(state.tracks, projectedMasterPlugins);
    setPreflight(current => (current ? { ...current, report: refreshed } : current));
  }, [dispatch, preflight, state.masterPlugins, state.tracks]);

  const handleDismissExport = useCallback(() => {
    cancelExportRef.current.cancelled = true;
    setExportOp(null);
  }, []);

  const handleOpenFile = useCallback(() => {
    loadInputRef.current?.click();
  }, []);

  const handleFileChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const partial = await loadProjectFromFile(file);
      dispatch({ type: 'LOAD_PROJECT', payload: partial });
      setSaveStatus('unsaved');
      setProjectLoadStatus('loaded');
      setProjectLoadError(null);
      window.setTimeout(() => {
        setProjectLoadStatus(current => (current === 'loaded' ? 'idle' : current));
      }, 2400);
    } catch (err) {
      console.error('riff: failed to open project file', err);
      setProjectLoadStatus('error');
      setProjectLoadError(err instanceof Error ? err.message : 'Failed to open project file.');
    }
  }, [dispatch]);

  const handleNewProject = useCallback(() => {
    const hasContent = state.tracks.some(t => t.clips.length > 0);
    if (hasContent && !window.confirm('Start a new project? Unsaved changes will be lost.')) return;
    dispatch({ type: 'LOAD_PROJECT', payload: {
      projectName: 'Untitled Project',
      tracks: [],
      bpm: 120,
      timeSignature: '4/4',
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 8,
      metronomeEnabled: false,
      snapEnabled: true,
      preRollBars: 0,
      overdubEnabled: true,
      masterVolume: 0.85,
      masterPan: 0,
      zoom: 100,
      scrollLeft: 0,
      autoScroll: true,
    }});
    setSaveStatus('unsaved');
  }, [state.tracks, dispatch]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_PROJECT_NAME', payload: e.target.value });
  }, [dispatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault();
        handleSaveNow();
        return;
      }

      if (event.key === '?' || (event.code === 'Slash' && event.shiftKey)) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveNow]);

  const setPanel = useCallback((panel: typeof activePanel) => {
    dispatch({ type: 'SET_ACTIVE_PANEL', payload: panel === activePanel ? null : panel });
  }, [activePanel, dispatch]);

  const startBottomPanelResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeStateRef.current = {
      startY: e.clientY,
      startHeight: bottomPanelHeight,
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const nextHeight = resizeStateRef.current.startHeight + (resizeStateRef.current.startY - moveEvent.clientY);
      setBottomPanelHeight(Math.max(getPanelMinHeight(), Math.min(window.innerHeight * 0.7, nextHeight)));
    };

    const onMouseUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [bottomPanelHeight, getPanelMinHeight]);

  useEffect(() => {
    const syncPanelHeightToViewport = () => {
      const nextMax = window.innerHeight * 0.7;
      const nextMin = getPanelMinHeight();
      setBottomPanelHeight(current => Math.max(nextMin, Math.min(nextMax, current)));
    };
    syncPanelHeightToViewport();
    window.addEventListener('resize', syncPanelHeightToViewport);
    return () => window.removeEventListener('resize', syncPanelHeightToViewport);
  }, [getPanelMinHeight]);

  const saveLabel =
    saveStatus === 'saving' ? '⏳ Saving…'
    : saveStatus === 'saved' ? '✓ Saved'
    : saveStatus === 'error' ? '⚠ Error'
    : '● Unsaved';

  const statusColor =
    saveStatus === 'saved' ? 'green'
    : saveStatus === 'saving' ? 'yellow'
    : saveStatus === 'error' ? 'red'
    : 'orange';

  return (
    <Box
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #0f1218 0%, #0a0d12 100%)',
      }}
    >
      <Paper
        component="header"
        className="app-topbar"
        radius={0}
        withBorder
        px="md"
        py="xs"
        style={{
          borderTop: 0,
          borderLeft: 0,
          borderRight: 0,
          borderColor: '#232937',
          background: 'rgba(18, 22, 30, 0.96)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <Group className="app-topbar-row" justify="space-between" wrap="nowrap">
          <Group className="app-topbar-brand" gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <Group gap={8} wrap="nowrap">
              <Text fw={700} size="lg" c="blue.2">RIFF</Text>
              <Badge variant="light" color="gray" radius="sm">DAW</Badge>
            </Group>
            <Group className="app-project-group" gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
              <TextInput
                className="app-project-name-input"
                value={state.projectName}
                onChange={handleNameChange}
                aria-label="Project name"
                size="xs"
                style={{ width: 220, minWidth: 160 }}
                styles={{
                  input: {
                    background: '#141925',
                    borderColor: '#2a3140',
                    color: '#edf2ff',
                  },
                }}
              />
              <Badge color={statusColor} variant="light">
                {saveLabel}
              </Badge>
              {projectLoadStatus === 'loading' && (
                <Badge color="blue" variant="light">Loading project…</Badge>
              )}
              {projectLoadStatus === 'loaded' && (
                <Badge color="teal" variant="light">Project loaded</Badge>
              )}
            </Group>
          </Group>

          <Group className="app-file-actions" gap="xs" wrap="nowrap">
            <Button size="xs" variant="light" color="gray" onClick={handleNewProject}>New</Button>
            <Button size="xs" variant="light" color="gray" onClick={handleSaveNow}>Save</Button>
            <Button size="xs" variant="filled" color="blue" onClick={handleBounceWav} disabled={!!exportOp}>
              Bounce WAV
            </Button>
            <Button size="xs" variant="light" color="blue" onClick={handleExportStems} disabled={!!exportOp}>
              Export Stems
            </Button>
            <Button size="xs" variant="light" color="gray" onClick={handleDownload}>Export</Button>
            <Button size="xs" variant="light" color="gray" onClick={handleOpenFile}>Open...</Button>
            <input
              ref={loadInputRef}
              type="file"
              accept=".riff,.json"
              style={{ display: 'none' }}
              onChange={handleFileChosen}
            />
          </Group>

          <Group className="app-panel-actions" gap="xs" wrap="nowrap">
            <Button size="xs" variant="light" color="gray" onClick={() => setShortcutsOpen(true)}>Shortcuts</Button>
            {([
              { id: 'ai' as const, label: 'AI' },
              { id: 'plugins' as const, label: 'FX' },
              { id: 'mixer' as const, label: 'Mixer' },
              { id: 'video' as const, label: 'Video' },
              { id: 'settings' as const, label: 'Settings' },
              { id: 'perf' as const, label: 'Perf' },
            ] as const).map((panel) => (
              <Button
                key={panel.id}
                size="xs"
                variant={activePanel === panel.id ? 'filled' : 'light'}
                color={activePanel === panel.id ? 'blue' : 'gray'}
                onClick={() => setPanel(panel.id)}
              >
                {panel.label}
              </Button>
            ))}
          </Group>
        </Group>
      </Paper>

      {projectLoadError && (
        <Paper
          className="app-inline-error"
          radius={0}
          withBorder
          px="md"
          py={6}
          style={{
            borderLeft: 0,
            borderRight: 0,
            borderTop: 0,
            borderColor: '#48252b',
            background: 'rgba(95, 29, 39, 0.72)',
          }}
        >
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm" c="red.1">
              Project load error: {projectLoadError}
            </Text>
            <CloseButton
              aria-label="Dismiss project load error"
              onClick={() => {
                setProjectLoadError(null);
                setProjectLoadStatus('idle');
              }}
            />
          </Group>
        </Paper>
      )}

      <Transport />

      <Box style={{ flex: 1, minHeight: 0 }}>
        <Timeline />
      </Box>

      {activePanel && (
        <Paper
          className="app-bottom-panel"
          withBorder
          radius={0}
          style={{
            height: bottomPanelHeight,
            background: '#0f141d',
            borderLeft: 0,
            borderRight: 0,
            borderBottom: 0,
            borderColor: '#232937',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 220,
          }}
        >
          <Box
            className="app-bottom-panel-resizer"
            onMouseDown={startBottomPanelResize}
            title="Resize panel"
            style={{
              height: 8,
              cursor: 'ns-resize',
              background: 'linear-gradient(90deg, #1a2130 0%, #33415c 50%, #1a2130 100%)',
            }}
          />
          <Group className="app-bottom-panel-tabs" justify="space-between" px="md" py="xs" style={{ borderBottom: '1px solid #232937' }}>
            <Group className="app-bottom-tab-buttons" gap="xs">
              {([
                { id: 'ai' as const, label: 'AI Backing Track' },
                { id: 'plugins' as const, label: 'Plugin Rack' },
                { id: 'mixer' as const, label: 'Mixer' },
                { id: 'video' as const, label: 'Video Editor' },
                { id: 'settings' as const, label: 'Project Settings' },
                { id: 'perf' as const, label: 'Performance' },
              ] as const).map((tab) => (
                <Button
                  key={tab.id}
                  size="xs"
                  variant={activePanel === tab.id ? 'filled' : 'subtle'}
                  color={activePanel === tab.id ? 'blue' : 'gray'}
                  onClick={() => setPanel(tab.id)}
                >
                  {tab.label}
                </Button>
              ))}
            </Group>
            <CloseButton
              onClick={() => dispatch({ type: 'SET_ACTIVE_PANEL', payload: null })}
              aria-label="Close panel"
            />
          </Group>
          <Box style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {activePanel === 'ai' && <AIPanel />}
            {activePanel === 'plugins' && <PluginRack />}
            {activePanel === 'mixer' && <Mixer />}
            {activePanel === 'video' && <VideoEditor />}
            {activePanel === 'settings' && <ProjectSettingsPanel />}
            {activePanel === 'perf' && <PerformanceDiagnosticsPanel />}
          </Box>
        </Paper>
      )}

      {preflight && (
        <BouncePreflightModal
          report={preflight.report}
          exportKind={preflight.kind}
          onProceed={handlePreflightProceed}
          onCancel={handlePreflightCancel}
          onAutoAdjust={handlePreflightAutoAdjust}
        />
      )}

      <KeyboardShortcutsModal opened={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {exportOp && (
        <Box
          role="dialog"
          aria-modal="true"
          aria-label="Export progress"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(4, 6, 10, 0.66)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 400,
          }}
        >
          <Paper
            withBorder
            radius="lg"
            p="lg"
            shadow="xl"
            style={{
              width: 420,
              maxWidth: 'calc(100vw - 32px)',
              background: '#121722',
              borderColor: '#2a3140',
            }}
          >
            <Stack gap="md">
              <Text fw={700} size="lg" c="gray.0">
                {exportOp.error
                  ? (exportOp.kind === 'mix' ? 'Bounce Failed' : 'Stem Export Failed')
                  : (exportOp.kind === 'mix' ? 'Bouncing Mix...' : 'Exporting Stems...')}
              </Text>
              {exportOp.error ? (
                <>
                  <Text c="red.3">{exportOp.error}</Text>
                  <Button onClick={handleDismissExport}>Dismiss</Button>
                </>
              ) : (
                <>
                  <Text c="dimmed">{exportOp.label}</Text>
                  {exportOp.total > 1 && (
                    <Stack gap={6}>
                      <Progress value={Math.round((exportOp.done / exportOp.total) * 100)} color="blue" radius="xl" />
                      <Text size="sm" c="dimmed">{exportOp.done} / {exportOp.total}</Text>
                    </Stack>
                  )}
                  {exportOp.kind === 'stems' && (
                    <Button variant="light" color="gray" onClick={handleDismissExport}>Cancel</Button>
                  )}
                </>
              )}
            </Stack>
          </Paper>
        </Box>
      )}

      <Paper
        className="app-status-bar"
        radius={0}
        withBorder
        px="md"
        py={6}
        style={{
          borderLeft: 0,
          borderRight: 0,
          borderBottom: 0,
          borderColor: '#232937',
          background: '#0d1118',
        }}
      >
        <Flex justify="space-between" gap="md" wrap="wrap">
          <Group gap="xs">
            <Text size="xs" c="dimmed">Tracks: {state.tracks.length}</Text>
            <Text size="xs" c="dimmed">Armed: {state.tracks.filter(t => t.armed).length}</Text>
            <Text size="xs" c="dimmed">BPM: {state.bpm}</Text>
            <Text size="xs" c="dimmed">Zoom: {state.zoom.toFixed(0)}px/s</Text>
            <Badge color={state.isRecording ? 'red' : state.isPlaying ? 'green' : 'gray'} variant="light">
              {state.isRecording ? 'REC' : state.isPlaying ? 'PLAYING' : 'STOPPED'}
            </Badge>
          </Group>
          <Text className="app-status-hint" size="xs" c="dimmed">
            riff DAW v0.1.0 | Space: Play/Pause | Home: Rewind | Ctrl/Cmd+Z: Undo/Redo | Ctrl+Scroll: Zoom | Ctrl/Cmd+S: Save | ?: Shortcuts
          </Text>
        </Flex>
      </Paper>
    </Box>
  );
}

// ─── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <DAWProvider>
      <AudioEngineProvider>
        <DAWApp />
      </AudioEngineProvider>
    </DAWProvider>
  );
}
