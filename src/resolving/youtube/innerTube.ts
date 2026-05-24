import type { YouTubeFormat as YTFormat } from './cipher.js'
import { extractStreamUrl, selectBestAudioFormat } from './cipher.js'

type YouTubeFormat = YTFormat

interface ClientProfile {
  name: string
  key: string
  clientName: string
  clientVersion: string
  userAgent: string
}

const CLIENTS: Record<string, ClientProfile> = {
  ANDROID_VR: {
    name: 'ANDROID_VR',
    key: '',
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/39.3.0.11.46.766180192 Chrome/136.0.7103.177 VR Safari/537.36,gzip(gfe);GoogleHypersonic',
  },
  WEB: {
    name: 'WEB',
    key: '',
    clientName: 'WEB',
    clientVersion: '2.20250301.00.00',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36,gzip(gfe)',
  },
  ANDROID: {
    name: 'ANDROID',
    key: '',
    clientName: 'ANDROID',
    clientVersion: '20.01.35',
    userAgent: 'com.google.android.youtube/20.01.35 (Linux; U; Android 14) gzip',
  },
  IOS: {
    name: 'IOS',
    key: '',
    clientName: 'IOS',
    clientVersion: '21.02.1',
    userAgent: 'com.google.ios.youtube/21.02.1 (iPhone16,2; U; CPU iOS 18_2)',
  },
  TV: {
    name: 'TVHTML5',
    key: '',
    clientName: 'TVHTML5',
    clientVersion: '7.20260113.16.00',
    userAgent: 'Mozilla/5.0 (Fuchsia) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36,gzip(gfe)',
  },
}

const BASE_URL = 'https://youtubei.googleapis.com/youtubei/v1'

interface InnerTubeVideo {
  videoId: string
  title: string
  author: string
  duration: number
  thumbnail: string
  formats?: YouTubeFormat[]
  streamUrl?: string | null
  expiresInSeconds?: string
}

interface InnerTubeSearchResult {
  videoId: string
  title: string
  author: string
  duration: number
  thumbnail: string
}

export class InnerTubeClient {
  #profiles: ClientProfile[]

  constructor(clientProfiles?: string[], private proxy?: string) {
    this.#profiles = clientProfiles?.length
      ? clientProfiles.map(name => CLIENTS[name]).filter(Boolean)
      : [CLIENTS.ANDROID_VR, CLIENTS.ANDROID, CLIENTS.IOS, CLIENTS.WEB, CLIENTS.TV]
  }

  async search(query: string): Promise<InnerTubeSearchResult[]> {
    for (const client of this.#profiles) {
      try {
        return await this.#searchWithClient(query, client)
      } catch { continue }
    }
    return []
  }

  async getVideo(videoId: string): Promise<InnerTubeVideo | null> {
    for (const client of this.#profiles) {
      try {
        return await this.#getVideoWithClient(videoId, client)
      } catch { continue }
    }
    return null
  }

  async getPlaylist(playlistId: string): Promise<InnerTubeSearchResult[]> {
    for (const client of this.#profiles) {
      try {
        return await this.#getPlaylistWithClient(playlistId, client)
      } catch { continue }
    }
    return []
  }

  async #searchWithClient(query: string, client: ClientProfile): Promise<InnerTubeSearchResult[]> {
    const body: Record<string, any> = {
      query,
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: 'en',
          gl: 'US',
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    }

    const res = await fetch(`${BASE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': client.userAgent },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`InnerTube search failed: ${res.status}`)
    const data = await res.json()

    return this.#parseSearchResults(data)
  }

  async #getVideoWithClient(videoId: string, client: ClientProfile): Promise<InnerTubeVideo> {
    const body = {
      videoId,
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: 'en',
          gl: 'US',
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    }

    const res = await fetch(`${BASE_URL}/player`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': client.userAgent },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`InnerTube player failed: ${res.status}`)
    const data = await res.json()

    return this.#parseVideoResponse(data, videoId)
  }

  async #getPlaylistWithClient(playlistId: string, client: ClientProfile): Promise<InnerTubeSearchResult[]> {
    const body = {
      browseId: `VL${playlistId}`,
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: 'en',
          gl: 'US',
        },
      },
    }

    const res = await fetch(`${BASE_URL}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': client.userAgent },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`InnerTube browse failed: ${res.status}`)
    const data = await res.json()

    return this.#parsePlaylistResponse(data)
  }

