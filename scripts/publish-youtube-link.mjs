#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const parsed = {
    readme: 'README.md',
    label: 'Riff Showcase Demo (YouTube)',
    date: new Date().toISOString().slice(0, 10),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      fail(`Missing value for --${key}`)
    }
    parsed[key] = next
    i += 1
  }

  return parsed
}

function isValidYouTubeUrl(value) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return host.includes('youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be')
  } catch {
    return false
  }
}

const args = parseArgs(process.argv.slice(2))
if (!args.url) {
  fail('Provide --url https://www.youtube.com/watch?v=...')
}
if (!isValidYouTubeUrl(args.url)) {
  fail(`URL is not a recognized YouTube URL: ${args.url}`)
}

const readmePath = path.resolve(args.readme)
if (!existsSync(readmePath)) {
  fail(`README file not found: ${readmePath}`)
}

const markerStart = '<!-- YOUTUBE_LINK:START -->'
const markerEnd = '<!-- YOUTUBE_LINK:END -->'
const current = readFileSync(readmePath, 'utf8')

if (!current.includes(markerStart) || !current.includes(markerEnd)) {
  fail(`README is missing required markers: ${markerStart} / ${markerEnd}`)
}

const replacement = [
  markerStart,
  `- Public demo video: [${args.label}](${args.url}) (published ${args.date})`,
  markerEnd,
].join('\n')

const updated = current.replace(
  new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, 'm'),
  replacement,
)

if (updated === current) {
  fail('No README changes were applied')
}

writeFileSync(readmePath, updated, 'utf8')

console.log('Updated README YouTube link section:')
console.log(readmePath)
