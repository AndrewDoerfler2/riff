# riff DAW - Iteration Roadmap

This file is read by the automated improvement task that runs every 2 hours.
Each run picks the next unchecked item from the queue below, implements it,
and checks it off. Multiple related items may be completed in one run if they
are tightly coupled.

## Current State

Riff currently supports:

- Multitrack audio, MIDI, video, and bus tracks
- Recording, playback, trimming, import, zoom, and waveform display
- Plugin rack, mixer, bus routing, master chain, animated meters
- AI backing-track generation with take history and per-track regenerate
- AI-generated MIDI conversion plus linked audio<->MIDI editing workflow
- Project persistence (`localStorage`, IndexedDB, `.riff` export/import)
- WAV mix bounce, stem export, and bounce preflight analysis
- AI mix analysis, EQ suggestions, dynamics suggestions, masking detection, auto bus setup, and loudness targeting

## Recent Progress

- AI-generated takes now commit as linked audio + MIDI pairs, and MIDI edits can auto-refresh linked audio renders.
- Bounce preflight now includes loudness preview, true peak/LUFS estimates, and one-click master auto-adjust.
- Mixer AI assistant has been split into a dedicated component/hook structure for easier iteration.
- Project persistence, export/import, and schema-version tests are in place.
- Mix assistant now supports A/B snapshot slots with save/recall + one-click swap between two stored mixes.
- MIDI chord swap now inserts a voiced chord when the target beat is empty, using nearby note context for range/duration/velocity.
- Transport now includes a live input level meter while in record-ready mode and during active recording.
- Transport now supports recording pre-roll/count-in (off/1 bar/2 bars) with countdown, click accents, and persisted project setting.
- Transport now includes an Overdub mode toggle, with persisted state and non-overdub record behavior that suppresses existing armed-track clip playback.
- Plugin rack and master chain now show per-plugin and chain-level CPU/latency estimates for faster mix-performance decisions.
- Clip split implemented: `SPLIT_CLIP` reducer action splits a clip at any time point, partitioning audio offset/duration and MIDI notes correctly. `S` key splits selected clips at the playhead; ✂ Split button appears on selected clips.
- Waveform peak extraction now runs via a dedicated worker path (with sync fallback), covering file import, recording captures, AI take insertion, and MIDI-to-audio re-renders.
- Loop region is now rendered as a draggable band on the ruler (left/right handles resize, center drag moves). A matching column overlay is shown across the tracks area. Both reflect enabled/disabled state visually.
- Timeline clip move/trim now supports beat snapping when Snap is enabled (drag, left trim, and right trim all quantize to nearest beat).
- Clip fades implemented: draggable fade-in (top-left) and fade-out (top-right) handles on every clip; SVG gradient overlay visualizes fade shape; fades applied as Web Audio gain ramps during playback and offline bounce.
- Timeline track headers now support reordering with up/down controls, updating render/mixer order through reducer-managed track moves.
- Plugin chain moved to track-bus level: insert, bypass, and reorder all take effect live during playback. `REORDER_PLUGIN` / `REORDER_MASTER_PLUGIN` reducer actions added; ▲/▼ buttons added to plugin slots in the rack.
- Plugin rack now supports user plugin presets per plugin type: save current parameters with a custom name, load/delete saved presets, and persist them in local project save plus `.riff` export/import.
- Timeline automation lanes added for track volume/pan and plugin parameters, with draggable point editing and real-time playback interpolation through the live audio bus sync path.
- Project undo/redo now runs through reducer-backed history (toolbar buttons + keyboard shortcuts), with transport/view-only actions excluded from snapshots.
- Video editor now supports frame scrubbing with clip-aware preview sync, timeline playhead scrubbing, and single-frame step controls.
- Showcase release plan now has a locked arrangement map and visual sequence in `SHOWCASE_RELEASE_PLAN.md` for export/publish execution.
- Added `scripts/youtube-music-video.mjs` to package source video + final audio into a YouTube-ready MP4 with metadata/chapters outputs.
- Added `scripts/export-final-demo.mjs` (`npm run demo:export`) to produce a publication-ready 1080p/30fps demo render with loudness normalization and release artifacts.
- Added `scripts/publish-youtube-link.mjs` (`npm run youtube:link`) to stamp the final public YouTube URL into README after upload.
- Added `scripts/youtube-publish-preflight.mjs` (`npm run youtube:preflight`) to validate upload package artifacts and publish-link checklist readiness before YouTube Studio upload.
- Added `scripts/chapters-from-markers.mjs` (`npm run chapters:from-markers`) to export timeline cue markers from a `.riff` project into a YouTube-ready `chapters.txt`.
- `npm run youtube:link` now also auto-marks the two publish checklist entries complete in `ROADMAP.md` once a public YouTube URL is provided.
- `npm run youtube:link` now also updates the showcase project page marker in `SHOWCASE_RELEASE_PLAN.md` so both README + project page links are synced from one command.
- YouTube publish/link scripts now require a valid video URL (not channel/home links), normalize it to canonical `watch?v=` form, and preflight only treats real YouTube video links as published.
- YouTube publish preflight now validates packaged metadata/chapter content (title/description/tags limits and chapter timestamp ordering/gaps) to catch YouTube upload issues before Studio submission.
- Launch publish remains pending manual YouTube Studio upload/public URL; docs auto-link step is ready via `npm run youtube:link -- --url <public-url>`.
- Video clips now include embedded-audio waveform strips (trim-aware) in both main timeline rows and the dedicated Video Editor lane.
- Video editor preview now supports layered picture-in-picture composition with persisted per-clip X/Y/scale layout controls.
- Video editor now supports subtitle/text overlays per clip with timed cue editing, preview compositing, reducer actions, and persistence round-trip.
- Added a dedicated Project Settings panel (project/transport/timeline/master controls), including master pan wiring fixes in mixer/live engine/export paths and persistence for auto-scroll.
- Added focused AIPanel interaction tests for controls, generation validation, and successful local-take creation.
- Added Playwright smoke E2E scaffolding (`playwright.config.ts`, `tests/e2e/smoke.spec.ts`, npm scripts) to validate core shell boot and basic UI interaction.
- Added a keyboard shortcuts panel (button + `?` hotkey), and wired `Ctrl/Cmd+S` to Save Now for parity with UI hints.
- Added responsive layout behavior across top bar, transport, lower panel, and key multi-column editors (AI panel, plugin rack, video editor, MIDI inspector) for tablet/mobile usability.
- Added explicit empty/loading/error UX states for project load/open and timeline import flows (including dismissible inline failures and a guided empty timeline state).
- Audio/video import now offers a split-stems vs keep-master choice; stem split creates color-coded Vocals/Drums/Bass/Other tracks with per-stem clips.
- Stem separation import now reports channel/stem-stage progress and supports in-flight cancel with safe rollback (no partial track insertion).
- Stem groups now persist metadata and can be re-merged to a single master track with one click from the add-track bar when a stem track is selected.

