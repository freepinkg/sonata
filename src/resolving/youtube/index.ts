import { InnerTubeClient } from './innerTube.js'
import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'

const YT_REGEX = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//
const YT_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
const YT_PLAYLIST_REGEX = /[?&]list=([a-zA-Z0-9_-]+)/
const YT_WATCH_REGEX = /(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/

export class YouTubeSource implements AudioSource {
  name = 'youtube'
  #client = new InnerTubeClient()

  matches(url: string): boolean {
    return YT_REGEX.test(url) || YT_ID_REGEX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (!this.matches(query)) return this.#search(query)

    const videoId = this.#extractId(query)
    if (videoId) {
      const video = await this.#client.getVideo(videoId)
      if (video) return [this.#toTrack(video)]
    }

    const playlistId = this.#extractPlaylist(query)
    if (playlistId) {
      const results = await this.#client.getPlaylist(playlistId)
      return results.map(r => this.#toTrack(r))
    }

    return []
  }

  async resolveTrack(identifier: string): Promise<Track | null> {
    const video = await this.#client.getVideo(identifier)
    return video ? this.#toTrack(video) : null
  }

  async #search(query: string): Promise<Track[]> {
    const results = await this.#client.search(query)
    return results.map(r => this.#toTrack(r))
  }

  #extractId(url: string): string | null {
    const match = url.match(YT_WATCH_REGEX)
    if (match) return match[1]
    if (YT_ID_REGEX.test(url)) return url
    return null
  }

  #extractPlaylist(url: string): string | null {
    const match = url.match(YT_PLAYLIST_REGEX)
    return match ? match[1] : null
  }

  #toTrack(video: any): Track {
    return {
      encoded: video.videoId,
      info: {
        identifier: video.videoId,
        title: video.title ?? 'Unknown',
        author: video.author ?? 'Unknown',
        duration: video.duration ?? 0,
        uri: video.streamUrl ?? `https://youtube.com/watch?v=${video.videoId}`,
        artworkUrl: video.thumbnail ?? '',
        sourceName: 'youtube',
        isStream: (video.duration ?? 0) <= 0,
        position: 0,
      },
      source: 'youtube',
    }
  }
}
