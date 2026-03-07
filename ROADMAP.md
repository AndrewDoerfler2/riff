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
- Video clips now include embedded-audio waveform strips (trim-aware) in both main timeline rows and the dedicated Video Editor lane.
- Video editor preview now supports layered picture-in-picture composition with persisted per-clip X/Y/scale layout controls.
- Video editor now supports subtitle/text overlays per clip with timed cue editing, preview compositing, reducer actions, and persistence round-trip.
- Added a dedicated Project Settings panel (project/transport/timeline/master controls), including master pan wiring fixes in mixer/live engine/export paths and persistence for auto-scroll.
- Added focused AIPanel interaction tests for controls, generation validation, and successful local-take creation.
- Added Playwright smoke E2E scaffolding (`playwright.config.ts`, `tests/e2e/smoke.spec.ts`, npm scripts) to validate core shell boot and basic UI interaction.
- Added a keyboard shortcuts panel (button + `?` hotkey), and wired `Ctrl/Cmd+S` to Save Now for parity with UI hints.

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
- [ ] Responsive layout
- [ ] Empty/loading/error states
- [ ] Performance diagnostics panel
- [ ] MIDI editor for imported and manually created MIDI tracks

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

> [Run 2026-03-06] Video trim handles: added `VidClipBlock` component with `move`/`trim-in`/`trim-out` drag modes. Left handle drag moves both `trimIn` and `startTime` together (keeps right edge fixed); right handle drag updates `trimOut` only. Cursor switches to grab/grabbing/ew-resize per mode. CSS: `.vid-trim-handle` with hover highlight, 8px wide, absolutely positioned inside clip. TS clean.
> [Run 2026-03-06] Dedicated video clip reducer actions: added `trimIn`/`trimOut`/`opacity`/`volume` to `VideoClip`; added `ADD_VIDEO_CLIP`, `REMOVE_VIDEO_CLIP`, `UPDATE_VIDEO_CLIP`, `MOVE_VIDEO_CLIP`, `SPLIT_VIDEO_CLIP` actions to type + reducer. Fixed `VideoEditor` to use the new actions (was broken — dispatched `ADD_CLIP` to audio array but rendered `videoClips`). Updated persistence (serialize + hydrate with defaults for old saves). `TrackRow` now renders trimmed width and per-clip opacity. TS clean.
> [Run 2026-03-06] Added persisted recording pre-roll/count-in (`preRollBars`) with Transport control (Off/1 bar/2 bars), visual countdown badge, accented count-in clicks, and stop-cancel safety before recording starts. Verified with reducer + persistence tests and TS check.
> [Run 2026-03-06] Plugin CPU / latency display verified complete: `pluginPerformance.ts` provides heuristic cost profiles with parameter-sensitive CPU% and latency-samples estimates; per-plugin metrics shown in slot rows and editor head; chain totals shown in rack header. Added 17-test unit suite for `pluginPerformance.ts`. All 162 tests pass, TS clean.

## Notes for Automated Runs

- `completedCount`: 65
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