## Next Focus

- Publish final demo render in YouTube Studio, then run `npm run youtube:link -- --url <public-url>` to finalize docs linking.

---

## Priority Items

- [ ] **Launch & Publish (Highest Priority)**
  - [x] Prepare final demo arrangement/project state for public showcase.
  - [x] Export final demo video/audio pass for publication.
  - [x] Create YouTube publish package (title, description, chapters, thumbnail, tags).
  - [ ] Post finished project to YouTube and add the video link to project docs.

- [x] **AI Audio Mixing Assistant**
  - [x] Add AI mix analysis pass that scans all tracks and proposes per-track gain targets (peak + LUFS-aware) before rendering.
  - [x] Add AI EQ assistant that detects likely mud/harshness bands and applies safe corrective EQ moves with bounded gain/Q.
  - [x] Add AI dynamics assistant for compressor/limiter suggestions by source role (vocals, bass, drums, bus, master).
  - [x] Add one-click Auto Mix action in mixer/AI panel with preview + accept/revert workflow.
  - [x] Add loudness target presets (Streaming, Podcast, Club) that tune master chain toward target LUFS/true-peak.

- [x] **AI-to-MIDI editable backing tracks**
  - [x] Preserve generated arrangement note events per instrument when creating takes (not just rendered audio buffers).
  - [x] Add Convert to MIDI flow for any generated take/track to create editable MIDI clips on the timeline.
  - [x] Implement core MIDI note editing actions for generated clips: add/delete notes, drag/move notes, change note length/velocity.
  - [x] Add beat/chord editing controls for generated material (quantize, chord root/quality swap, revoice in-range).
  - [x] Add Re-render from MIDI edits so edited MIDI can regenerate audio stems without regenerating the whole arrangement prompt.

