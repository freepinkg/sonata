import https from 'node:https'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'

const DEEZER_REGEX = /^https?:\/\/(?:www\.)?deezer\.com\//
const DZ_PREFIX = /^dz(?:search)?:/i
const API_BASE = 'https://api.deezer.com'
const GW_URL = 'https://www.deezer.com/ajax/gw-light.php'
const MEDIA_URL = 'https://media.deezer.com/v1/get_url'

interface DeezerTrack {
  id: number
  title: string
  link: string
  duration: number
  preview: string
  artist: { name: string }
  album: { title: string; cover_big: string }
}

interface DeezerAlbum {
  id: number
  title: string
  link: string
  artist: { name: string }
  cover_big: string
  tracks: { data: DeezerTrack[] }
}

interface DeezerPlaylist {
  id: number
  title: string
  link: string
  creator: { name: string }
  picture_big: string
  tracks: { data: DeezerTrack[] }
}

interface DeezerTrackData {
  sngId: number
  md5Origin: string
  mediaVersion: string
  filesize: string
  trackToken: string
  trackTokenExpire: number
}

const MEDIA_FORMATS = [
  { cipher: 'BF_CBC_STRIPE', format: 'FLAC' },
  { cipher: 'BF_CBC_STRIPE', format: 'MP3_256' },
  { cipher: 'BF_CBC_STRIPE', format: 'MP3_128' },
  { cipher: 'BF_CBC_STRIPE', format: 'MP3_MISC' },
]

export class DeezerSource implements AudioSource {
  name = 'deezer'
  #arl: string
  #sid: string | null = null
  #sidExpires = 0
  #apiToken: string | null = null
  #apiTokenExpires = 0
  #licenseToken: string | null = null
  #licenseTokenExpires = 0
  #proxy: string | null = null
  #agent: any = null

  #logger: any = null

  constructor(config?: { arl?: string; decryptionKey?: string; proxy?: string }) {
    this.#arl = config?.arl ?? ''
    this.#proxy = config?.proxy ?? null
    if (this.#proxy) {
      this.#agent = new SocksProxyAgent(this.#proxy)
    }
  }

