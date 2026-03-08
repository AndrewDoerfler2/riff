import { describe, expect, it } from 'vitest'

import {
  applyProjectPageUpdate,
  applyReadmeUpdate,
  applyRoadmapUpdate,
  isValidYouTubeUrl,
  parseArgs,
} from '../../scripts/publish-youtube-link.mjs'

describe('publish-youtube-link script helpers', () => {
  it('accepts common YouTube URLs', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true)
    expect(isValidYouTubeUrl('https://youtube.com/watch?v=abc123')).toBe(true)
    expect(isValidYouTubeUrl('https://youtu.be/abc123')).toBe(true)
    expect(isValidYouTubeUrl('https://www.youtube.com/shorts/abc123')).toBe(true)
  })

  it('rejects non-YouTube URLs', () => {
    expect(isValidYouTubeUrl('https://example.com/watch?v=abc123')).toBe(false)
    expect(isValidYouTubeUrl('not-a-url')).toBe(false)
    expect(isValidYouTubeUrl('https://www.youtube.com/@riff')).toBe(false)
    expect(isValidYouTubeUrl('https://www.youtube.com/watch')).toBe(false)
  })

  it('updates README marker block with published link line', () => {
    const readme = [
      '# Riff',
      '<!-- YOUTUBE_LINK:START -->',
      '- Public demo video: _Pending upload_',
      '<!-- YOUTUBE_LINK:END -->',
    ].join('\n')

    const updated = applyReadmeUpdate(readme, {
      label: 'Riff Showcase Demo (YouTube)',
      url: 'https://www.youtube.com/watch?v=abc123',
      date: '2026-03-07',
    })

    expect(updated).toContain(
      '- Public demo video: [Riff Showcase Demo (YouTube)](https://www.youtube.com/watch?v=abc123) (published 2026-03-07)',
    )
    expect(updated).not.toContain('_Pending upload_')
  })

  it('updates project page marker block with published link line', () => {
    const projectPage = [
      '# Riff Showcase Release Plan',
      '<!-- PROJECT_PAGE_YOUTUBE_LINK:START -->',
      '- Public demo video: _Pending upload_',
      '<!-- PROJECT_PAGE_YOUTUBE_LINK:END -->',
    ].join('\n')

    const updated = applyProjectPageUpdate(projectPage, {
      label: 'Riff Showcase Demo (YouTube)',
      url: 'https://www.youtube.com/watch?v=abc123',
      date: '2026-03-07',
    })

    expect(updated).toContain(
      '- Public demo video: [Riff Showcase Demo (YouTube)](https://www.youtube.com/watch?v=abc123) (published 2026-03-07)',
    )
    expect(updated).not.toContain('_Pending upload_')
  })

  it('marks roadmap publish checklist items complete', () => {
    const roadmap = [
      '- [ ] Post finished project to YouTube and add the video link to project docs.',
      '- [ ] Publish to YouTube + link in README/project page.',
    ].join('\n')

    const updated = applyRoadmapUpdate(roadmap)

    expect(updated).toContain(
      '- [x] Post finished project to YouTube and add the video link to project docs.',
    )
    expect(updated).toContain('- [x] Publish to YouTube + link in README/project page.')
  })

  it('parses args with defaults and explicit overrides', () => {
    const parsed = parseArgs([
      '--url',
      'https://www.youtube.com/watch?v=abc123',
      '--label',
      'Custom Label',
      '--readme',
      '/tmp/README.md',
      '--roadmap',
      '/tmp/ROADMAP.md',
      '--date',
      '2026-03-07',
    ])

    expect(parsed.url).toBe('https://www.youtube.com/watch?v=abc123')
    expect(parsed.label).toBe('Custom Label')
    expect(parsed.readme).toBe('/tmp/README.md')
    expect(parsed.roadmap).toBe('/tmp/ROADMAP.md')
    expect(parsed.projectPage).toBe('SHOWCASE_RELEASE_PLAN.md')
    expect(parsed.date).toBe('2026-03-07')
  })
})