- [x] **Make AI backing-track generation feel production-ready**
  - [x] Add instrument-family articulation rules so short notes and long notes choose more appropriate sample types.
  - [x] Add sample preloading / prewarming for the selected instrument set before rendering starts.
  - [x] Add a real sampled drum kit path so drums are no longer synth-only next to the more realistic instrument stems.

- [x] **Improve project persistence**
  - [x] Save/load full project structure, clip placement, plugin state, and AI generation settings.
  - [x] Decide how imported/recorded audio assets are referenced and restored.
  - [x] Add versioned project schema so future changes do not break old saves.

- [x] **Mixer**
  - [x] Animated meters
  - [x] Bus routing
  - [x] Pre/post fader metering
  - [x] Master chain view

---

## Iteration Queue

### Launch & Publishing (Highest Priority)
- [x] Finalize release-ready arrangement + visuals for the showcase video.
- [x] Export final demo render for YouTube.
- [x] Draft YouTube metadata (title, description, chapters, tags) and thumbnail.
- [x] Generate YouTube chapters from timeline markers (`npm run chapters:from-markers`).
- [x] Add YouTube publish preflight checker (`npm run youtube:preflight`) for package/docs readiness.
- [x] Expand YouTube preflight to validate metadata/chapter constraints before upload.
- [ ] Publish to YouTube + link in README/project page.

### AI Mixing Assistant
- [x] Auto gain staging
- [x] Bounce preflight analyzer
- [x] AI EQ recommendations
- [x] AI compression recommendations
- [x] Masking detector
- [x] Auto bus setup
- [x] Loudness assistant
- [x] Mix A/B snapshots

### AI -> MIDI Workflow
- [x] Linked audio<->MIDI pairs for generated takes
- [x] Generated take note-data persistence
- [x] Use Take as MIDI clips
- [x] Piano roll for generated clips
- [x] Chord/beat edit tools for generated clips
- [x] Chord insert at empty beat
- [x] Render edited MIDI back to audio

### Audio Engine
- [x] Auto-scroll during playback/recording
- [x] Input level meter
- [x] Count-in / pre-roll
- [x] Overdub mode
- [x] Worker/off-main-thread waveform generation
- [x] Punch-in / punch-out recording
- [x] Tap tempo

### Timeline Improvements
- [x] Clip split
- [x] Loop region drag
- [x] Beat snap for drag/trim
- [x] Crossfades / clip fades UI
- [x] Track reordering

### Plugin System
- [x] True live insert/bypass/reorder
- [x] Plugin presets
- [x] Automation lanes
- [x] Plugin CPU / latency display

### Video Editor
- [x] Dedicated video clip reducer actions
- [x] Trim handles
- [x] Frame scrubbing
- [x] Audio waveform under video
- [x] Picture-in-picture / opacity
- [x] Subtitle / text overlay track

### Project Management
- [x] Project save/load
- [x] Export audio
- [x] Stem export
- [x] Undo/redo
- [x] Project settings panel

### Testing & Quality
- [x] Reducer unit tests
- [x] AI renderer behavior tests
- [x] AIPanel interaction tests
- [x] AIPanel section component split
- [x] Persistence contract tests
- [x] Smoke E2E (Playwright)

### Polish & UX
- [x] Keyboard shortcuts panel
- [x] Responsive layout
- [x] Empty/loading/error states
- [x] Performance diagnostics panel
- [x] MIDI editor for imported and manually created MIDI tracks
- [x] Timeline cue markers (named cue points, `M` key, seek on click, rename, right-click delete, persisted)
- [x] MIDI velocity lane — draggable per-note velocity bars below the piano roll grid
- [x] MIDI export — "Export .mid" button in MIDI Clip Editor downloads a Standard MIDI File for any clip with notes

