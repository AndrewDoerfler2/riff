#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { isValidYouTubeVideoUrl } from './lib/youtubeUrl.mjs'

const README_MARKER_START = '<!-- YOUTUBE_LINK:START -->'
const README_MARKER_END = '<!-- YOUTUBE_LINK:END -->'
const PROJECT_PAGE_MARKER_START = '<!-- PROJECT_PAGE_YOUTUBE_LINK:START -->'
const PROJECT_PAGE_MARKER_END = '<!-- PROJECT_PAGE_YOUTUBE_LINK:END -->'
const ROADMAP_PRIORITY_ITEM_DONE =
  '- [x] Post finished project to YouTube and add the video link to project docs.'
const ROADMAP_QUEUE_ITEM_DONE = '- [x] Publish to YouTube + link in README/project page.'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

export function parseArgs(argv) {
  const parsed = {
    readme: 'README.md',
    projectPage: 'SHOWCASE_RELEASE_PLAN.md',
    roadmap: 'ROADMAP.md',
    packagesRoot: 'dist/youtube',
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

function getMarkedLine(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker)
  const end = content.indexOf(endMarker)
  if (start === -1 || end === -1 || end <= start) return null
  return content
    .slice(start + startMarker.length, end)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

export function isPendingUploadLine(line) {
  if (!line) return true
  return line.includes('_Pending upload_')
}

export function hasMarkdownLink(line) {
  if (!line) return false
  const match = line.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/i)
  if (!match) return false
  return isValidYouTubeVideoUrl(match[1])
}

export function analyzePublishDocs({ readmeContent, projectPageContent, roadmapContent }) {
  const readmeLine = getMarkedLine(readmeContent, README_MARKER_START, README_MARKER_END)
  const projectPageLine = getMarkedLine(
    projectPageContent,
    PROJECT_PAGE_MARKER_START,
    PROJECT_PAGE_MARKER_END,
  )

  const readmeLinked = hasMarkdownLink(readmeLine) && !isPendingUploadLine(readmeLine)
  const projectPageLinked = hasMarkdownLink(projectPageLine) && !isPendingUploadLine(projectPageLine)

  const roadmapPriorityDone = roadmapContent.includes(ROADMAP_PRIORITY_ITEM_DONE)
  const roadmapQueueDone = roadmapContent.includes(ROADMAP_QUEUE_ITEM_DONE)

  return {
    readmeLinked,
    projectPageLinked,
    roadmapPriorityDone,
    roadmapQueueDone,
    docsPublished: readmeLinked && projectPageLinked && roadmapPriorityDone && roadmapQueueDone,
  }
}

export function validatePackageFiles(fileNames) {
  const required = ['youtube-metadata.txt', 'chapters.txt', 'package.json']
  const missing = required.filter((name) => !fileNames.includes(name))
  const hasVideo = fileNames.some((name) => name.toLowerCase().endsWith('.mp4'))
  if (!hasVideo) {
    missing.push('*.mp4')
  }
  return {
    ok: missing.length === 0,
    missing,
  }
}

function parseMetadataField(lines, key) {
  const prefix = `${key}:`
  const line = lines.find((row) => row.startsWith(prefix))
  if (!line) return ''
  return line.slice(prefix.length).trim()
}

export function parseMetadataContent(content) {
  const lines = content.split(/\r?\n/)
  const title = parseMetadataField(lines, 'Title')
  const tagsRaw = parseMetadataField(lines, 'Tags')
  const tags = tagsRaw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  const descriptionMarker = 'Description:'
  const uploadMarker = 'Upload URL:'
  const descriptionStart = lines.findIndex((line) => line.trim() === descriptionMarker)
  const uploadStart = lines.findIndex((line) => line.trim() === uploadMarker)
  const description = descriptionStart === -1
    ? ''
    : lines
      .slice(descriptionStart + 1, uploadStart === -1 ? undefined : uploadStart)
      .join('\n')
      .trim()

  return {
    title,
    tags,
    description,
  }
}

export function validateMetadataContent(content) {
  const parsed = parseMetadataContent(content)
  const errors = []
  const warnings = []

  if (!parsed.title) {
    errors.push('metadata title is missing (`Title:` line)')
  } else if (parsed.title.length > 100) {
    errors.push(`metadata title exceeds 100 characters (${parsed.title.length})`)
  }

  if (!parsed.description) {
    errors.push('metadata description is missing (`Description:` block)')
  } else if (parsed.description.length > 5000) {
    errors.push(`metadata description exceeds 5000 characters (${parsed.description.length})`)
  }

  const joinedTags = parsed.tags.join(', ')
  if (joinedTags.length > 500) {
    errors.push(`metadata tags exceed 500 characters (${joinedTags.length})`)
  }
  if (parsed.tags.length === 0) {
    warnings.push('metadata tags are empty')
  }
  if (parsed.tags.length > 15) {
    warnings.push(`metadata uses many tags (${parsed.tags.length}); consider trimming for clarity`)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    titleLength: parsed.title.length,
    descriptionLength: parsed.description.length,
    tagCount: parsed.tags.length,
    tagsLength: joinedTags.length,
  }
}

function parseTimestamp(value) {
  const parts = value.trim().split(':').map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => Number.isNaN(part) || part < 0)) return null
  if (parts.length === 2) {
    const [mm, ss] = parts
    if (ss >= 60) return null
    return mm * 60 + ss
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts
    if (mm >= 60 || ss >= 60) return null
    return hh * 3600 + mm * 60 + ss
  }
  return null
}

