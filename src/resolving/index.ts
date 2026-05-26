import { AudioSourceManager } from './manager.js'
import { MirrorResolver } from './mirror.js'
import type { Track, LoadTracksResult } from '../types/index.js'
import type { Logger } from '../utils/logger.js'

interface ResolverConfig {
  youtube: { enabled: boolean; clientProfiles?: string[]; proxy?: string; apiKey?: string; clientName?: string; timeout?: number; maxResults?: number; fetchPlayerJS?: boolean; oauth?: { getOAuthToken?: boolean; refreshToken?: string }; cipher?: { url?: string; token?: string }; poToken?: { service?: string; token?: string }; playerUrl?: string }
  soundcloud: { enabled: boolean; clientId?: string; apiUrl?: string; resolveRedirects?: boolean; timeout?: number }
  spotify: { enabled: boolean; clientId: string; clientSecret: string; market?: string; country?: string; maxPlaylistTracks?: number; resolverFlavor?: string; retryCount?: number; spDc?: string }
  bandcamp?: boolean
  twitch?: boolean
  vimeo?: boolean
  deezer?: { enabled: boolean; arl?: string; proxy?: string }
  apple?: boolean
  nico?: boolean
  mixcloud?: boolean
  podcast?: boolean
  tiktok?: boolean
  jiosaavn?: { enabled: boolean; decryptionKey?: string }
  http?: boolean
  local?: boolean
}

export class Resolver {
  #sourceManager = new AudioSourceManager()
  #mirror: MirrorResolver
  #resolvingCfg: any = {}
  #logger: Logger | null = null

  constructor() {
    this.#mirror = new MirrorResolver(this.#sourceManager)
  }

  setLogger(logger: Logger) {
    this.#logger = logger
    this.#sourceManager.setLogger(logger)
  }

  async init(config: ResolverConfig, resolvingCfg?: any) {
    this.#resolvingCfg = resolvingCfg ?? {}
    await this.#registerSources(config)
  }

  resolveSourceName(name: string): string {
    const aliases = this.#resolvingCfg?.searchAliases
    if (aliases && aliases[name]) return aliases[name]
    return name
  }

  get sourceManager() { return this.#sourceManager }
  get mirror() { return this.#mirror }

  async resolveAsync(query: string): Promise<LoadTracksResult> {
    if (query.startsWith('ytmixes:')) {
      const videoId = query.slice(8)
      const yt = this.#sourceManager.get('youtube') as any
      if (yt?.getMix) {
        const tracks = await yt.getMix(videoId)
        if (tracks.length > 0) {
          return { loadType: 'playlist', tracks, playlistInfo: { name: 'Recommended', trackCount: tracks.length } }
        }
      }
    }

    if (query.startsWith('ytplaylist:')) {
      const searchQuery = query.slice(11)
      const yt = this.#sourceManager.get('youtube') as any
      if (yt?.searchPlaylist) {
        const tracks = await yt.searchPlaylist(searchQuery)
        if (tracks.length > 0) {
          return { loadType: 'playlist', tracks, playlistInfo: { name: tracks[0]?.info?.title || 'Playlist', trackCount: tracks.length } }
        }
      }
    }

    const result = await this.#sourceManager.resolve(query)

    if (!result) {
      return { loadType: 'empty', tracks: [] }
    }

    const { tracks } = result
    let loadType: LoadTracksResult['loadType'] = 'search'

    if (tracks.length === 1) loadType = 'track'
    else if (tracks.length > 1) loadType = 'search'
    else loadType = 'empty'

    const needsMirror = tracks.some(t => (t as any).needsResolve)
    if (needsMirror && tracks.length === 1) {
      const resolved = await this.#mirror.resolve(tracks[0])
      if (resolved) return { loadType: 'track', tracks: [resolved] }
    }

    return { loadType, tracks }
  }

  async resolveTrackAsync(encoded: string): Promise<Track | null> {
    const track = await this.#sourceManager.resolveTrack(encoded)
    if (track && (track as any).needsResolve) {
      return this.#mirror.resolve(track)
    }
    return track
  }

  async #registerSources(config: ResolverConfig) {
    if (config.youtube?.enabled) {
      const mod = await import('./youtube/index.js')
      this.#sourceManager.register(new mod.YouTubeSource(config.youtube))
    }
    if (config.soundcloud?.enabled) {
      const mod = await import('./soundcloud/index.js')
      this.#sourceManager.register(new mod.SoundCloudSource(config.soundcloud))
    }
    if (config.spotify?.enabled && config.spotify.clientId && config.spotify.clientSecret) {
      const mod = await import('./spotify/index.js')
      this.#sourceManager.register(new mod.SpotifySource({
        clientId: config.spotify.clientId,
        clientSecret: config.spotify.clientSecret,
        spDc: config.spotify.spDc,
        market: config.spotify.market,
      }))
    }
    await this.#registerOptional(config.http, './http/index.js', 'HTTPSource')
    await this.#registerOptional(config.local, './local/index.js', 'LocalSource')
    await this.#registerOptional(config.bandcamp, './bandcamp/index.js', 'BandcampSource')
    await this.#registerOptional(config.twitch, './twitch/index.js', 'TwitchSource')
    await this.#registerOptional(config.vimeo, './vimeo/index.js', 'VimeoSource')
    await this.#registerOptional(config.deezer, './deezer/index.js', 'DeezerSource')
    await this.#registerOptional(config.apple, './apple/index.js', 'AppleMusicSource')
    await this.#registerOptional(config.nico, './nico/index.js', 'NicoNicoSource')
    await this.#registerOptional(config.mixcloud, './mixcloud/index.js', 'MixcloudSource')
    await this.#registerOptional(config.podcast, './podcast/index.js', 'PodcastSource')
    await this.#registerOptional(config.tiktok, './tiktok/index.js', 'TikTokSource')
    await this.#registerOptional(config.jiosaavn, './jiosaavn/index.js', 'JioSaavnSource')
  }

  async #registerOptional(enabled: boolean | { enabled: boolean } | undefined, path: string, className: string) {
    const isEnabled = typeof enabled === 'object' ? enabled.enabled : enabled
    if (!isEnabled) return
    try {
      const mod = await import(path)
      const SourceClass = mod[className]
      if (SourceClass) {
        const instance = typeof enabled === 'object' ? new SourceClass(enabled) : new SourceClass()
        if (typeof enabled === 'object' && typeof instance.configure === 'function') {
          instance.configure(enabled)
        }
        this.#sourceManager.register(instance)
      }
    } catch {}
  }
}