### Stem Separation (Video / Audio Import)
- [x] **Stem separation on import**: When importing a video or audio file, offer a "Split into stems" option that runs AI source separation (vocals, drums, bass, other/melody) and creates one audio track per stem — plus a "keep master" option that skips splitting and imports the mix as-is.
- [x] Stem separation UI: show per-stem progress during processing; allow the user to cancel mid-run.
- [x] Post-separation track labeling: auto-name and color-code each stem track (e.g. Vocals → pink, Drums → orange, Bass → cyan, Other → green).
- [x] Re-merge / bounce stems back to a single master track with one click after editing.

---

## Completed (v0.1)

- [x] Project scaffold: React 19 + TypeScript + Vite
- [x] DAW context + reducer-based state management
- [x] Transport controls, timeline, playhead, ruler, zoom
- [x] Track controls, clip blocks, waveform preview
- [x] Audio, MIDI, video, and bus tracks
- [x] Recording with input device selection and live waveform
- [x] Audio import and extraction from supported video files
- [x] Plugin processing and dedicated plugin editor panes
- [x] AI backing-track generation via OpenAI + local rendering
- [x] Sample-backed instrument rendering
- [x] Backend request validation, caching, health endpoint, and timeout handling

---

> [Refactor 2026-03-07e] Extracted synth engine from `backingTrackRenderer.ts` into `src/lib/synthEngine.ts` (286 lines): `InstrumentPalette` interface, `instrumentPalette`, `scheduleSynthNote`, `scheduleSupportSynthLayer`, `shapeRenderedDuration`, `isLegatoBiasedInstrument`, `calculateLayerTimingOffset`. `backingTrackRenderer.ts` reduced 1200→930 lines (−22%). All exports from `synthEngine.ts` re-imported into the renderer. TS clean.

> [Run 2026-03-07d] MIDI export: created `src/lib/midiExport.ts` with `exportClipAsMidi(clip, bpm)` — uses `@tonejs/midi` to build a type-0 MIDI file (tempo set, one track, notes offset to beat 0), serializes via `toArray()`, copies to `ArrayBuffer` to satisfy TS strict `BlobPart` typing, triggers a browser download as `<clipName>.mid`. Added "⬇ Export .mid" button to `MidiClipEditor.tsx` header (disabled when no notes present). No new state or reducer changes needed. TS clean.

> [Run 2026-03-07] MIDI velocity lane: added `VELOCITY_LANE_HEIGHT = 64` constant; `onVelBarDrag` callback (`mousedown` captures `initialVelocity`, `mousemove` computes delta from cursor Y and dispatches `UPDATE_MIDI_NOTE`). JSX restructured — `.midi-piano-and-vel` column flex wraps existing piano grid + new `.midi-velocity-lane` div (same `pianoWidth`, 64px tall); one `.midi-vel-bar` per note positioned at the note's beat-x, height = `velocity × 64`, width capped 5–20px, selected state highlighted. CSS: `.midi-piano-and-vel`, `.midi-velocity-lane`, `.midi-vel-label`, `.midi-vel-bar`, hover + selected variants appended to `App.css`. Inspector hint updated. TS clean.

> [Refactor 2026-03-07b] `dawReducer.ts` video-domain extraction: created `src/context/reducerUtils.ts` (exports `genId`, `clamp`, `updateTrackById`, `updateTrackClipById` — previously inlined in the reducer) and `src/context/videoReducer.ts` (video helpers `clipVisibleDuration`, `normalizeVideoTextOverlay`, `normalizeVideoClip` + all 8 video/text-overlay cases). `dawReducer.ts` now imports from both modules and delegates with a fall-through `return videoReducer(state, action)`. `dawReducer.ts` reduced 1147 → 902 lines (−21%). 80/80 reducer tests pass. TS clean.