export function validateChaptersContent(content, minGapSeconds = 10) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const errors = []
  if (lines.length < 3) {
    errors.push(`chapters should include at least 3 entries (found ${lines.length})`)
  }

  const entries = lines.map((line, index) => {
    const space = line.indexOf(' ')
    if (space === -1) {
      errors.push(`chapter line ${index + 1} is missing a label`)
      return { seconds: null, label: '' }
    }
    const timestamp = line.slice(0, space)
    const label = line.slice(space + 1).trim()
    const seconds = parseTimestamp(timestamp)
    if (seconds === null) {
      errors.push(`chapter line ${index + 1} has invalid timestamp: ${timestamp}`)
    }
    if (!label) {
      errors.push(`chapter line ${index + 1} has an empty label`)
    }
    return { seconds, label }
  })

  if (entries[0]?.seconds !== 0) {
    errors.push('first chapter must start at 00:00')
  }

  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1]?.seconds
    const curr = entries[i]?.seconds
    if (prev === null || curr === null) continue
    if (curr <= prev) {
      errors.push(`chapter line ${i + 1} must be later than line ${i}`)
      continue
    }
    const gap = curr - prev
    if (gap < minGapSeconds) {
      errors.push(`chapter gap between lines ${i} and ${i + 1} is ${gap}s (< ${minGapSeconds}s)`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    count: lines.length,
  }
}

export function findLatestPackageDir(packagesRoot) {
  if (!existsSync(packagesRoot)) return null
  const entries = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
  if (entries.length === 0) return null
  return path.join(packagesRoot, entries[0])
}

function summarizeStatus({ packageDir, packageCheck, docsStatus }) {
  console.log('YouTube publish preflight')
  console.log(`- Package dir: ${packageDir ?? 'not found'}`)
  if (packageCheck.ok) {
    console.log('- Package assets: OK')
  } else {
    console.log(`- Package assets: missing ${packageCheck.missing.join(', ')}`)
  }
  if (packageCheck.metadataCheck) {
    if (packageCheck.metadataCheck.ok) {
      console.log(
        `- Metadata: OK (title ${packageCheck.metadataCheck.titleLength}/100, description ${packageCheck.metadataCheck.descriptionLength}/5000, tags ${packageCheck.metadataCheck.tagsLength}/500 chars)`,
      )
    } else {
      console.log(`- Metadata: invalid (${packageCheck.metadataCheck.errors.join('; ')})`)
    }
    if (packageCheck.metadataCheck.warnings.length > 0) {
      console.log(`- Metadata warnings: ${packageCheck.metadataCheck.warnings.join('; ')}`)
    }
  }
  if (packageCheck.chaptersCheck) {
    if (packageCheck.chaptersCheck.ok) {
      console.log(`- Chapters: OK (${packageCheck.chaptersCheck.count} entries)`)
    } else {
      console.log(`- Chapters: invalid (${packageCheck.chaptersCheck.errors.join('; ')})`)
    }
  }

  const publishState = docsStatus.docsPublished ? 'published + linked' : 'pending upload/link'
  console.log(`- Docs/checklist state: ${publishState}`)

  if (!docsStatus.docsPublished) {
    console.log('- Next step: publish in YouTube Studio, then run `npm run youtube:link -- --url <public-url>`')
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const readmePath = path.resolve(args.readme)
  const projectPagePath = path.resolve(args.projectPage)
  const roadmapPath = path.resolve(args.roadmap)

  if (!existsSync(readmePath)) fail(`README file not found: ${readmePath}`)
  if (!existsSync(projectPagePath)) fail(`Project page file not found: ${projectPagePath}`)
  if (!existsSync(roadmapPath)) fail(`Roadmap file not found: ${roadmapPath}`)

  const readmeContent = readFileSync(readmePath, 'utf8')
  const projectPageContent = readFileSync(projectPagePath, 'utf8')
  const roadmapContent = readFileSync(roadmapPath, 'utf8')
  const docsStatus = analyzePublishDocs({ readmeContent, projectPageContent, roadmapContent })

  const packageDir = args.packageDir
    ? path.resolve(args.packageDir)
    : findLatestPackageDir(path.resolve(args.packagesRoot))

  let packageCheck = { ok: false, missing: ['package directory'] }
  if (packageDir && existsSync(packageDir) && statSync(packageDir).isDirectory()) {
    const fileNames = readdirSync(packageDir).map((name) => name.trim())
    packageCheck = validatePackageFiles(fileNames)
    if (packageCheck.ok) {
      const metadataPath = path.join(packageDir, 'youtube-metadata.txt')
      const chaptersPath = path.join(packageDir, 'chapters.txt')
      const metadataContent = readFileSync(metadataPath, 'utf8')
      const chaptersContent = readFileSync(chaptersPath, 'utf8')
      packageCheck.metadataCheck = validateMetadataContent(metadataContent)
      packageCheck.chaptersCheck = validateChaptersContent(chaptersContent)
      packageCheck.ok = packageCheck.metadataCheck.ok && packageCheck.chaptersCheck.ok
    }
  }

  summarizeStatus({ packageDir, packageCheck, docsStatus })

  if (!packageCheck.ok) {
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