  #parseSearchResults(data: any): InnerTubeSearchResult[] {
    const results: InnerTubeSearchResult[] = []

    const tryExtract = (contents: any[]) => {
      if (!contents) return false
      for (const section of contents) {
        const items = section?.itemSectionRenderer?.contents ?? []
        for (const item of items) {
          const video = item?.videoRenderer || item?.compactVideoRenderer
          if (!video) continue
          const videoId = video?.videoId
          if (!videoId) continue

          const len = video?.lengthText?.simpleText ?? video?.lengthText?.runs?.[0]?.text ?? '0:00'
          results.push({
            videoId,
            title: this.#getText(video?.title),
            author: this.#getText(video?.ownerText ?? video?.longBylineText ?? video?.shortBylineText),
            duration: this.#parseDuration(len),
            thumbnail: video?.thumbnail?.thumbnails?.[video.thumbnail.thumbnails.length - 1]?.url ?? '',
          })
        }
      }
      return results.length > 0
    }

    try {
      if (tryExtract(data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents)) return results
      const sections = data?.contents?.sectionListRenderer?.contents
      if (sections) {
        const last = sections[sections.length - 1]
        if (tryExtract([last])) return results
      }
    } catch { /* parse errors are non-fatal */ }
    return results
  }

  #parseVideoResponse(data: any, videoId: string): InnerTubeVideo {
    const details = data?.videoDetails ?? {}
    const formats: YouTubeFormat[] = [
      ...(data?.streamingData?.formats ?? []),
      ...(data?.streamingData?.adaptiveFormats ?? []),
    ]

    const best = selectBestAudioFormat(formats)
    const streamUrl = best ? extractStreamUrl(best) : null

    return {
      videoId,
      title: details?.title ?? 'Unknown',
      author: details?.author ?? 'Unknown',
      duration: Number(details?.lengthSeconds ?? 0) * 1000,
      thumbnail: details?.thumbnail?.thumbnails?.[details.thumbnail.thumbnails.length - 1]?.url ?? '',
      formats,
      streamUrl,
      expiresInSeconds: data?.streamingData?.expiresInSeconds,
    }
  }

  #parsePlaylistResponse(data: any): InnerTubeSearchResult[] {
    const results: InnerTubeSearchResult[] = []
    try {
      const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? []
      for (const tab of tabs) {
        const contents = tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? []
        for (const section of contents) {
          const items = section?.itemSectionRenderer?.contents ?? section?.playlistVideoListRenderer?.contents ?? []
          for (const item of items) {
            const video = item?.playlistVideoRenderer ?? item?.videoRenderer
            if (!video?.videoId) continue

            const len = video?.lengthText?.simpleText ?? video?.lengthText?.runs?.[0]?.text ?? '0:00'
            results.push({
              videoId: video.videoId,
              title: this.#getText(video?.title),
              author: this.#getText(video?.ownerText ?? video?.shortBylineText),
              duration: this.#parseDuration(len),
              thumbnail: video?.thumbnail?.thumbnails?.[video.thumbnail.thumbnails.length - 1]?.url ?? '',
            })
          }
        }
      }
    } catch { /* ignore */ }
    return results
  }

  #getText(obj: any): string {
    if (!obj) return 'Unknown'
    if (typeof obj === 'string') return obj
    if (obj.simpleText) return obj.simpleText
    if (obj.runs) return obj.runs.map((r: any) => r.text).join('')
    return 'Unknown'
  }

  #parseDuration(s: string): number {
    const parts = s.split(':').map(Number)
    if (parts.length === 3) return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000
    if (parts.length === 2) return ((parts[0] * 60) + parts[1]) * 1000
    return Number(parts[0]) * 1000 || 0
  }
}
