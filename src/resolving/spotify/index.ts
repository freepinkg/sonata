import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'
import { getLocalToken } from './auth.js'

const SP_REGEX = /^https?:\/\/(?:open\.)?spotify\.com\//
const SP_PREFIX = /^sp(?:search)?:/i
const API_BASE = 'https://api.spotify.com/v1'
const SPCLIENT_BASE = 'https://spclient.wg.spotify.com'
const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v2/query'

const TOKEN_REFRESH_MARGIN = 300_000

type TokenTier = 'official' | 'anonymous' | 'mobile'

interface TokenState {
  token: string | null
  expiresAt: number
}

interface GraphQLOp {
  name: string
  hash: string
}

const QUERIES: Record<string, GraphQLOp> = {
  getTrack: {
    name: 'getTrack',
    hash: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294',
  },
  getAlbum: {
    name: 'getAlbum',
    hash: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
  },
  getPlaylist: {
    name: 'fetchPlaylist',
    hash: 'bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77',
  },
  getArtist: {
    name: 'queryArtistOverview',
    hash: '35648a112beb1794e39ab931365f6ae4a8d45e65396d641eeda94e4003d41497',
  },
  searchDesktop: {
    name: 'searchDesktop',
    hash: 'fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c',
  },
}

interface GraphQLTrack {
  uri: string
  name: string
  explicit?: boolean
  contentRating?: { label: string }
  duration?: { totalMilliseconds: number }
  trackDuration?: { totalMilliseconds: number }
  artists?: { items: Array<{ profile?: { name: string }; name?: string }> }
  albumOfTrack?: { coverArt?: { sources: Array<{ url: string }> } }
  album?: { images: Array<{ url: string }> }
  externalIds?: { isrc?: string }
}

interface GraphQLSearchResponse {
  searchV2?: {
    tracksV2?: {
      items: Array<{ item: { data: GraphQLTrack } }>
    }
  }
}

interface GraphQLAlbumResponse {
  albumUnion?: {
    __typename: string
    name: string
    coverArt?: { sources: Array<{ url: string }> }
    tracksV2: {
      totalCount: number
      items: Array<{ track: GraphQLTrack }>
    }
  }
}

interface GraphQLPlaylistResponse {
  playlistV2?: {
    __typename: string
    name: string
    content: {
      totalCount: number
      items: Array<{ itemV2?: { data: GraphQLTrack } }>
    }
  }
}

interface GraphQLArtistResponse {
  artistUnion?: {
    __typename: string
    profile: { name: string }
    discography: {
      topTracks: { items: Array<{ track: GraphQLTrack }> }
    }
  }
}

interface OfficialTrack {
  id: string
  name: string
  artists: { name: string }[]
  album?: { images: Array<{ url: string }>; name: string }
  duration_ms: number
  external_urls: { spotify: string }
  external_ids?: { isrc?: string }
}

interface MetadataResponse {
  external_id?: Array<{ type: string; id: string }>
}

export interface MirroredTrack extends Track {
  needsResolve: true
  resolveQuery: string
}