> [Refactor 2026-03-07] Extracted `VideoClipPropsPanel` from `VideoEditor.tsx`: moved all clip properties UI (trim in/out, opacity, PiP layout X/Y/scale, audio volume, subtitle overlay list + per-overlay controls, Reset PiP, Split, Remove) into `src/components/VideoClipPropsPanel.tsx`. `selectedOverlayId` state, overlay auto-select effect, and all overlay dispatch callbacks are now internal to the panel; parent passes only `clip`, `trackId`, `visibleDuration`, `currentTime`, and `onDeselect`. `VideoEditor.tsx` reduced 895 → 522 lines (−42%). Removed orphaned `makeTextOverlay`, `updateSelected`, `addTextOverlay`, `updateSelectedOverlay`, `removeSelectedOverlay` and the overlay-sync effect from parent. Dropped `VideoTextOverlay` import from `VideoEditor.tsx`. TS clean.

> [Run 2026-03-07c] Timeline cue markers: added `Marker` interface (`id`, `name`, `time`, `color`) to `daw.ts`; added `markers: Marker[]` to `DAWState` (initial `[]`); added `ADD_MARKER`, `UPDATE_MARKER`, `REMOVE_MARKER` actions; reducer cases in `dawReducer.ts` keep markers sorted by time. `Timeline.tsx`: destructures `markers`, renders colored flag pins inside `.ruler-content` as absolute-positioned DOM overlays — each pin has a 2px vertical line + label badge; click seeks playhead, double-click opens inline input for rename (blur/Enter commits, Escape cancels), right-click deletes via context menu. `M` key (outside text inputs) inserts a new auto-named, auto-colored marker at the current playhead position; `addMarkerAtPlayhead` added to keydown effect deps. `projectPersistence.ts`: markers serialized/hydrated through `RiffProjectFile.markers` (optional field, defaults to `[]` for old saves). `KeyboardShortcutsModal.tsx`: `M` → "Add cue marker at playhead" entry added. CSS: `.marker-pin`, `.marker-pin-line`, `.marker-pin-label`, `.marker-pin-input` styles appended to `App.css`. TS clean.

> [Run 2026-03-07] Punch-in/out recording + tap tempo: added `punchInEnabled: boolean` to `DAWState` and `TOGGLE_PUNCH_IN` action; reducer case toggles it. `stopRecording` now accepts optional `clipStartTime` override so punch clips land at `loopStart` not playhead-start. Transport: added `punchInEnabledRef/loopStartRef/loopEndRef/loopEnabledRef` (synced from state); `clearPunchTimers` cleanup; `startTransport` branches on `punchInEnabled && loopEnabled` — opens mic upfront, discards empty pre-punch buffer, then schedules `startRecording` at `(loopStart−fromTime)ms` and `stopRecording(loopStart)` at `(loopEnd−fromTime)ms` via setTimeout; timers cleared on stop/cleanup. Added **Punch** (red when active, title explains loop-marker behavior) and **Tap** buttons to transport right-controls. Tap tempo: `tapTimesRef` keeps last 2.5s of tap timestamps; each tap prunes stale entries, averages intervals → dispatches `SET_BPM`. TS clean.

> [Refactor 2026-03-07b] `TrackRow` useCallback stabilization: added `useCallback` import; wrapped `handleContentClick`, `handleContentDoubleClick`, `commitName`, `addAutomationLane`, `upsertAutomationPoint`, `updateAutomationPoint`, `removeAutomationPoint`, `removeAutomationLane` with `useCallback`; added per-track stable `handleClipSelect/Move/Resize/Delete` callbacks and `handleClipSplit` via `useMemo` so `memo(ClipBlock)` comparisons succeed (props were previously recreated as new arrow functions on every TrackRow render — playhead ticks, recording flashes, automation changes). Also fixed two pre-existing TS errors in Timeline.tsx: missing `AudioClip` type import and stale `setPendingImportDecision` reference → `dismissImportDecision` (already provided by `useTimelineImport`). TS clean.

> [Refactor 2026-03-07] Extracted ~380 lines of import/MIDI-clip-creation logic from `Timeline.tsx` (1123→692 lines, −38%) into `src/hooks/useTimelineImport.ts`. Moved: `ImportStatus`/`ImportError`/`PendingImportDecision`/`ClipRef` interfaces, `isAbortError` helper, all import refs/state, `ensureAudioTrack`, `ensureMidiTrack`, `createClipFromAudioBuffer`, `importFileToTrack`, `importFileAsStems`, `handleMergeStemGroup`, all import event handlers, `handleCreateMidiClip`, `handleMidiFileImport`, `activeStemGroup` derived state. Timeline now calls `useTimelineImport(selectedTrackIds, setSelectedClips)` and uses `openMidiImport(trackId|null)` in JSX instead of inline ref mutations. TS clean.

