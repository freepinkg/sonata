import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'

const FEED_REGEX = /\.xml(?:\?|$)|feed|rss/i
const PCAST_PREFIX = /^pcast:/i

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

interface ITunesPodcast {
  trackId: number
  trackName: string
  artistName: string
  feedUrl: string
  artworkUrl100: string
}

export class PodcastSource implements AudioSource {
  name = 'podcast'

  matches(url: string): boolean {
    return FEED_REGEX.test(url) || PCAST_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (PCAST_PREFIX.test(query)) return this.#search(query.replace(PCAST_PREFIX, '').trim())
    if (!this.matches(query)) return this.#search(query)
    try {
      const res = await fetch(query, { headers: { 'User-Agent': UA } })
      const xml = await res.text()
      const title = xml.match(/<title>(?:<!\[CDATA\[)?([^\]]+)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? 'Unknown'
      const author =
        xml.match(/<itunes:author>(?:<!\[CDATA\[)?([^\]]+)(?:\]\]>)?<\/itunes:author>/)?.[1]?.trim() ??
        xml.match(/<author>(?:<!\[CDATA\[)?([^\]]+)(?:\]\]>)?<\/author>/)?.[1]?.trim() ??
        'Podcast'
      const artwork = xml.match(/<itunes:image\s+href="([^"]+)"/)?.[1] ?? xml.match(/<image><url>([^<]+)<\/url>/)?.[1] ?? ''
      const items: Track[] = []
      const itemRegex = /<item>([\s\S]*?)<\/item>/g
      let itemMatch
      while ((itemMatch = itemRegex.exec(xml)) !== null && items.length < 50) {
        const body = itemMatch[1]
        const epTitle =
          body.match(/<title>(?:<!\[CDATA\[)?([^\]]+)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? 'Unknown'
        const epUrl =
          body.match(/<enclosure\s+url="([^"]+)"/)?.[1] ??
          body.match(/<guid>(?:<!\[CDATA\[)?([^\]]+)(?:\]\]>)?<\/guid>/)?.[1] ??
          ''
        const epDuration = body.match(/<itunes:duration>([^<]+)<\/itunes:duration>/)?.[1]
        const durationMs = epDuration ? parseDuration(epDuration) : 0
        const epArtwork =
          body.match(/<itunes:image\s+href="([^"]+)"/)?.[1] ?? artwork
        const epAuthor =
          body.match(/<itunes:author>(?:<!\[CDATA\[)?([^\]]+)(?:\]\]>)?<\/itunes:author>/)?.[1]?.trim() ?? author
        items.push({
          encoded: Buffer.from(epUrl || query).toString('base64url'),
          info: {
            identifier: epUrl || epTitle,
            title: epTitle,
            author: epAuthor,
            duration: durationMs,
            uri: epUrl || query,
            artworkUrl: epArtwork,
            sourceName: 'podcast',
            isStream: false,
            position: 0,
          },
          source: 'podcast',
        })
      }
      if (items.length === 0) {
        items.push({
          encoded: Buffer.from(query).toString('base64url'),
          info: {
            identifier: query,
            title,
            author,
            duration: 0,
            uri: query,
            artworkUrl: artwork,
            sourceName: 'podcast',
            isStream: false,
            position: 0,
          },
          source: 'podcast',
        })
      }
      return items
    } catch {
      return []
    }
  }

  async resolveTrack(_id: string): Promise<Track | null> {
    return null
  }

  async #search(q: string): Promise<Track[]> {
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=podcast&limit=10`)
      if (!res.ok) return []
      const data = await res.json()
      return (data.results ?? []).map((p: ITunesPodcast) => ({
        encoded: Buffer.from(p.feedUrl).toString('base64url'),
        info: {
          identifier: p.feedUrl,
          title: p.trackName ?? 'Unknown',
          author: p.artistName ?? 'Unknown',
          duration: 0,
          uri: p.feedUrl,
          artworkUrl: p.artworkUrl100 ?? '',
          sourceName: 'podcast',
          isStream: false,
          position: 0,
        },
        source: 'podcast',
      }))
    } catch {
      return []
    }
  }
}

function parseDuration(d: string): number {
  const parts = d.split(':')
  if (parts.length === 3) {
    return (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])) * 1000
  }
  if (parts.length === 2) {
    return (parseInt(parts[0]) * 60 + parseFloat(parts[1])) * 1000
  }
  return parseFloat(d) * 1000 || 0
}
