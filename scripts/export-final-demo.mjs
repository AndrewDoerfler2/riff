#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function commandExists(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function runOrFail(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    fail(`${command} is required but not available in PATH`)
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status}`)
  }
}

function parseArgs(argv) {
  const parsed = {
    outputDir: 'dist/final-demo',
    fps: '30',
    width: '1920',
    height: '1080',
    sampleRate: '48000',
    chapters: [
      '00:00 App cold open',
      '00:08 AI backing-track generation',
      '00:30 MIDI edit pass',
      '00:52 Timeline arrangement edits',
      '01:20 Mixer + AI assistant pass',
      '01:50 Automation lanes + final chorus',
      '02:15 Bounce/export + final playback',
    ],
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue

    const key = arg.slice(2)
    if (key === 'chapter') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        fail('Missing value for --chapter')
      }
      parsed.chapters.push(next)
      i += 1
      continue
    }

    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      fail(`Missing value for --${key}`)
    }
    parsed[key] = next
    i += 1
  }

  return parsed
}

const args = parseArgs(process.argv.slice(2))

if (!args.video) fail('Provide --video /path/to/capture.mp4')
if (!args.audio) fail('Provide --audio /path/to/final-mix.wav')
if (!args.title) fail('Provide --title "Track Title"')

if (!commandExists('ffmpeg')) {
  fail('ffmpeg not found. Install ffmpeg first (macOS: brew install ffmpeg).')
}
if (!commandExists('ffprobe')) {
  fail('ffprobe not found. Install ffmpeg first (ffprobe is bundled).')
}

const videoPath = path.resolve(args.video)
const audioPath = path.resolve(args.audio)
if (!existsSync(videoPath)) fail(`Video not found: ${videoPath}`)
if (!existsSync(audioPath)) fail(`Audio not found: ${audioPath}`)

const now = new Date().toISOString().slice(0, 10)
const outputRoot = path.resolve(args.outputDir)
mkdirSync(outputRoot, { recursive: true })

const safeTitle = args.title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'riff-final-demo'

const runDir = path.join(outputRoot, `${now}-${safeTitle}`)
mkdirSync(runDir, { recursive: true })

const outputVideo = path.join(runDir, `${safeTitle}-final.mp4`)
const chaptersPath = path.join(runDir, 'chapters.txt')
const notesPath = path.join(runDir, 'export-notes.txt')
const manifestPath = path.join(runDir, 'render-manifest.json')

const vfFilter = [
  `scale=${args.width}:${args.height}:force_original_aspect_ratio=decrease`,
  `pad=${args.width}:${args.height}:(ow-iw)/2:(oh-ih)/2:black`,
  'format=yuv420p',
].join(',')

const afFilter = [
  `aformat=sample_rates=${args.sampleRate}:channel_layouts=stereo`,
  'loudnorm=I=-14:TP=-1.0:LRA=11',
].join(',')

const ffmpegArgs = [
  '-i', videoPath,
  '-i', audioPath,
  '-map', '0:v:0',
  '-map', '1:a:0',
  '-r', args.fps,
  '-vf', vfFilter,
  '-af', afFilter,
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '17',
  '-c:a', 'aac',
  '-b:a', '320k',
  '-movflags', '+faststart',
  '-shortest',
  outputVideo,
]

runOrFail('ffmpeg', ffmpegArgs)

const chapterLines = args.chapters.filter(Boolean)
writeFileSync(chaptersPath, chapterLines.join('\n') + '\n', 'utf8')

const notesText = [
  `Title: ${args.title}`,
  `Artist: ${args.artist || 'TBD'}`,
  `Render date: ${now}`,
  `Source video: ${videoPath}`,
  `Source audio: ${audioPath}`,
  `Output video: ${outputVideo}`,
  '',
  'Spec:',
  `- Resolution: ${args.width}x${args.height}`,
  `- Frame rate: ${args.fps} fps`,
  `- Audio sample rate: ${args.sampleRate} Hz`,
  '- Loudness target: -14 LUFS integrated, -1 dBTP',
  '',
  'Next:',
  '1. Spot-check beginning/middle/end sync and loudness.',
  '2. Use this output with `npm run youtube:package -- ...` for upload assets.',
].join('\n')

writeFileSync(notesPath, notesText + '\n', 'utf8')

const manifest = {
  createdAt: new Date().toISOString(),
  title: args.title,
  artist: args.artist || 'TBD',
  sourceVideo: videoPath,
  sourceAudio: audioPath,
  outputVideo,
  chaptersPath,
  notesPath,
  settings: {
    width: Number(args.width),
    height: Number(args.height),
    fps: Number(args.fps),
    sampleRate: Number(args.sampleRate),
    loudnessTarget: '-14 LUFS / -1 dBTP',
  },
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

console.log('\nFinal demo render complete:')
console.log(outputVideo)
console.log('\nArtifacts:')
console.log(`- ${chaptersPath}`)
console.log(`- ${notesPath}`)
console.log(`- ${manifestPath}`)
