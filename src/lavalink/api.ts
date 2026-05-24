import { IncomingMessage, ServerResponse } from 'node:http'
import { PlayerManager } from '../player/manager.js'
import { SessionManager } from './session.js'
import { Resolver } from '../resolving/index.js'
import { Server } from '../server/index.js'
import { VoiceConnection } from '../player/voice.js'
import type { VoiceState } from '../types/index.js'

export class LavalinkAPI {
  #pm: PlayerManager
  #resolver: Resolver
  #sessions: SessionManager
  #started: number

  constructor(pm: PlayerManager, resolver: Resolver, sessions: SessionManager) {
    this.#pm = pm
    this.#resolver = resolver
    this.#sessions = sessions
    this.#started = Date.now()
  }

  register(srv: Server, version: 3 | 4 = 4) {
    const p = version === 4 ? '/v4' : '/v3'
    srv.handle('GET', '/loadtracks', (req, res) => this.#loadTracks(req, res))
    srv.handle('GET', '/decodetrack', (req, res) => this.#decodeTrack(req, res))
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
  }

  #loadTracks(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const identifier = url.searchParams.get('identifier')
    if (!identifier) return this.#json(res, 400, { error: 'Missing identifier' })

    this.#resolver.resolveAsync(identifier).then(result => this.#json(res, 200, result))
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

  #json(res: ServerResponse, status: number, data: unknown) {
    res.statusCode = status
    res.end(JSON.stringify(data))
  }
}
