import { IncomingMessage, ServerResponse } from 'node:http'
import { PlayerManager } from '../player/manager.js'
import { SessionManager } from './session.js'
import { Resolver } from '../resolving/index.js'
import { Server } from '../server/index.js'
import { VoiceConnection } from '../player/voice.js'
import { TrackCache } from '../cache/index.js'
import { encodeTrack } from '../player/encoder.js'
import type { VoiceState } from '../types/index.js'

export class LavalinkAPI {
  #pm: PlayerManager
  #resolver: Resolver
  #sessions: SessionManager
  #started: number
  #cache: TrackCache | null

  constructor(pm: PlayerManager, resolver: Resolver, sessions: SessionManager, cache: TrackCache | null = null) {
    this.#pm = pm
    this.#resolver = resolver
    this.#sessions = sessions
    this.#cache = cache
    this.#started = Date.now()
  }

  register(srv: Server, version: 3 | 4 = 4) {
    const p = version === 4 ? '/v4' : '/v3'
    srv.handle('GET', '/loadtracks', (req, res) => this.#loadTracks(req, res))
    srv.handle('GET', '/decodetrack', (req, res) => this.#decodeTrack(req, res))
    srv.handle('GET', '/v4/loadtracks', (req, res) => this.#loadTracks(req, res))
    srv.handle('GET', '/v4/decodetrack', (req, res) => this.#decodeTrack(req, res))
    srv.handle('POST', '/v4/decodetrack', (req, res, params, body) => this.#decodeTrackFromBody(res, body))
    srv.handle('GET', '/v3/loadtracks', (req, res) => this.#loadTracks(req, res))
    srv.handle('GET', '/v3/decodetrack', (req, res) => this.#decodeTrack(req, res))
    srv.handle('POST', '/v3/decodetrack', (req, res, params, body) => this.#decodeTrackFromBody(res, body))
    srv.handle('POST', `${p}/sessions`, (req, res, params, body) => this.#createSession(res, body))
    srv.handle('GET', `${p}/sessions/{id}`, (req, res, params) => this.#getSession(res, params))
    srv.handle('PATCH', `${p}/sessions/{id}`, (req, res, params, body) => this.#updateSession(res, params, body))
    srv.handle('DELETE', `${p}/sessions/{id}`, (req, res, params) => this.#destroySession(res, params))
    srv.handle('GET', `${p}/sessions/{id}/players`, (req, res) => this.#getPlayers(res))
    srv.handle('GET', `${p}/sessions/{id}/players/{guildId}`, (req, res, params) => this.#getPlayer(res, params))
    srv.handle('PATCH', `${p}/sessions/{id}/players/{guildId}`, (req, res, params, body) => this.#updatePlayer(res, params, body))
    srv.handle('DELETE', `${p}/sessions/{id}/players/{guildId}`, (req, res, params) => this.#destroyPlayer(res, params))
    srv.handle('POST', `${p}/sessions/{id}/players/{guildId}/voice`, (req, res, params, body) => this.#updateVoice(res, params, body))
    srv.handle('GET', '/v4/stats', (req, res) => this.#stats(res))
    srv.handle('GET', '/v4/routeplanner/status', (req, res) => this.#routePlannerStatus(res))
    srv.handle('POST', '/v4/routeplanner/free/address', (req, res, params, body) => this.#routePlannerFreeAddress(res, body))
    srv.handle('POST', '/v4/routeplanner/free/all', (req, res) => this.#routePlannerFreeAll(res))
    srv.handle('POST', '/v4/decodetracks', (req, res, params, body) => this.#decodeTracks(res, body))

    // v3 compat - same handlers as v4
    srv.handle('GET', '/v3/version', (req, res) => this.#version(res))
    srv.handle('GET', '/v3/info', (req, res) => this.#version(res))
    srv.handle('GET', '/v3/stats', (req, res) => this.#stats(res))
    srv.handle('GET', '/v3/sessions', (req, res) => this.#listSessions(res))
    srv.handle('POST', '/v3/sessions', (req, res, params, body) => this.#createSession(res, body))
    srv.handle('GET', '/v3/sessions/{id}', (req, res, params) => this.#getSession(res, params))
    srv.handle('PATCH', '/v3/sessions/{id}', (req, res, params, body) => this.#updateSession(res, params, body))
    srv.handle('DELETE', '/v3/sessions/{id}', (req, res, params) => this.#destroySession(res, params))
    srv.handle('GET', '/v3/sessions/{id}/players', (req, res) => this.#getPlayers(res))
    srv.handle('GET', '/v3/sessions/{id}/players/{guildId}', (req, res, params) => this.#getPlayer(res, params))
    srv.handle('PATCH', '/v3/sessions/{id}/players/{guildId}', (req, res, params, body) => this.#updatePlayer(res, params, body))
    srv.handle('DELETE', '/v3/sessions/{id}/players/{guildId}', (req, res, params) => this.#destroyPlayer(res, params))
    srv.handle('POST', '/v3/sessions/{id}/players/{guildId}/voice', (req, res, params, body) => this.#updateVoice(res, params, body))
    srv.handle('GET', '/v3/routeplanner/status', (req, res) => this.#routePlannerStatus(res))
    srv.handle('POST', '/v3/routeplanner/free/address', (req, res, params, body) => this.#routePlannerFreeAddress(res, body))
    srv.handle('POST', '/v3/routeplanner/free/all', (req, res) => this.#routePlannerFreeAll(res))

    // New v4 endpoints
    srv.handle('GET', '/v4/version', (req, res) => this.#version(res))
    srv.handle('GET', '/v4/info', (req, res) => this.#version(res))
    srv.handle('GET', '/v4/sessions', (req, res) => this.#listSessions(res))

    // queue management endpoints
    srv.handle('POST', '/v4/sessions/{id}/players/{guildId}/queue', (req, res, params, body) => this.#addToQueue(res, params, body))
    srv.handle('DELETE', '/v4/sessions/{id}/players/{guildId}/queue', (req, res, params) => this.#clearQueue(res, params))
    srv.handle('DELETE', '/v4/sessions/{id}/players/{guildId}/queue/{index}', (req, res, params) => this.#removeFromQueue(res, params))
    srv.handle('PATCH', '/v4/sessions/{id}/players/{guildId}/queue/{index}', (req, res, params, body) => this.#moveInQueue(res, params, body))
    srv.handle('GET', '/v4/sessions/{id}/players/{guildId}/history', (req, res, params) => this.#getHistory(res, params))
  }

  #loadTracks(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const identifier = url.searchParams.get('identifier')
    if (!identifier) return this.#json(res, 400, { error: 'Missing identifier' })

    if (this.#cache) {
      const cached = this.#cache.get(identifier)
      if (cached) return this.#json(res, 200, this.#formatLoadResult(cached.length === 1 ? 'track' : 'search', cached))
    }

    this.#resolver.resolveAsync(identifier).then(result => {
      if (this.#cache && result.tracks.length > 0) this.#cache.set(identifier, result.tracks)

      // detect playlists when loadType isn't set but tracks > 1
      if (result.loadType !== 'playlist' && result.tracks.length > 1) {
        const isPlaylist = !!identifier.match(/[?&]list=|[?&]playlist=|(open\.)?spotify\.com\/(playlist|album)\/|soundcloud\.com\/[^/]+\/sets\//)
        if (isPlaylist) {
          result.loadType = 'playlist'
          result.playlistInfo = result.playlistInfo ?? { name: 'Playlist', trackCount: result.tracks.length }
        }
      }

      this.#json(res, 200, this.#formatLoadResult(result.loadType, result.tracks, result.playlistInfo, result.exception))
    }).catch(() => {
      this.#json(res, 200, this.#formatLoadResult('error', []))
    })
  }

  #formatLoadResult(loadType: string, tracks: any[], playlistInfo?: any, exception?: any) {
    const v3Map: Record<string, string> = {
      track: 'TRACK_LOADED',
      search: 'SEARCH_RESULT',
      playlist: 'PLAYLIST_LOADED',
      empty: 'NO_MATCHES',
      error: 'LOAD_FAILED',
    }
    return {
      loadType: v3Map[loadType] ?? 'NO_MATCHES',
      tracks: tracks.map(this.#formatTrack),
      playlistInfo,
      exception,
    }
  }

  #formatTrack(t: any) {
    if (t?.info) {
      t.info.length = t.info.duration
      t.info.isSeekable = !t.info.isStream
    }
    // Generate proper lavalink-format base64 encoded track
    const encoded = t?.info ? encodeTrack(t) : t?.encoded ?? ''
    if (t) {
      t.encoded = encoded
      t.track = encoded
    }
    return t
  }

  #decodeTrack(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const encoded = url.searchParams.get('track')
    if (!encoded) return this.#json(res, 400, { error: 'Missing track' })
    this.#resolver.resolveTrackAsync(encoded).then(track => {
      if (!track) return this.#json(res, 404, { error: 'Track not found' })
      this.#json(res, 200, track)
    })
  }

  #decodeTrackFromBody(res: ServerResponse, body: any) {
    if (!body?.track) return this.#json(res, 400, { error: 'Missing track in body' })
    this.#resolver.resolveTrackAsync(body.track).then(track => {
      if (!track) return this.#json(res, 404, { error: 'Track not found' })
      this.#json(res, 200, track)
    })
  }

  #createSession(res: ServerResponse, body: any) {
    const session = this.#sessions.create(body?.resume, body?.resumeKey)
    this.#json(res, 201, session.toState())
  }

  #getSession(res: ServerResponse, params: Record<string, string>) {
    const session = this.#sessions.get(params.id)
    if (!session) return this.#json(res, 404, { error: 'Session not found' })
    this.#json(res, 200, session.toState())
  }

  #updateSession(res: ServerResponse, params: Record<string, string>, body: any) {
    const session = this.#sessions.get(params.id)
    if (!session) return this.#json(res, 404, { error: 'Session not found' })
    if (body?.resume !== undefined) session.resume = body.resume
    if (body?.resumeKey !== undefined) session.resumeKey = body.resumeKey
    this.#json(res, 200, session.toState())
  }

  #destroySession(res: ServerResponse, params: Record<string, string>) {
    this.#sessions.remove(params.id)
    res.statusCode = 204
    res.end()
  }

  #getPlayers(res: ServerResponse) { this.#json(res, 200, this.#pm.all().map(p => p.toState())) }

  #getPlayer(res: ServerResponse, params: Record<string, string>) {
    const p = this.#pm.get(params.guildId)
    if (!p) return this.#json(res, 404, { error: 'Player not found' })
    this.#json(res, 200, p.toState())
  }

  #updatePlayer(res: ServerResponse, params: Record<string, string>, body: any) {
    const p = this.#pm.getOrCreate(params.guildId)
    if (body?.volume !== undefined) p.setVolume(body.volume)
    if (body?.paused === true) p.pause()
    else if (body?.paused === false) p.resume()
    if (body?.position !== undefined) p.setPosition(body.position)
    if (body?.track && !body?.noReplace) p.play(body.track)
    if (body?.filters) p.setFilters(body.filters)
    this.#json(res, 200, p.toState())
  }

  #destroyPlayer(res: ServerResponse, params: Record<string, string>) {
    this.#pm.remove(params.guildId)
    res.statusCode = 204
    res.end()
  }

  #updateVoice(res: ServerResponse, params: Record<string, string>, body: VoiceState) {
    if (!body) return this.#json(res, 400, { error: 'Invalid JSON' })
    const p = this.#pm.getOrCreate(params.guildId)
    const vc = new VoiceConnection(params.guildId)
    vc.update(body.sessionId, body.token, body.endpoint)
    p.setVoice(vc)
    res.statusCode = 204
    res.end()
  }

  #stats(res: ServerResponse) {
    const mem = process.memoryUsage()
    this.#json(res, 200, {
      players: this.#pm.count(),
      playing: this.#pm.playingCount(),
      uptime: Date.now() - this.#started,
      memory: { free: mem.heapTotal - mem.heapUsed, used: mem.heapUsed, allocated: mem.heapTotal, reservable: mem.rss },
      cpu: { cores: 0, systemLoad: 0, processLoad: 0 },
    })
  }

  #routePlannerStatus(res: ServerResponse) {
    this.#json(res, 200, {
      ip: null,
      failingAddresses: [],
      blockIndex: null,
      currentAddressIndex: null,
      details: { ipBlock: { type: 'Inet6', size: '64' } },
    })
  }

  #routePlannerFreeAddress(res: ServerResponse, body: any) {
    res.statusCode = 204
    res.end()
  }

  #routePlannerFreeAll(res: ServerResponse) {
    res.statusCode = 204
    res.end()
  }

  #decodeTracks(res: ServerResponse, body: any) {
    if (!body?.tracks) return this.#json(res, 400, { error: 'Missing tracks' })
    const decoded = body.tracks.map((e: string) => {
      try {
        const data = JSON.parse(Buffer.from(e, 'base64').toString())
        return {
          encoded: e,
          info: {
            identifier: data.i ?? '',
            title: data.t ?? 'Unknown',
            author: data.a ?? 'Unknown',
            duration: data.d ?? 0,
            uri: data.u ?? '',
            artworkUrl: '',
            sourceName: data.s ?? 'unknown',
            isStream: false,
            position: 0,
          },
          source: data.s ?? 'unknown',
        }
      } catch { return null }
    }).filter(Boolean)
    this.#json(res, 200, decoded)
  }

  #version(res: ServerResponse) {
    this.#json(res, 200, {
      name: 'sonata',
      version: '4.0.0',
      lavalink: { version: 4, apiVersion: 4 },
      node: { version: process.version, platform: process.platform, arch: process.arch },
      build: { time: Date.now(), commit: process.env.SOURCE_COMMIT || 'unknown' },
    })
  }

  #listSessions(res: ServerResponse) {
    const sessions = this.#sessions.all()
    this.#json(res, 200, sessions.map(s => s.toState()))
  }

  #addToQueue(res: ServerResponse, params: Record<string, string>, body: any) {
    if (!body?.track) return this.#json(res, 400, { error: 'Missing track' })
    const p = this.#pm.get(params.guildId)
    if (!p) return this.#json(res, 404, { error: 'Player not found' })
    p.queue.add(body.track, body.index)
    res.statusCode = 204
    res.end()
  }

  #clearQueue(res: ServerResponse, params: Record<string, string>) {
    const p = this.#pm.get(params.guildId)
    if (!p) return this.#json(res, 404, { error: 'Player not found' })
    p.queue.clear()
    res.statusCode = 204
    res.end()
  }

  #removeFromQueue(res: ServerResponse, params: Record<string, string>) {
    const p = this.#pm.get(params.guildId)
    if (!p) return this.#json(res, 404, { error: 'Player not found' })
    const index = parseInt(params.index)
    const removed = p.queue.remove(index)
    if (!removed) return this.#json(res, 404, { error: 'Track not found at index' })
    this.#json(res, 200, removed)
  }

  #moveInQueue(res: ServerResponse, params: Record<string, string>, body: any) {
    const p = this.#pm.get(params.guildId)
    if (!p) return this.#json(res, 404, { error: 'Player not found' })
    const from = parseInt(params.index)
    const to = body?.to ?? 0
    p.queue.move(from, to)
    res.statusCode = 204
    res.end()
  }

  #getHistory(res: ServerResponse, params: Record<string, string>) {
    const p = this.#pm.get(params.guildId)
    if (!p) return this.#json(res, 404, { error: 'Player not found' })
    this.#json(res, 200, p.queue.history)
  }

  #json(res: ServerResponse, status: number, data: unknown) {
    res.statusCode = status
    res.end(JSON.stringify(data))
  }
}
