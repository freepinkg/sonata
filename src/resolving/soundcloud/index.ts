import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'

const SC_REGEX = /^https?:\/\/(?:www\.)?soundcloud\.com\//
const SC_PREFIX = /^sc(?:search)?:/i
const API_BASE = 'https://api-v2.soundcloud.com'

interface SoundCloudTrack {
  id: number
  title: string
  user: { username: string }
  duration: number
  permalink_url: string
  artwork_url: string | null
  stream_url: string
}

export class SoundCloudSource implements AudioSource {
  name = 'soundcloud'
  #clientId: string | null = null
  #clientIdPromise: Promise<string | null> | null = null

  constructor(config?: { clientId?: string }) {
    if (config?.clientId) this.#clientId = config.clientId
  }

  matches(url: string): boolean {
    return SC_REGEX.test(url) || SC_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    const clientId = await this.#getClientId()
    if (!clientId) return []

    if (SC_PREFIX.test(query)) return this.#search(query.replace(SC_PREFIX, '').trim(), clientId)
    if (!SC_REGEX.test(query)) return this.#search(query, clientId)

    const tracks = await this.#resolveURL(query, clientId)
    return tracks
  }

  async resolveTrack(identifier: string): Promise<Track | null> {
    const clientId = await this.#getClientId()
    if (!clientId) return null

    try {
      const trackId = Number(identifier)
      if (isNaN(trackId)) return null

      const res = await fetch(`${API_BASE}/tracks/${trackId}?client_id=${clientId}`)
      if (!res.ok) return null

      const data: SoundCloudTrack = await res.json()
      return this.#toTrack(data)
    } catch {
      return null
    }
  }

  async #search(query: string, clientId: string): Promise<Track[]> {
    try {
      const res = await fetch(`${API_BASE}/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=10`)
      if (!res.ok) return []

      const data = await res.json()
      return (data.collection ?? []).slice(0, 10).map((t: SoundCloudTrack) => this.#toTrack(t))
    } catch {
      return []
    }
  }

  async #resolveURL(url: string, clientId: string): Promise<Track[]> {
    try {
      const res = await fetch(`${API_BASE}/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`)
      if (!res.ok) return []

      const data = await res.json()

      if (data.kind === 'track') {
        return [this.#toTrack(data as SoundCloudTrack)]
      }

      if (data.kind === 'playlist' || data.kind === 'system-playlist') {
        const tracks: SoundCloudTrack[] = data.tracks ?? []
        return tracks.slice(0, 50).map((t: SoundCloudTrack) => this.#toTrack(t))
      }

      return []
    } catch {
      return []
    }
  }

  async #getClientId(): Promise<string | null> {
    if (this.#clientId) return this.#clientId
    if (this.#clientIdPromise) return this.#clientIdPromise

    this.#clientIdPromise = this.#fetchClientId()
    this.#clientId = await this.#clientIdPromise
    return this.#clientId
  }

  async #fetchClientId(): Promise<string | null> {
    try {
      const res = await fetch('https://m.soundcloud.com', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' },
      })
      const html = await res.text()
      const match = html.match(/client_id[=:]['"]([a-zA-Z0-9_-]+)['"]/)
      if (match) return match[1]
    } catch {}

    try {
      const res = await fetch('https://soundcloud.com', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      const html = await res.text()
      const match = html.match(/,client_id:"([a-zA-Z0-9_-]+)"/)
      if (match) return match[1]
      const jsMatch = html.match(/client_id=([a-zA-Z0-9_-]+)/)
      if (jsMatch) return jsMatch[1]
    } catch {}

    return 'iZIs9mchVc8GqQq4zNE6aB7qgM9v'
  }

  #toTrack(t: SoundCloudTrack): Track {
    return {
      encoded: String(t.id),
      info: {
        identifier: String(t.id),
        title: t.title ?? 'Unknown',
        author: t.user?.username ?? 'Unknown',
        duration: t.duration,
        uri: t.permalink_url ?? '',
        artworkUrl: t.artwork_url ?? '',
        sourceName: 'soundcloud',
        isStream: false,
        position: 0,
      },
      source: 'soundcloud',
    }
  }
}