> [Run 2026-03-07] MIDI editor for imported/manually created MIDI tracks: relaxed `selectedMidiClip` guard so any clip on a `midi`-type track opens the editor (including blank ones); double-click on MIDI track canvas creates a blank 4-bar clip and opens the editor; `+ Clip` and `⤴ .mid` buttons added to MIDI track header; `🎹 Import MIDI` button in add-track bar parses `.mid` files via `@tonejs/midi`, merges all non-percussion tracks' notes into one MIDI clip; `MiniPianoRoll` SVG component renders note bars in clip blocks when `midiNotes` is present; `MidiClipEditor` "Render to Audio" section now gated behind `clip.aiLink` since non-AI clips have no linked audio target. TS clean.
> [Run 2026-03-07] Performance diagnostics panel: added `PerformanceDiagnosticsPanel` component (session stat chips, estimated plugin CPU table with color-coded load bar, per-track/master plugin breakdown, audio buffer + waveform peak memory estimates, selected-track per-plugin drill-down). Added `'perf'` to `ActivePanel` type; wired `Perf` button in topbar and `Performance` tab in bottom panel. TS clean.
> [Run 2026-03-06] Video trim handles: added `VidClipBlock` component with `move`/`trim-in`/`trim-out` drag modes. Left handle drag moves both `trimIn` and `startTime` together (keeps right edge fixed); right handle drag updates `trimOut` only. Cursor switches to grab/grabbing/ew-resize per mode. CSS: `.vid-trim-handle` with hover highlight, 8px wide, absolutely positioned inside clip. TS clean.
> [Run 2026-03-06] Dedicated video clip reducer actions: added `trimIn`/`trimOut`/`opacity`/`volume` to `VideoClip`; added `ADD_VIDEO_CLIP`, `REMOVE_VIDEO_CLIP`, `UPDATE_VIDEO_CLIP`, `MOVE_VIDEO_CLIP`, `SPLIT_VIDEO_CLIP` actions to type + reducer. Fixed `VideoEditor` to use the new actions (was broken — dispatched `ADD_CLIP` to audio array but rendered `videoClips`). Updated persistence (serialize + hydrate with defaults for old saves). `TrackRow` now renders trimmed width and per-clip opacity. TS clean.
> [Run 2026-03-06] Added persisted recording pre-roll/count-in (`preRollBars`) with Transport control (Off/1 bar/2 bars), visual countdown badge, accented count-in clicks, and stop-cancel safety before recording starts. Verified with reducer + persistence tests and TS check.
> [Run 2026-03-06] Plugin CPU / latency display verified complete: `pluginPerformance.ts` provides heuristic cost profiles with parameter-sensitive CPU% and latency-samples estimates; per-plugin metrics shown in slot rows and editor head; chain totals shown in rack header. Added 17-test unit suite for `pluginPerformance.ts`. All 162 tests pass, TS clean.

## Notes for Automated Runs

- `completedCount`: 76
- Project path: `/Users/andrewdoerfler/Projects/Riff/riff`
- TypeScript check: run `npx tsc -p tsconfig.app.json --noEmit`
- Testing: run relevant Vitest scope when applicable and document pass/fail
- After each run: update this file by checking off completed items and adding newly discovered follow-ups

### Library Status

- `tone`: installed
- `wavesurfer.js`: installed
- `@tonejs/midi`: installed
- `vitest`: installed
- `@testing-library/react`: installed
- `@testing-library/jest-dom`: installed
- `@testing-library/user-event`: installed
- `jsdom`: installed

### Implementation Notes

- State flows through `DAWContext.tsx` and reducer actions in `src/context/dawReducer.ts`.
- DAW-specific styling still primarily lives in `src/App.css`, though shared shell UI is now moving to Mantine.
- Prefer updating this roadmap concisely; avoid reintroducing long chronological run logs.
