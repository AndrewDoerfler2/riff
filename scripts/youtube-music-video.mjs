#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
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

function commandExists(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'riff-music-video'
}

function parseArgs(argv) {
  const parsed = {
    outputDir: 'dist/youtube',
    loopVideo: false,
    tags: 'riff,daw,music production,ai music,indie music',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key === 'loop-video') {
      parsed.loopVideo = true
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

if (!args.video) fail('Provide --video /path/to/video.mp4')
if (!args.audio) fail('Provide --audio /path/to/audio.wav')
if (!args.title) fail('Provide --title "Your song title"')

if (!commandExists('ffmpeg')) {
  fail('ffmpeg not found. Install ffmpeg first (macOS: brew install ffmpeg).')
}
if (!commandExists('ffprobe')) {
  fail('ffprobe not found. Install ffmpeg first (ffprobe is bundled).')
}

const videoPath = path.resolve(args.video)
const audioPath = path.resolve(args.audio)
const outputRoot = path.resolve(args.outputDir)
const titleSlug = slugify(args.title)
const packageDir = path.join(outputRoot, `${new Date().toISOString().slice(0, 10)}-${titleSlug}`)

if (!existsSync(videoPath)) fail(`Video not found: ${videoPath}`)
if (!existsSync(audioPath)) fail(`Audio not found: ${audioPath}`)

mkdirSync(packageDir, { recursive: true })

const outputVideo = path.join(packageDir, `${titleSlug}.mp4`)
const metadataPath = path.join(packageDir, 'youtube-metadata.txt')
const chaptersPath = path.join(packageDir, 'chapters.txt')
const manifestPath = path.join(packageDir, 'package.json')

const ffmpegArgs = [
  ...(args.loopVideo ? ['-stream_loop', '-1'] : []),
  '-i', videoPath,
  '-i', audioPath,
  '-map', '0:v:0',
  '-map', '1:a:0',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '320k',
  '-ar', '48000',
  '-movflags', '+faststart',
  '-shortest',
  outputVideo,
]

runOrFail('ffmpeg', ffmpegArgs)

const tags = String(args.tags)
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean)

const description = args.description
  ? args.description
  : [
      `${args.title} - official music video`,
      '',
      'Produced in Riff (browser DAW prototype).',
      '',
      'Credits:',
      `Artist: ${args.artist || 'TBD'}`,
      '',
      tags.map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' '),
    ].join('\n')

const metadataText = [
  `Title: ${args.title}`,
  `Artist: ${args.artist || 'TBD'}`,
  `Video file: ${outputVideo}`,
  `Tags: ${tags.join(', ')}`,
  '',
  'Description:',
  description,
  '',
  'Upload URL:',
  'https://studio.youtube.com',
].join('\n')

writeFileSync(metadataPath, metadataText, 'utf8')

if (args.chapters) {
  const chaptersSource = path.resolve(args.chapters)
  if (!existsSync(chaptersSource)) {
    fail(`Chapters file not found: ${chaptersSource}`)
  }
  copyFileSync(chaptersSource, chaptersPath)
} else {
  writeFileSync(
    chaptersPath,
    [
      '00:00 Intro',
      '00:30 Verse',
      '01:00 Chorus',
      '01:30 Bridge',
      '02:00 Final Chorus',
      '02:30 Outro',
    ].join('\n'),
    'utf8',
  )
}

if (args.thumbnail) {
  const thumbnailPath = path.resolve(args.thumbnail)
  if (!existsSync(thumbnailPath)) {
    fail(`Thumbnail not found: ${thumbnailPath}`)
  }
  const ext = path.extname(thumbnailPath) || '.png'
  copyFileSync(thumbnailPath, path.join(packageDir, `thumbnail${ext}`))
}

const manifest = {
  createdAt: new Date().toISOString(),
  title: args.title,
  artist: args.artist || 'TBD',
  sourceVideo: videoPath,
  sourceAudio: audioPath,
  outputVideo,
  metadataPath,
  chaptersPath,
  tags,
  loopVideo: Boolean(args.loopVideo),
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

console.log('\nYouTube package created:')
console.log(packageDir)
console.log('\nNext steps:')
console.log('1. Review youtube-metadata.txt and chapters.txt')
console.log('2. Upload the generated .mp4 in YouTube Studio')
console.log('3. Paste metadata and chapters into the upload form')
