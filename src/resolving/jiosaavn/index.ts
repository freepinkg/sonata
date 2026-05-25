import { createDecipheriv } from 'node:crypto'
import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'

const JIOSAAVN_REGEX = /^https?:\/\/(?:www\.)?jiosaavn\.com\//
const API_BASE = 'https://www.jiosaavn.com/api.php'

function decryptMediaUrl(encrypted: string, key: string): string | null {
  if (!key) return null
  try {
    const desKey = Buffer.from(key, 'utf8')
    const buf = Buffer.from(encrypted, 'base64')
    const decipher = createDecipheriv('des-ecb', desKey, null)
    decipher.setAutoPadding(true)
    const dec = Buffer.concat([decipher.update(buf), decipher.final()])
    let url = dec.toString('utf8')
    for (const ext of ['.mp4', '.m4a']) {
      const idx = url.indexOf(ext)
      if (idx !== -1) url = url.slice(0, idx + ext.length)
    }
    return url.replace(/^http:/, 'https:')
  } catch {
    return null
  }
}

interface JioSaavnSong {
  id: string
  song?: string
  title?: string
  album?: string
  image?: string
  perma_url?: string
  media_preview_url?: string
  vlink?: string
  encrypted_media_url?: string
  duration?: string
  primary_artists?: string
  singers?: string
  albumid?: string
  language?: string
  music?: string
  more_info?: {
    duration?: string
    music?: string
    primary_artists?: string
    singers?: string
    artistMap?: { primary_artists?: { name: string; id: string }[] }
  }
}

interface JioSaavnAlbum {
  albumid: string
  title: string
  perma_url: string
  image: string
  more_info?: { artistMap?: { artists?: { name: string }[] } }
  songs?: JioSaavnSong[]
  list?: string
}

interface JioSaavnPlaylist {
  listid: string
  title: string
  perma_url: string
  image: string
  songs?: JioSaavnSong[]
}

interface JioSaavnSearchResult {
  total: number
  start: number
  results: JioSaavnSong[]
}

async function apiCall(params: Record<string, string>, timeout = 10000): Promise<any | null> {
  const qs = new URLSearchParams({ __call: '', _format: 'json', _marker: '0', cc: 'us', ...params })
  try {
    const res = await fetch(`${API_BASE}?${qs}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text || text === 'null') return null
    try { return JSON.parse(text) } catch { return null }
  } catch {
    return null
  }
}

function extractToken(url: string): { type: string; token: string } | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const type = parts[0]
    const token = parts[parts.length - 1].split('?')[0].split('#')[0]
    return { type, token }
  } catch {
    return null
  }
}

export class JioSaavnSource implements AudioSource {
  name = 'jiosaavn'
  #decryptionKey = ''

  constructor(config?: { decryptionKey?: string }) {
    if (config?.decryptionKey) this.#decryptionKey = config.decryptionKey
  }

  configure(config: { decryptionKey?: string }) {
    if (config?.decryptionKey) this.#decryptionKey = config.decryptionKey
  }

  matches(url: string): boolean {
    return JIOSAAVN_REGEX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (query.startsWith('jiosaavnsearch:')) query = query.slice(15).trim()
    if (!this.matches(query)) return this.#search(query)
    return this.#resolveUrl(query)
  }

  async #resolveUrl(url: string): Promise<Track[]> {
    const info = extractToken(url)
    if (!info) return []

    try {
      const res = await apiCall({ __call: 'webapi.get', token: info.token, type: info.type, p: '1', n: '50', includeMetaTags: '0' })
      if (!res) return []

      if (info.type === 'song') {
        const song: JioSaavnSong = Object.values(res)[0] as any
        if (!song?.id) return []
        return [this.#make(song)]
      }

      if (info.type === 'album' || info.type === 'playlist') {
        const songs: JioSaavnSong[] = res.songs ?? res.list ?? []
        return songs.slice(0, 50).map((t) => this.#make(t))
      }

      return []
    } catch {
      return []
    }
  }

  async resolveTrack(identifier: string): Promise<Track | null> {
    try {
      const decodedId = Buffer.from(identifier, 'base64url').toString()
      const res = await apiCall({ __call: 'song.getDetails', pids: decodedId })
      if (!res) return null
      const song: JioSaavnSong = res[decodedId] || res
      if (!song?.id) return null
      return this.#make(song)
    } catch {
      return null
    }
  }

  async #search(q: string): Promise<Track[]> {
    try {
      const res = await apiCall({ __call: 'search.getResults', q, p: '1', n: '10' })
      if (!res) return []
      const data = res as JioSaavnSearchResult
      return (data.results ?? []).slice(0, 10).map((t) => this.#make(t))
    } catch {
      return []
    }
  }

  #make(t: JioSaavnSong): Track {
    const duration = parseFloat(t.duration ?? t.more_info?.duration ?? '0') * 1000
    const title = t.song ?? t.title ?? 'Unknown'
    const author = t.primary_artists
      ?? t.more_info?.primary_artists
      ?? t.singers
      ?? t.more_info?.music
      ?? t.music
      ?? 'Unknown'
    let audioUrl = ''
    let fallbackUrl = ''
    if (t.encrypted_media_url && this.#decryptionKey) {
      audioUrl = decryptMediaUrl(t.encrypted_media_url, this.#decryptionKey) ?? ''
    }
    if (!audioUrl) {
      audioUrl = t.vlink ?? t.media_preview_url ?? ''
    } else {
      fallbackUrl = t.vlink ?? t.media_preview_url ?? ''
    }

    return {
      encoded: Buffer.from(t.id).toString('base64url'),
      info: {
        identifier: t.id,
        title,
        author,
        duration: isNaN(duration) ? 0 : duration,
        uri: t.perma_url ?? '',
        artworkUrl: (t.image ?? '').replace('-150x150', '-500x500'),
        sourceName: 'jiosaavn',
        isStream: false,
        position: 0,
      },
      source: 'jiosaavn',
      userData: audioUrl ? { audioUrl, fallbackUrl: fallbackUrl || undefined } : undefined,
    }
  }
}
