import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'
import type { MirroredTrack } from '../spotify/index.js'

const APPLE_REGEX = /^https?:\/\/music\.apple\.com\//
const APPLE_PREFIX = /^am(?:search)?:/i

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

interface ITunesTrack {
  trackId: number
  trackName: string
  artistName: string
  trackTimeMillis: number
  trackViewUrl: string
  artworkUrl100: string
  isrc?: string
}

export class AppleMusicSource implements AudioSource {
  name = 'apple'

  matches(url: string): boolean {
    return APPLE_REGEX.test(url) || APPLE_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (APPLE_PREFIX.test(query)) return this.#search(query.replace(APPLE_PREFIX, '').trim())
    if (!APPLE_REGEX.test(query)) return this.#search(query)
    try {
      const res = await fetch(query, { headers: { 'User-Agent': UA } })
      const html = await res.text()
      const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? 'Unknown'
      const author =
        html.match(/<meta property="music:artist" content="([^"]+)"/)?.[1] ??
        html.match(/"artistName":"([^"]+)"/)?.[1] ??
        'Apple Music'
      return [this.#mirror(query, title, author, 0, query, '', null)]
    } catch {
      return []
    }
  }

  async resolveTrack(_id: string): Promise<Track | null> {
    return null
  }

  async #search(q: string): Promise<Track[]> {
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=10`)
      if (!res.ok) return []
      const data = await res.json()
      return (data.results ?? []).map((t: ITunesTrack) =>
        this.#mirror(
          String(t.trackId),
          t.trackName ?? 'Unknown',
          t.artistName ?? 'Unknown',
          t.trackTimeMillis ?? 0,
          t.trackViewUrl ?? '',
          t.artworkUrl100 ?? '',
          t.isrc ?? null,
        ),
      )
    } catch {
      return []
    }
  }

  #mirror(id: string, title: string, author: string, dur: number, trackUrl: string, artwork: string, isrc: string | null): MirroredTrack {
    const queries: string[] = []
    if (isrc) queries.push(`ytsearch:${isrc}`)
    queries.push(`ytsearch:${title} ${author}`)

    return {
      encoded: Buffer.from(id).toString('base64url'),
      needsResolve: true,
      resolveQuery: queries.join(' || '),
      info: {
        identifier: id,
        title,
        author,
        duration: dur,
        uri: trackUrl,
        artworkUrl: artwork,
        sourceName: 'apple',
        isStream: false,
        position: 0,
      },
      source: 'apple',
    }
  }
}
