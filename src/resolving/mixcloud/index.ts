import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'

const MIXCLOUD_REGEX = /^https?:\/\/(?:www\.)?mixcloud\.com\//
const MX_PREFIX = /^mx(?:search)?:/i

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

interface MixcloudItem {
  key: string
  name: string
  url: string
  owner: { username: string }
  pictures?: { large?: string }
  audio_length: number
}

export class MixcloudSource implements AudioSource {
  name = 'mixcloud'

  matches(url: string): boolean {
    return MIXCLOUD_REGEX.test(url) || MX_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (MX_PREFIX.test(query)) return this.#search(query.replace(MX_PREFIX, '').trim())
    if (!this.matches(query)) return this.#search(query)
    try {
      const res = await fetch(query, { headers: { 'User-Agent': UA } })
      const html = await res.text()
      const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? 'Unknown'
      const desc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? ''
      const author = html.match(/"username":"([^"]+)"/)?.[1] ?? 'Mixcloud'
      return [this.#make(query, title, author, 0, query, desc)]
    } catch {
      return []
    }
  }

  async resolveTrack(_id: string): Promise<Track | null> {
    return null
  }

  async #search(q: string): Promise<Track[]> {
    try {
      const res = await fetch(`https://api.mixcloud.com/search/?q=${encodeURIComponent(q)}&type=cloudcast&limit=10`, {
        headers: { 'User-Agent': UA },
      })
      if (!res.ok) return []
      const data = await res.json()
      return (data.data ?? []).slice(0, 10).map((item: MixcloudItem) =>
        this.#make(
          item.key,
          item.name ?? 'Unknown',
          item.owner?.username ?? 'Mixcloud',
          (item.audio_length ?? 0) * 1000,
          item.url ?? '',
          item.pictures?.large ?? '',
        ),
      )
    } catch {
      return []
    }
  }

  #make(uri: string, title: string, author: string, dur: number, trackUrl: string, artwork: string): Track {
    return {
      encoded: Buffer.from(uri).toString('base64url'),
      info: {
        identifier: uri,
        title,
        author,
        duration: dur,
        uri: trackUrl,
        artworkUrl: artwork,
        sourceName: 'mixcloud',
        isStream: false,
        position: 0,
      },
      source: 'mixcloud',
    }
  }
}
