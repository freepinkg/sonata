import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'

const NICO_REGEX = /^https?:\/\/(?:www\.)?nicovideo\.jp\//
const NICO_PREFIX = /^nico(?:search)?:/i

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

interface NicoVideo {
  id: string
  title: string
  thumbnailUrl: string
  lengthSeconds: number
  channelName?: string
}

export class NicoNicoSource implements AudioSource {
  name = 'nico'

  matches(url: string): boolean {
    return NICO_REGEX.test(url) || NICO_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (NICO_PREFIX.test(query)) return this.#search(query.replace(NICO_PREFIX, '').trim())
    if (!this.matches(query)) return this.#search(query)
    try {
      const res = await fetch(query, { headers: { 'User-Agent': UA } })
      const html = await res.text()
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() ?? 'Unknown'
      const author =
        html.match(/"channelName":"([^"]+)"/)?.[1] ??
        html.match(/"nickname":"([^"]+)"/)?.[1] ??
        'NicoNico'
      const cleanTitle = title.replace(/ - ニコニコ動画$/, '')
      return [this.#make(query, cleanTitle, author, 0, query, '')]
    } catch {
      return []
    }
  }

  async resolveTrack(_id: string): Promise<Track | null> {
    return null
  }

  async #search(q: string): Promise<Track[]> {
    try {
      const res = await fetch(`https://www.nicovideo.jp/api/search/tag/${encodeURIComponent(q)}?sort=f&order=d&limit=10`, {
        headers: { 'User-Agent': UA },
      })
      if (!res.ok) return []
      const data = await res.json()
      const list: NicoVideo[] = data.list ?? data ?? []
      return list.slice(0, 10).map((v) => {
        const url = `https://www.nicovideo.jp/watch/${v.id}`
        return this.#make(url, v.title ?? 'Unknown', v.channelName ?? 'NicoNico', (v.lengthSeconds ?? 0) * 1000, url, v.thumbnailUrl ?? '')
      })
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
        sourceName: 'nico',
        isStream: false,
        position: 0,
      },
      source: 'nico',
    }
  }
}