  matches(url: string): boolean {
    return DEEZER_REGEX.test(url) || DZ_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (query.startsWith('deezersearch:')) query = query.slice(13).trim()
    if (DZ_PREFIX.test(query)) return this.#search(query.replace(DZ_PREFIX, '').trim())
    if (!this.matches(query)) return this.#search(query)
    try {
      const parts = new URL(query).pathname.split('/').filter(Boolean)
      if (parts.length < 2) return []

      const type = parts[0]
      const id = parts[1]

      if (type === 'track') {
        const res = await fetch(`${API_BASE}/track/${id}`)
        if (!res.ok) return []
        const data: DeezerTrack = await res.json()
        return [await this.#make(data)]
      }

      if (type === 'album') {
        const res = await fetch(`${API_BASE}/album/${id}`)
        if (!res.ok) return []
        const data: DeezerAlbum = await res.json()
        return await Promise.all((data.tracks?.data ?? []).slice(0, 50).map(t => this.#make(t)))
      }

      if (type === 'playlist') {
        const res = await fetch(`${API_BASE}/playlist/${id}`)
        if (!res.ok) return []
        const data: DeezerPlaylist = await res.json()
        return await Promise.all((data.tracks?.data ?? []).slice(0, 50).map(t => this.#make(t)))
      }

      return []
    } catch {
      return []
    }
  }

  async resolveTrack(identifier: string): Promise<Track | null> {
    try {
      const id = parseInt(identifier, 10)
      if (isNaN(id)) return null
      const res = await fetch(`${API_BASE}/track/${id}`)
      if (!res.ok) return null
      const data: DeezerTrack = await res.json()
      return await this.#make(data)
    } catch {
      return null
    }
  }

  #fetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.#agent) return fetch(url, options)
    const urlObj = new URL(url)
    const headers = (options.headers as Record<string, string>) ?? {}
    const body = options.body as string | undefined
    const isPost = options.method === 'POST' || (!options.method && body)
    return new Promise((resolve, reject) => {
      const reqOpts: https.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: isPost ? 'POST' : 'GET',
        headers,
        agent: this.#agent!,
      }
      const req = https.request(reqOpts, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? '',
            headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])),
          }))
        })
      })
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }

  async #getSID(): Promise<string | null> {
    if (
      this.#sid && this.#apiToken && this.#licenseToken &&
      Date.now() < this.#sidExpires &&
      Date.now() < this.#apiTokenExpires &&
      Date.now() < this.#licenseTokenExpires
    ) return this.#sid

    if (!this.#arl) return null

    try {
      const res = await this.#fetch(`${GW_URL}?method=deezer.getUserData&api_version=1.0&api_token=`, {
        method: 'POST',
        headers: {
          Cookie: `arl=${this.#arl}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        redirect: 'manual',
      })

      const text = await res.text()
      try {
        const json = JSON.parse(text)
        const r = json.results ?? {}
        const sid = r.SESSION_ID
        if (sid) {
          this.#sid = sid
          this.#sidExpires = Date.now() + 3600_000
        }
        const token = r.checkForm
        if (token) {
          this.#apiToken = token
          this.#apiTokenExpires = Date.now() + 3600_000
        }
        const licenseToken = r.USER?.OPTIONS?.license_token
        if (licenseToken) {
          this.#licenseToken = licenseToken
          this.#licenseTokenExpires = Date.now() + 3600_000
        }
        if (sid) return this.#sid
      } catch {}

      return null
    } catch {
      return null
    }
  }

  async #getTrackData(trackId: number): Promise<DeezerTrackData | null> {
    const sid = await this.#getSID()
    if (!sid || !this.#apiToken) return null

    try {
      const res = await this.#fetch(`${GW_URL}?method=song.getData&api_version=1.0&api_token=${this.#apiToken}`, {
        method: 'POST',
        headers: {
          Cookie: `sid=${sid}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sng_id: trackId }),
      })

      const json: any = await res.json()
      const data = json?.results
      if (!data?.MD5_ORIGIN) return null

      return {
        sngId: data.SNG_ID,
        md5Origin: data.MD5_ORIGIN,
        mediaVersion: data.MEDIA_VERSION,
        filesize: String(data.FILESIZE),
        trackToken: data.TRACK_TOKEN,
        trackTokenExpire: data.TRACK_TOKEN_EXPIRE,
      }
    } catch {
      return null
    }
  }

  async #getStreamUrl(trackToken: string): Promise<string | null> {
    if (!this.#licenseToken) return null

    try {
      const res = await fetch(MEDIA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_token: this.#licenseToken,
          media: [{ type: 'FULL', formats: MEDIA_FORMATS }],
          track_tokens: [trackToken],
        }),
      })

      if (!res.ok) return null

      const json: any = await res.json()
      return json?.data?.[0]?.media?.[0]?.sources?.[0]?.url ?? null
    } catch {
      return null
    }
  }

  #buildStreamUrl(data: DeezerTrackData): string | null {
    const { sngId, md5Origin, mediaVersion, filesize, trackToken } = data
    if (!md5Origin) return null

    const cdn = (sngId % 10) + 1
    const params = new URLSearchParams({
      track_id: String(sngId),
      media_version: mediaVersion,
      filesize,
      track_token: trackToken,
    })

    return `https://e-cdns-proxy-${cdn}.dzcdn.net/mobile/1/${md5Origin}?${params}`
  }

  async #make(t: DeezerTrack): Promise<Track> {
    const id = t.id
    let audioUrl: string | undefined = t.preview || undefined

    if (this.#arl) {
      const trackData = await this.#getTrackData(id)
      if (trackData?.trackToken) {
        const mediaUrl = await this.#getStreamUrl(trackData.trackToken)
        if (mediaUrl) {
          audioUrl = mediaUrl
        } else {
          const streamUrl = this.#buildStreamUrl(trackData)
          if (streamUrl) audioUrl = streamUrl
        }
      }
    }

    const info = {
      identifier: String(id),
      title: t.title ?? 'Unknown',
      author: t.artist?.name ?? 'Unknown',
      duration: t.duration * 1000,
      uri: t.link ?? '',
      artworkUrl: t.album?.cover_big ?? '',
      sourceName: 'deezer',
      isStream: false,
      position: 0,
    }
    const encoded = Buffer.from(JSON.stringify({ ...info, v: 2, s: 'deezer', ud: audioUrl ? { audioUrl } : undefined })).toString('base64')
    return {
      encoded,
      info,
      source: 'deezer',
      userData: audioUrl ? { audioUrl } : undefined,
    }
  }

  async #search(q: string): Promise<Track[]> {
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`)
      if (!res.ok) return []
      const data = await res.json()
      return await Promise.all((data.data ?? []).slice(0, 10).map((t: DeezerTrack) => this.#make(t)))
    } catch {
      return []
    }
  }
}
