import { describe, expect, it } from 'vitest'

import {
  extractYouTubeVideoId,
  isValidYouTubeVideoUrl,
  toCanonicalYouTubeWatchUrl,
} from '../../scripts/lib/youtubeUrl.mjs'

describe('youtubeUrl helpers', () => {
  it('extracts IDs from watch and short URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=abc123_XY')).toBe('abc123_XY')
    expect(extractYouTubeVideoId('https://youtu.be/abc123_XY?t=30')).toBe('abc123_XY')
  })

  it('rejects non-video YouTube URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/@riff')).toBe(null)
    expect(extractYouTubeVideoId('https://www.youtube.com/watch')).toBe(null)
    expect(extractYouTubeVideoId('https://example.com/watch?v=abc123_XY')).toBe(null)
  })

  it('validates and canonicalizes video IDs', () => {
    expect(isValidYouTubeVideoUrl('https://www.youtube.com/shorts/abc123_XY')).toBe(true)
    expect(isValidYouTubeVideoUrl('not-a-url')).toBe(false)
    expect(toCanonicalYouTubeWatchUrl('abc123_XY')).toBe('https://www.youtube.com/watch?v=abc123_XY')
    expect(toCanonicalYouTubeWatchUrl('bad')).toBe(null)
  })
})
