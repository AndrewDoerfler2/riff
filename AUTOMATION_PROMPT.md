# Automation Prompt

Use this prompt for Codex or Claude when running autonomous improvement tasks on this project.

## Reusable Prompt

```text
You are working in the Riff project at:
/Users/andrewdoerfler/Projects/Riff/riff

Project summary:
- Riff is a browser-based DAW prototype built with React, TypeScript, and Vite.
- It supports audio, MIDI, video, and bus tracks.
- State flows through DAWContext/useReducer and reducer logic in src/context/dawReducer.ts.
- Core domain types live in src/types/daw.ts.
- Audio engine and playback/recording wiring live in src/context/DAWContext.tsx and src/lib/audioNodes.ts.
- Timeline/editor/mixer/plugin UI lives under src/components.
- Project persistence/export logic lives in src/lib/projectPersistence.ts and src/lib/audioExport.ts.
- AI arrangement and rendering logic lives in src/components/AIPanel.tsx, src/components/AIPanelSections.tsx, src/lib/backingTrackRenderer.ts, src/lib/mixAssistant.ts, and server/index.js.
- Shared shell UI is moving toward Mantine, but DAW-specific editor/timeline styling still relies heavily on src/App.css.

Primary objective:
- Open ROADMAP.md.
- Pick the next highest-priority unchecked item.
- Implement it fully and safely.
- Update ROADMAP.md to reflect what was completed and any short new follow-up items discovered.

Execution rules:
- Do not ask for confirmation unless the task is ambiguous, destructive, or blocked.
- Prefer completing one coherent feature/refactor/test task end-to-end per run.
- Do not rewrite unrelated parts of the app.
- Preserve existing behavior unless the roadmap item requires a behavior change.
- Keep changes incremental and production-minded.
- Favor maintainability over cleverness.

Codebase rules:
- Prefer reading the existing implementation before changing architecture.
- Reuse current patterns for reducer actions, track/clip types, plugin instances, and AI panel flows.
- Keep DAW-specific UI interactions responsive; avoid introducing React patterns that would hurt playback/editor performance.
- For standard app chrome/forms/modals/panels, prefer Mantine components where it is a clean fit.
- For custom timeline, MIDI editor, waveform, or meter surfaces, use focused custom styling/DOM logic when needed.
- Avoid adding new dependencies unless they materially simplify the task.
- If adding state, update src/types/daw.ts and the reducer consistently.
- If adding UI actions, wire them through existing dispatch patterns.

Testing and verification:
- After code changes, run:
  npx tsc -p tsconfig.app.json --noEmit
- If the changed area has tests or should have tests, run the relevant test scope and add/update tests when practical.
- If you cannot run a useful verification step, say exactly what was not run and why.

ROADMAP discipline:
- Keep ROADMAP.md concise.
- Do not add long chronological run logs.
- Only update:
  - completed checkboxes
  - short current-state/recent-progress notes when necessary
  - brief follow-up items discovered during implementation

Output expectations:
- Make the code changes directly.
- At the end, provide:
  1. what was implemented
  2. files changed
  3. verification run
  4. any remaining risk or next follow-up

When choosing work, use this priority order:
1. Explicit user request
2. Next unchecked roadmap item in the highest-priority section
3. Small supporting refactors required to complete that item safely
4. Focused tests that lock in the new behavior

Current likely next items include:
- Mix A/B snapshots
- Auto-scroll during playback/recording
- Chord insert at empty beat in generated MIDI
- Timeline editing improvements

Be decisive, keep scope tight, and leave the project in a buildable state.
```

## Short Version

```text
Work in /Users/andrewdoerfler/Projects/Riff/riff.
Open ROADMAP.md, pick the next highest-priority unchecked item, implement it end-to-end, update the roadmap concisely, and verify with:
npx tsc -p tsconfig.app.json --noEmit

Use existing reducer/type/audio-engine patterns. Prefer Mantine for standard shell UI, but keep custom DAW surfaces custom where needed. Avoid unrelated rewrites, keep scope tight, and leave the app buildable.
```
