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
  WEB: {
    name: 'WEB',
    key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    clientName: 'WEB',
    clientVersion: '2.20240301.00.00',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  },
  MUSIC: {
    name: 'WEB_REMIX',
    key: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30',
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240301.00.00',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  },
  ANDROID: {
    name: 'ANDROID',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    clientName: 'ANDROID',
    clientVersion: '19.09.37',
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 12) gzip',
  },
  IOS: {
    name: 'IOS',
    key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    clientName: 'IOS',
    clientVersion: '19.09.37',
    userAgent: 'com.google.ios.youtube/19.09.37 (iPhone; iOS 17.0; Scale/2.00)',
  },
  TV: {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '2.0',
    userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
  #profiles: ClientProfile[] = [CLIENTS.WEB, CLIENTS.MUSIC, CLIENTS.ANDROID, CLIENTS.IOS, CLIENTS.TV]

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
    const body = {
      query,
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: 'en',
          gl: 'US',
        },
      },
    }

    const res = await fetch(`${BASE_URL}/search?key=${client.key}`, {
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
    }

    const res = await fetch(`${BASE_URL}/player?key=${client.key}`, {
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

    const res = await fetch(`${BASE_URL}/browse?key=${client.key}`, {
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
    try {
      const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? []
      for (const section of contents) {
        const items = section?.itemSectionRenderer?.contents ?? []
        for (const item of items) {
          const video = item?.videoRenderer
          if (!video) continue
          const videoId = video?.videoId
          if (!videoId) continue

          const len = video?.lengthText?.simpleText ?? video?.lengthText?.runs?.[0]?.text ?? '0:00'
          results.push({
            videoId,
            title: this.#getText(video?.title),
            author: this.#getText(video?.ownerText ?? video?.longBylineText),
            duration: this.#parseDuration(len),
            thumbnail: video?.thumbnail?.thumbnails?.[video.thumbnail.thumbnails.length - 1]?.url ?? '',
          })
        }
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
