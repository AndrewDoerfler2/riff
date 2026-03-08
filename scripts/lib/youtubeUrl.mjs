const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,}$/

export function isYouTubeHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'youtu.be' || host.endsWith('.youtu.be') || host === 'youtube.com' || host.endsWith('.youtube.com')
}

export function extractYouTubeVideoId(value) {
  try {
    const url = new URL(value)
    if (!isYouTubeHost(url.hostname)) return null

    const host = url.hostname.toLowerCase()
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const id = url.pathname.replace(/^\/+/, '').split('/')[0]
      return YOUTUBE_VIDEO_ID_RE.test(id) ? id : null
    }

    const path = url.pathname
    if (path === '/watch' || path === '/watch/') {
      const id = url.searchParams.get('v')
      return YOUTUBE_VIDEO_ID_RE.test(id || '') ? id : null
    }

    const segment = path.replace(/^\/+/, '').split('/')
    if (segment[0] === 'shorts' || segment[0] === 'embed' || segment[0] === 'live') {
      const id = segment[1]
      return YOUTUBE_VIDEO_ID_RE.test(id || '') ? id : null
    }

    return null
  } catch {
    return null
  }
}

export function isValidYouTubeVideoUrl(value) {
  return extractYouTubeVideoId(value) !== null
}

export function toCanonicalYouTubeWatchUrl(videoId) {
  if (!YOUTUBE_VIDEO_ID_RE.test(videoId || '')) return null
  return `https://www.youtube.com/watch?v=${videoId}`
}
