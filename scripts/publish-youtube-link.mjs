#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  extractYouTubeVideoId,
  isValidYouTubeVideoUrl,
  toCanonicalYouTubeWatchUrl,
} from './lib/youtubeUrl.mjs'

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

const README_MARKER_START = '<!-- YOUTUBE_LINK:START -->'
const README_MARKER_END = '<!-- YOUTUBE_LINK:END -->'
const PROJECT_PAGE_MARKER_START = '<!-- PROJECT_PAGE_YOUTUBE_LINK:START -->'
const PROJECT_PAGE_MARKER_END = '<!-- PROJECT_PAGE_YOUTUBE_LINK:END -->'

const ROADMAP_PRIORITY_ITEM =
  '- [ ] Post finished project to YouTube and add the video link to project docs.'
const ROADMAP_PRIORITY_ITEM_DONE =
  '- [x] Post finished project to YouTube and add the video link to project docs.'
const ROADMAP_QUEUE_ITEM = '- [ ] Publish to YouTube + link in README/project page.'
const ROADMAP_QUEUE_ITEM_DONE = '- [x] Publish to YouTube + link in README/project page.'

export function parseArgs(argv) {
  const parsed = {
    readme: 'README.md',
    roadmap: 'ROADMAP.md',
    projectPage: 'SHOWCASE_RELEASE_PLAN.md',
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

export function isValidYouTubeUrl(value) {
  return isValidYouTubeVideoUrl(value)
}

function replaceMarkedSection(content, startMarker, endMarker, replacementLine) {
  if (!content.includes(startMarker) || !content.includes(endMarker)) {
    throw new Error(`Missing required markers: ${startMarker} / ${endMarker}`)
  }

  const replacement = [startMarker, replacementLine, endMarker].join('\n')
  return content.replace(new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'm'), replacement)
}

export function applyReadmeUpdate(content, { label, url, date }) {
  return replaceMarkedSection(
    content,
    README_MARKER_START,
    README_MARKER_END,
    `- Public demo video: [${label}](${url}) (published ${date})`,
  )
}

export function applyProjectPageUpdate(content, { label, url, date }) {
  return replaceMarkedSection(
    content,
    PROJECT_PAGE_MARKER_START,
    PROJECT_PAGE_MARKER_END,
    `- Public demo video: [${label}](${url}) (published ${date})`,
  )
}

export function applyRoadmapUpdate(content) {
  let updated = content
  updated = updated.replace(ROADMAP_PRIORITY_ITEM, ROADMAP_PRIORITY_ITEM_DONE)
  updated = updated.replace(ROADMAP_QUEUE_ITEM, ROADMAP_QUEUE_ITEM_DONE)
  return updated
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.url) {
    fail('Provide --url https://www.youtube.com/watch?v=...')
  }
  if (!isValidYouTubeUrl(args.url)) {
    fail(`URL is not a recognized YouTube video URL: ${args.url}`)
  }
  const videoId = extractYouTubeVideoId(args.url)
  const canonicalUrl = videoId ? toCanonicalYouTubeWatchUrl(videoId) : null
  if (!canonicalUrl) {
    fail(`Unable to parse YouTube video ID from URL: ${args.url}`)
  }
  args.url = canonicalUrl

  const readmePath = path.resolve(args.readme)
  if (!existsSync(readmePath)) {
    fail(`README file not found: ${readmePath}`)
  }

  const readmeCurrent = readFileSync(readmePath, 'utf8')
  let readmeUpdated
  try {
    readmeUpdated = applyReadmeUpdate(readmeCurrent, args)
  } catch (error) {
    fail(`README update failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (readmeUpdated === readmeCurrent) {
    fail('No README changes were applied')
  }

  writeFileSync(readmePath, readmeUpdated, 'utf8')

  const projectPagePath = path.resolve(args.projectPage)
  if (!existsSync(projectPagePath)) {
    fail(`Project page file not found: ${projectPagePath}`)
  }

  const projectPageCurrent = readFileSync(projectPagePath, 'utf8')
  let projectPageUpdated
  try {
    projectPageUpdated = applyProjectPageUpdate(projectPageCurrent, args)
  } catch (error) {
    fail(`Project page update failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (projectPageUpdated === projectPageCurrent) {
    fail('No project page changes were applied')
  }

  writeFileSync(projectPagePath, projectPageUpdated, 'utf8')

  const roadmapPath = path.resolve(args.roadmap)
  let roadmapChanged = false
  if (existsSync(roadmapPath)) {
    const roadmapCurrent = readFileSync(roadmapPath, 'utf8')
    const roadmapUpdated = applyRoadmapUpdate(roadmapCurrent)
    if (roadmapUpdated !== roadmapCurrent) {
      writeFileSync(roadmapPath, roadmapUpdated, 'utf8')
      roadmapChanged = true
    }
  }

  console.log('Updated README YouTube link section:')
  console.log(readmePath)
  console.log('Updated project page YouTube link section:')
  console.log(projectPagePath)
  if (roadmapChanged) {
    console.log('Updated roadmap publish checklist:')
    console.log(roadmapPath)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
