import { describe, expect, it } from 'vitest'

import {
  analyzePublishDocs,
  hasMarkdownLink,
  isPendingUploadLine,
  parseMetadataContent,
  validateChaptersContent,
  validateMetadataContent,
  validatePackageFiles,
} from '../../scripts/youtube-publish-preflight.mjs'

describe('youtube-publish-preflight helpers', () => {
  it('detects pending upload lines', () => {
    expect(isPendingUploadLine('- Public demo video: _Pending upload_')).toBe(true)
    expect(isPendingUploadLine('- Public demo video: [Demo](https://youtu.be/abc123)')).toBe(false)
  })

  it('detects markdown links', () => {
    expect(hasMarkdownLink('- Public demo video: [Demo](https://youtu.be/abc123)')).toBe(true)
    expect(hasMarkdownLink('- Public demo video: _Pending upload_')).toBe(false)
    expect(hasMarkdownLink('- Public demo video: [Demo](https://example.com/demo)')).toBe(false)
  })

  it('flags missing required package files', () => {
    const result = validatePackageFiles(['package.json', 'youtube-metadata.txt'])
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('chapters.txt')
    expect(result.missing).toContain('*.mp4')
  })

  it('passes package validation when required assets are present', () => {
    const result = validatePackageFiles([
      'riff-showcase-demo.mp4',
      'youtube-metadata.txt',
      'chapters.txt',
      'package.json',
    ])
    expect(result.ok).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('parses metadata content fields', () => {
    const parsed = parseMetadataContent([
      'Title: Riff Showcase',
      'Artist: Riff',
      'Tags: riff, daw, music production',
      '',
      'Description:',
      'Line one',
      'Line two',
      '',
      'Upload URL:',
      'https://studio.youtube.com',
    ].join('\n'))

    expect(parsed.title).toBe('Riff Showcase')
    expect(parsed.tags).toEqual(['riff', 'daw', 'music production'])
    expect(parsed.description).toBe('Line one\nLine two')
  })

  it('fails metadata validation when title is missing', () => {
    const result = validateMetadataContent([
      'Artist: Riff',
      'Tags: riff, daw',
      '',
      'Description:',
      'Demo description',
    ].join('\n'))

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('title is missing'))).toBe(true)
  })

  it('passes metadata validation for valid payload', () => {
    const result = validateMetadataContent([
      'Title: Riff Showcase Demo',
      'Artist: Riff',
      'Tags: riff, daw, ai music',
      '',
      'Description:',
      'A concise demo description.',
      '',
      'Upload URL:',
      'https://studio.youtube.com',
    ].join('\n'))

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validates chapter timestamp rules', () => {
    const result = validateChaptersContent([
      '00:00 Intro',
      '00:09 Verse',
      '00:40 Chorus',
    ].join('\n'))

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('(< 10s)'))).toBe(true)
  })

  it('passes chapter validation for valid chapter list', () => {
    const result = validateChaptersContent([
      '00:00 Intro',
      '00:30 Verse',
      '01:00 Chorus',
    ].join('\n'))

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('reports docs published when links and roadmap checks are complete', () => {
    const status = analyzePublishDocs({
      readmeContent: [
        '<!-- YOUTUBE_LINK:START -->',
        '- Public demo video: [Demo](https://www.youtube.com/watch?v=abc123)',
        '<!-- YOUTUBE_LINK:END -->',
      ].join('\n'),
      projectPageContent: [
        '<!-- PROJECT_PAGE_YOUTUBE_LINK:START -->',
        '- Public demo video: [Demo](https://www.youtube.com/watch?v=abc123)',
        '<!-- PROJECT_PAGE_YOUTUBE_LINK:END -->',
      ].join('\n'),
      roadmapContent: [
        '- [x] Post finished project to YouTube and add the video link to project docs.',
        '- [x] Publish to YouTube + link in README/project page.',
      ].join('\n'),
    })

    expect(status.docsPublished).toBe(true)
  })
})