export class SpotifySource implements AudioSource {
  name = 'spotify'
  #config: {
    clientId?: string
    clientSecret?: string
    spDc?: string
    market?: string
  }
  #tokens: Record<TokenTier, TokenState> = {
    official: { token: null, expiresAt: 0 },
    anonymous: { token: null, expiresAt: 0 },
    mobile: { token: null, expiresAt: 0 },
  }
  #refreshPromises = new Map<TokenTier, Promise<boolean>>()

  constructor(config: {
    clientId?: string
    clientSecret?: string
    spDc?: string
    market?: string
  }) {
    this.#config = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      spDc: config.spDc,
      market: config.market || 'US',
    }
  }

  matches(url: string): boolean {
    return SP_REGEX.test(url) || SP_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (SP_PREFIX.test(query)) return this.#search(query.replace(SP_PREFIX, '').trim())
    if (!this.matches(query)) return this.#search(query)

    const type = this.#detectType(query)
    const id = this.#extractId(query)
    if (!id) return []

    try {
      switch (type) {
        case 'track': {
          const track = await this.#resolveTrack(id)
          return track ? [track] : []
        }
        case 'album':
          return this.#resolveAlbum(id)
        case 'playlist':
          return this.#resolvePlaylist(id)
        default:
          return []
      }
    } catch {
      return []
    }
  }

  async resolveTrack(identifier: string): Promise<Track | null> {
    return this.#resolveTrack(identifier)
  }

  async #ensureToken(tier: TokenTier): Promise<boolean> {
    const state = this.#tokens[tier]
    if (state.token && Date.now() < state.expiresAt - TOKEN_REFRESH_MARGIN) {
      return true
    }

    const inflight = this.#refreshPromises.get(tier)
    if (inflight) return inflight

    const promise = this.#refreshToken(tier)
    this.#refreshPromises.set(tier, promise)
    try {
      return await promise
    } finally {
      this.#refreshPromises.delete(tier)
    }
  }

  async #refreshToken(tier: TokenTier): Promise<boolean> {
    try {
      if (tier === 'official') {
        const { clientId, clientSecret } = this.#config
        if (!clientId || !clientSecret) return false

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        const res = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        })
        if (!res.ok) return false
        const data = (await res.json()) as { access_token?: string; expires_in?: number }
        if (data.access_token) {
          this.#tokens.official = {
            token: data.access_token,
            expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
          }
          return true
        }
        return false
      }

      const isMobile = tier === 'mobile'
      const spDc = isMobile ? this.#config.spDc : null
      const product = isMobile ? 'mobile-web-player' : 'web-player'

      const data = await getLocalToken(spDc, product)
      if (data.accessToken) {
        const ttl = data.accessTokenExpirationTimestampMs
          ? data.accessTokenExpirationTimestampMs - Date.now()
          : 3600000
        this.#tokens[tier] = {
          token: data.accessToken,
          expiresAt: Date.now() + Math.max(ttl, 60000),
        }
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async #apiRequest<T>(
    path: string,
    tier: TokenTier = 'official',
    options: RequestInit = {},
    retry = 0,
  ): Promise<T | null> {
    const ok = await this.#ensureToken(tier)
    const token = this.#tokens[tier].token
    if (!ok || !token) {
      const next = tier === 'official' ? 'anonymous' : tier === 'anonymous' ? 'mobile' : null
      if (next && retry < 3) return this.#apiRequest<T>(path, next, options, retry + 1)
      return null
    }

    const url = path.startsWith('http') ? path : `${API_BASE}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...((options.headers as Record<string, string>) || {}),
    }

    if (tier !== 'official') {
      headers['App-Platform'] = 'WebPlayer'
      headers['Spotify-App-Version'] = '1.2.87.221.ge160d899'
      headers.Referer = 'https://open.spotify.com/'
    }

    try {
      const res = await fetch(url, { ...options, headers })

      if (res.status === 429) {
        if (retry >= 3) return null
        const next = tier === 'official' ? 'anonymous' : tier === 'anonymous' ? 'mobile' : null
        if (next) return this.#apiRequest<T>(path, next, options, retry + 1)

        const wait = Number.parseInt(res.headers.get('retry-after') || '5', 10)
        await new Promise(r => setTimeout(r, wait * 1000))
        return this.#apiRequest<T>(path, tier, options, retry + 1)
      }

      if (res.status === 401 || res.status === 403) {
        this.#tokens[tier].expiresAt = 0
        const next = tier === 'official' ? 'anonymous' : tier === 'anonymous' ? 'mobile' : null
        if (next && retry < 3) return this.#apiRequest<T>(path, next, options, retry + 1)
        if (retry < 3) return this.#apiRequest<T>(path, tier, options, retry + 1)
      }

      if (!res.ok) {
        if (retry < 1 && !path.includes('pathfinder') && !path.includes('spclient')) {
          const next = tier === 'official' ? 'anonymous' : tier === 'anonymous' ? 'mobile' : null
          if (next) return this.#apiRequest<T>(path, next, options, retry + 1)
        }
        return null
      }

      return res.json() as Promise<T>
    } catch {
      return null
    }
  }

  async #internalApiRequest<T>(
    operation: GraphQLOp,
    variables: Record<string, unknown>,
    retry = 0,
  ): Promise<T | null> {
    const res = await this.#apiRequest<{ data?: T; errors?: Array<unknown> }>(
      PATHFINDER_URL,
      'anonymous',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          variables,
          operationName: operation.name,
          extensions: {
            persistedQuery: { version: 1, sha256Hash: operation.hash },
          },
        }),
      },
      retry,
    )

    if (!res || res.errors) return null
    return res.data ?? null
  }

  async #fetchTrackMetadata(id: string): Promise<MetadataResponse | null> {
    const hex = this.#base62ToHex(id)
    const url = `${SPCLIENT_BASE}/metadata/4/track/${hex}?market=from_token`

    const ok = await this.#ensureToken('mobile')
    if (!ok || !this.#tokens.mobile.token) return null

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.#tokens.mobile.token}`,
          'App-Platform': 'WebPlayer',
          Referer: 'https://open.spotify.com/',
        },
      })
      if (!res.ok) return null

      const text = await res.text()
      try {
        return JSON.parse(text) as MetadataResponse
      } catch {
        const isrc = text.match(/[A-Z0-9]{12}/)
        if (isrc) return { external_id: [{ type: 'isrc', id: isrc[0] }] }
        return null
      }
    } catch {
      return null
    }
  }

  #base62ToHex(id: string): string {
    const alpha = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let bn = 0n
    for (const char of id) bn = bn * 62n + BigInt(alpha.indexOf(char))
    return bn.toString(16).padStart(32, '0')
  }

  #buildResolveQuery(isrc: string | null, title: string, author: string): string {
    const queries: string[] = []
    if (isrc) queries.push(`ytsearch:${isrc}`)
    queries.push(`ytsearch:${title} ${author}`)
    return queries.join(' || ')
  }

  #toMirroredTrack(
    identifier: string,
    title: string,
    artist: string,
    duration: number,
    uri: string,
    artworkUrl: string | null,
    isrc: string | null,
  ): MirroredTrack {
    return {
      encoded: identifier,
      needsResolve: true,
      resolveQuery: this.#buildResolveQuery(isrc, title, artist),
      info: {
        identifier,
        title,
        author: artist,
        duration: duration ?? 0,
        uri: uri ?? '',
        artworkUrl: artworkUrl ?? '',
        sourceName: 'spotify',
        isStream: false,
        position: 0,
      },
      source: 'spotify',
    }
  }

  #buildTrackFromInternal(item: GraphQLTrack): MirroredTrack | null {
    if (!item.uri) return null
    const id = item.uri.split(':').pop() || ''
    const artist =
      item.artists?.items
        ?.map(a => a.profile?.name || a.name)
        .filter(Boolean)
        .join(', ') || 'Unknown'
    const duration =
      item.duration?.totalMilliseconds ??
      item.trackDuration?.totalMilliseconds ??
      0
    const artworkUrl = item.albumOfTrack?.coverArt?.sources?.[0]?.url ?? null
    const uri = `https://open.spotify.com/track/${id}`
    const isrc = item.externalIds?.isrc ?? null

    return this.#toMirroredTrack(id, item.name, artist, duration, uri, artworkUrl, isrc)
  }

  #buildTrackFromOfficial(item: OfficialTrack): MirroredTrack | null {
    if (!item.id) return null
    const artist = item.artists?.map(a => a.name).join(', ') || 'Unknown'
    const artworkUrl = item.album?.images?.[0]?.url ?? null
    const isrc = item.external_ids?.isrc ?? null

    return this.#toMirroredTrack(
      item.id,
      item.name,
      artist,
      item.duration_ms ?? 0,
      item.external_urls?.spotify ?? '',
      artworkUrl,
      isrc,
    )
  }

  async #resolveTrack(id: string): Promise<MirroredTrack | null> {
    const data = await this.#internalApiRequest<{
      trackUnion: GraphQLTrack & { __typename: string }
    }>(QUERIES.getTrack, { uri: `spotify:track:${id}` })

    if (data?.trackUnion && data.trackUnion.__typename !== 'NotFound') {
      const track = this.#buildTrackFromInternal(data.trackUnion)
      if (track) return track
    }

    const official = await this.#apiRequest<OfficialTrack>(`/tracks/${id}?market=${this.#config.market}`)
    if (official) return this.#buildTrackFromOfficial(official)

    return null
  }

  async #resolveAlbum(id: string): Promise<MirroredTrack[]> {
    const tracks: MirroredTrack[] = []
    let offset = 0
    const limit = 300
    let total = Infinity

    while (tracks.length < total) {
      const data = await this.#internalApiRequest<GraphQLAlbumResponse>(
        QUERIES.getAlbum,
        { uri: `spotify:album:${id}`, locale: 'en', offset, limit },
      )
      if (!data?.albumUnion || data.albumUnion.__typename === 'NotFound') break

      if (offset === 0) total = data.albumUnion.tracksV2?.totalCount || 0
      const items = data.albumUnion.tracksV2?.items || []
      if (items.length === 0) break

      const artwork = data.albumUnion.coverArt?.sources?.[0]?.url ?? null
      for (const it of items) {
        const track = this.#buildTrackFromInternal(it.track)
        if (track) {
          if (artwork && !track.info.artworkUrl) track.info.artworkUrl = artwork
          tracks.push(track)
        }
      }

      offset += items.length
      if (items.length < limit) break
    }

    if (tracks.length > 0) return tracks

    return this.#resolveAlbumOfficial(id)
  }

  async #resolveAlbumOfficial(id: string): Promise<MirroredTrack[]> {
    const tracks: MirroredTrack[] = []
    let nextUrl: string | null = `/albums/${id}/tracks?market=${this.#config.market}`
    while (nextUrl) {
      const res = await fetch(`${API_BASE}${nextUrl}`, {
        headers: { Authorization: `Bearer ${this.#tokens.official.token}` },
      })
      if (!res.ok) break
      const data: { items: OfficialTrack[]; next: string | null } = await res.json()
      if (!data?.items) break

      for (const item of data.items) {
        const track = this.#buildTrackFromOfficial(item)
        if (track) tracks.push(track)
      }
      nextUrl = data.next ? data.next.split('/v1')[1] ?? null : null
    }
    return tracks
  }

  async #resolvePlaylist(id: string): Promise<MirroredTrack[]> {
    const tracks: MirroredTrack[] = []
    let offset = 0
    const limit = 100
    let total = Infinity

    while (tracks.length < total) {
      const data = await this.#internalApiRequest<GraphQLPlaylistResponse>(
        QUERIES.getPlaylist,
        { uri: `spotify:playlist:${id}`, offset, limit, enableWatchFeedEntrypoint: false },
      )
      if (!data?.playlistV2 || data.playlistV2.__typename === 'NotFound') break

      if (offset === 0) total = data.playlistV2.content?.totalCount || 0
      const items = data.playlistV2.content?.items || []
      if (items.length === 0) break

      for (const it of items) {
        const node = it.itemV2?.data
        if (!node) continue
        const track = this.#buildTrackFromInternal(node)
        if (track) tracks.push(track)
      }

      offset += items.length
      if (items.length < limit) break
    }

    if (tracks.length > 0) return tracks

    return this.#resolvePlaylistOfficial(id)
  }

  async #resolvePlaylistOfficial(id: string): Promise<MirroredTrack[]> {
    const tracks: MirroredTrack[] = []
    let nextUrl: string | null = `/playlists/${id}/items?market=${this.#config.market}`
    while (nextUrl) {
      const ok = await this.#ensureToken('official')
      if (!ok || !this.#tokens.official.token) break

      const res = await fetch(`${API_BASE}${nextUrl}`, {
        headers: { Authorization: `Bearer ${this.#tokens.official.token}` },
      })
      if (!res.ok) break
      const data: { items: Array<{ track?: OfficialTrack; item?: OfficialTrack }>; next: string | null } = await res.json()
      if (!data?.items) break

      for (const it of data.items) {
        const node = it.item || it.track
        if (!node) continue
        const track = this.#buildTrackFromOfficial(node)
        if (track) tracks.push(track)
      }
      nextUrl = data.next ? data.next.split('/v1')[1] ?? null : null
    }
    return tracks
  }

  async #search(query: string): Promise<MirroredTrack[]> {
    const data = await this.#internalApiRequest<GraphQLSearchResponse>(
      QUERIES.searchDesktop,
      {
        searchTerm: query,
        offset: 0,
        limit: 10,
        numberOfTopResults: 5,
        includeAudiobooks: false,
        includeArtistHasConcertsField: false,
        includePreReleases: false,
      },
    )

    if (data?.searchV2?.tracksV2?.items) {
      const tracks: MirroredTrack[] = []
      for (const it of data.searchV2.tracksV2.items) {
        const track = this.#buildTrackFromInternal(it.item.data)
        if (track) {
          if (this.#config.spDc && track.resolveQuery.startsWith('ytsearch:') && !/[A-Z0-9]{12}/.test(track.resolveQuery.slice(0, 30))) {
            const meta = await this.#fetchTrackMetadata(track.info.identifier)
            const isrc = meta?.external_id?.find(e => e.type === 'isrc')?.id
            if (isrc) {
              track.resolveQuery = this.#buildResolveQuery(isrc, track.info.title, track.info.author)
            }
          }
          tracks.push(track)
        }
      }
      if (tracks.length > 0) return tracks
    }

    const official = await this.#apiRequest<{
      tracks?: { items: OfficialTrack[] }
    }>(`/search?q=${encodeURIComponent(query)}&type=track&limit=10&market=${this.#config.market}`)

    if (official?.tracks?.items) {
      return official.tracks.items
        .map(t => this.#buildTrackFromOfficial(t))
        .filter((t): t is MirroredTrack => t !== null)
    }

    return []
  }

  #detectType(url: string): string {
    if (url.includes('/track/')) return 'track'
    if (url.includes('/playlist/')) return 'playlist'
    if (url.includes('/album/')) return 'album'
    return 'track'
  }

  #extractId(url: string): string | null {
    const match = url.match(/\/(track|playlist|album)\/([a-zA-Z0-9]+)/)
    return match ? match[2] : null
  }
}
