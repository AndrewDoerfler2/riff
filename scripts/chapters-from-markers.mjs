#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const parsed = {
    out: '',
    minGap: '10',
    introLabel: 'Intro',
    includeIntro: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key === 'no-intro') {
      parsed.includeIntro = false
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

function toTimestamp(totalSeconds) {
  const secs = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(secs / 3600)
  const minutes = Math.floor((secs % 3600) / 60)
  const seconds = secs % 60

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

function normalizeLabel(input, fallback) {
  const compact = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return compact || fallback
}

const args = parseArgs(process.argv.slice(2))

if (!args.project) {
  fail('Provide --project /absolute/path/to/project.riff')
}

const projectPath = path.resolve(args.project)
if (!existsSync(projectPath)) {
  fail(`Project file not found: ${projectPath}`)
}

const minGapSeconds = Number(args.minGap)
if (!Number.isFinite(minGapSeconds) || minGapSeconds < 0) {
  fail(`--minGap must be a non-negative number. Received: ${args.minGap}`)
}

let parsedProject
try {
  parsedProject = JSON.parse(readFileSync(projectPath, 'utf8'))
} catch (error) {
  fail(`Could not parse JSON project file: ${error instanceof Error ? error.message : String(error)}`)
}

const markers = Array.isArray(parsedProject?.markers) ? parsedProject.markers : []
const markerRows = markers
  .map((marker, index) => {
    const time = Number(marker?.time)
    if (!Number.isFinite(time) || time < 0) {
      return null
    }
    return {
      id: String(marker?.id ?? `marker-${index + 1}`),
      time,
      label: normalizeLabel(marker?.name, `Marker ${index + 1}`),
    }
  })
  .filter(Boolean)
  .sort((a, b) => a.time - b.time)

const chapters = []
if (args.includeIntro) {
  const introLabel = normalizeLabel(args.introLabel, 'Intro')
  chapters.push({ time: 0, label: introLabel })
}

for (const marker of markerRows) {
  const rounded = Math.max(0, Math.floor(marker.time))
  const previous = chapters.at(-1)
  if (previous && rounded === previous.time) {
    // Keep the marker label when timestamps collide.
    previous.label = marker.label
    continue
  }
  chapters.push({ time: rounded, label: marker.label, id: marker.id })
}

if (chapters.length === 0) {
  fail('No valid markers found in project and intro chapter disabled.')
}

if (chapters[0].time !== 0) {
  fail('YouTube chapters must start at 00:00. Enable intro chapter or add a marker at 0s.')
}

const gapViolations = []
for (let i = 1; i < chapters.length; i += 1) {
  const gap = chapters[i].time - chapters[i - 1].time
  if (gap < minGapSeconds) {
    gapViolations.push({ from: chapters[i - 1], to: chapters[i], gap })
  }
}
if (gapViolations.length > 0) {
  const lines = gapViolations
    .map((v) => `${toTimestamp(v.from.time)} -> ${toTimestamp(v.to.time)} (${v.gap}s)`)
    .join(', ')
  fail(`Found chapter gaps shorter than ${minGapSeconds}s: ${lines}`)
}

const outputPath = args.out
  ? path.resolve(args.out)
  : path.join(path.dirname(projectPath), `${path.basename(projectPath, path.extname(projectPath))}-chapters.txt`)

mkdirSync(path.dirname(outputPath), { recursive: true })

const outputLines = chapters.map((chapter) => `${toTimestamp(chapter.time)} ${chapter.label}`)
writeFileSync(outputPath, `${outputLines.join('\n')}\n`, 'utf8')

console.log(`Generated ${chapters.length} chapter timestamps from ${markerRows.length} marker(s).`)
console.log(`Output: ${outputPath}`)
