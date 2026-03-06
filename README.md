# Riff

Riff is a browser-based DAW prototype built with React, TypeScript, and Vite. It combines multitrack editing, recording, mixing, video support, AI-assisted backing-track generation, editable MIDI conversion, project persistence, and WAV export in a single local app.

## What It Does

- Record audio into armed tracks from a selected input device.
- Arrange audio, MIDI, bus, and video tracks on a timeline.
- Generate AI-backed arrangement takes from genre, key, tempo, bar count, and instrument choices.
- Convert generated takes into editable MIDI clips and keep linked audio clips in sync after MIDI edits.
- Mix with built-in plugins, track/master metering, bus routing, loudness presets, and AI-assisted mix suggestions.
- Save locally, export/import `.riff` project files, bounce a stereo WAV, or export track stems.

## Stack

- React 19
- TypeScript 5
- Vite 8
- Vitest + Testing Library
- Web Audio API
- Node.js HTTP server for AI arrangement requests
- OpenAI Responses API for backing-track planning

## Getting Started

### Prerequisites

- Node.js 20+ recommended
- npm
- `OPENAI_API_KEY` for AI arrangement generation

### Install

```bash
npm install
```

### Run the app

Start the frontend:

```bash
npm run dev
```

Start the local AI backend in a second terminal:

```bash
npm run server
```

The frontend expects the backend at `http://localhost:8787`.

### Backend environment

Create a `.env` file for the server if you want AI generation enabled:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=180000
AI_CACHE_TTL_MS=300000
AI_CACHE_MAX_ENTRIES=100
PORT=8787
```

Without `OPENAI_API_KEY`, the rest of the DAW still works, but `/api/ai/backing-track` will return an error.

## Available Scripts

```bash
npm run dev
npm run server
npm run build
npm run preview
npm run lint
npm run test
npm run test:watch
```

## Major Features

### DAW workflow

- Transport with play, stop, record, BPM, time signature, loop, metronome, and snap
- Multi-track timeline with draggable playhead and waveform rendering
- Audio, MIDI, video, and bus tracks
- Track controls for arm, mute, solo, monitor, volume, pan, and meter tap mode

### AI arrangement and MIDI editing

- AI or local-pattern backing-track generation
- Session take history with preview, compare, delete, and per-track regenerate
- Generated takes can be committed as linked audio + MIDI pairs or MIDI-only tracks
- MIDI note editing, quantize, chord replacement, nudging, and linked audio re-render
- Snippet-conditioned generation path for influence from recorded reference material

### Mixing and export

- Built-in plugin rack with EQ, compressor, reverb, delay, distortion, chorus, limiter, gain, autopan, and hum remover
- Mixer with animated meters, master chain, and bus routing
- AI mixing assistant for level, EQ, dynamics, masking, auto-bus setup, and loudness targeting
- Bounce preflight analysis for clipping, headroom, limiter, and loudness warnings
- Stereo WAV bounce and per-track stem export with progress UI

### Persistence

- Auto-save to local storage
- Manual save/export/open/new project controls
- Versioned `.riff` project file format
- Imported audio is embedded into exported project files

## Project Structure

```text
src/
  components/    UI panels, timeline, mixer, editors
  context/       DAW reducer, providers, audio engine
  hooks/         shared UI/audio hooks
  lib/           rendering, export, persistence, analysis helpers
  types/         DAW domain types
server/
  index.js       local AI arrangement backend
tests/
  component, reducer, and lib coverage
```

## Known Constraints

- The AI backend must be running separately for arrangement generation.
- Video clips restore metadata in project files, but source video files may need to be re-imported depending on workflow.
- Generation history is session-local because `AudioBuffer` objects are not persisted directly.
- This is a local-first prototype, not a production-hardened DAW.

## Testing

Run the test suite:

```bash
npm run test
```

Build and type-check:

```bash
npm run build
```

## Roadmap

The active implementation log and queue live in [ROADMAP.md](/Users/andrewdoerfler/Projects/Riff/riff/ROADMAP.md).
