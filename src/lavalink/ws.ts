import { WSConnection } from '@sonata-sdk/ws/connection'
import { PlayerManager } from '../player/manager.js'
import { SessionManager } from './session.js'
import { VoiceConnection } from '../player/voice.js'
import { DiscordVoice } from '../discord/voice.js'
import { AudioStreamer } from '../player/audio-streamer.js'
import { decodeTrack } from '../player/encoder.js'
import type { Track, PlayerState } from '../types/index.js'
import type { Logger } from '../utils/logger.js'

interface WSClient { ws: WSConnection; sessionId: string; resumed: boolean; userId?: string }
interface PendingPlay { track: Track; client: WSClient; startTime: number }

export class LavalinkWS {
  pm: PlayerManager
  sessions: SessionManager
  #clients = new Map<string, WSClient>()
  #heartbeatInterval = 30000
  #voices = new Map<string, DiscordVoice>()
  #streamers = new Map<string, AudioStreamer>()
  #pendingPlays = new Map<string, PendingPlay[]>()
  #crossfade: { duration: number; fadeIn: number; fadeOut: number } | null = null
  #normalizationEnabled = false
  #normalizationTarget = -14
  #defaultFilters: any = null
  #logger: Logger | null
  #youtubeConfig: any

  #proxy: { socks?: string } | null = null
  #config: { queue?: any; player?: any; voice?: any; ws?: any; proxy?: { socks?: string }; youtube?: any } | null = null

  constructor(pm: PlayerManager, sessions: SessionManager, cfg?: { queue?: { crossfade?: number; crossfadeFadeIn?: number; crossfadeFadeOut?: number }; player?: { normalization?: boolean; normalizationTarget?: number; filters?: any; ducking?: any; gapless?: any; fade?: any; autoVolume?: any; introOutro?: any; snapshot?: any }; voice?: any; ws?: any; proxy?: { socks?: string }; youtube?: any }, logger?: Logger) {
    this.pm = pm
    this.sessions = sessions
    this.#config = cfg ?? null
    if (cfg?.queue?.crossfade && cfg.queue.crossfade > 0) {
      this.#crossfade = {
        duration: cfg.queue.crossfade,
        fadeIn: cfg.queue.crossfadeFadeIn || cfg.queue.crossfade,
        fadeOut: cfg.queue.crossfadeFadeOut || cfg.queue.crossfade,
      }
    }
    this.#youtubeConfig = cfg?.youtube || {}
    if (cfg?.proxy?.socks) this.#proxy = { socks: cfg.proxy.socks }
    if (cfg?.player?.normalization) {
      this.#normalizationEnabled = true
      this.#normalizationTarget = cfg.player.normalizationTarget ?? -14
    }
    if (cfg?.player?.filters) {
      this.#defaultFilters = cfg.player.filters
    }
    this.#logger = logger ?? null
  }

  handleConnection(ws: WSConnection, resumeSessionId?: string, userId = '') {
    let sessionId: string
    let resumed = false

    if (resumeSessionId && this.sessions.get(resumeSessionId)) {
      sessionId = resumeSessionId
      resumed = true
      this.#logger?.info('Sessions', `Resumed session ${sessionId} for user=${userId || 'unknown'}`)
    } else {
      const session = this.sessions.create(false, '')
      sessionId = session.id
      this.#logger?.info('Sessions', `New session ${sessionId} for user=${userId || 'unknown'}`)
    }

    const client: WSClient = { ws, sessionId, resumed, userId }
    this.#clients.set(sessionId, client)

    this.#send(ws, 'ready', { resumed, sessionId })

    ws.on('message', (data) => {
      try { this.#handleMessage(client, JSON.parse(data.toString())) }
      catch { /* ignore */ }
    })

    ws.on('close', () => {
      this.#logger?.info('Sessions', `Session ${sessionId} disconnected, waiting 60s for resume`)
      setTimeout(() => {
        const c = this.#clients.get(sessionId)
        if (c && c === client) {
          this.#clients.delete(sessionId)
          this.#logger?.info('Sessions', `Session ${sessionId} expired`)
        }
      }, 60000)
    })

    this.#startHeartbeat(ws, sessionId)
  }

  onTrackStart(p: any, track: Track) {}
  onTrackEnd(p: any, track: Track, reason: string) {}
  onTrackStuck(p: any, track: Track, threshold: number) {}
  onTrackException(p: any, track: Track, err: Error) {}
  onQueueEnd(p: any) {}

  onPlayerUpdate(p: any, state: PlayerState) {
    this.#broadcastAll('playerUpdate', { guildId: state.guildId, state })
  }

  #handleMessage(client: WSClient, msg: any) {
    if (msg.op === 'ping') return this.#send(client.ws, 'pong', {})
    if (msg.op === 'configure' || msg.op === 'configureResuming') {
      if (msg.userId) client.userId = msg.userId
      return
    }

    const guildId = msg.guildId
    if (!guildId) return

    const p = this.pm.getOrCreate(guildId)

    switch (msg.op) {
      case 'voiceUpdate': {
        const { sessionId, event } = msg
        if (!event) return

        this.#logger?.debug('WS', `voiceUpdate: guild=${guildId} endpoint=${event.endpoint}`)

        const existing = this.#voices.get(guildId)
        if (existing) existing.close()

        const existingStreamer = this.#streamers.get(guildId)
        if (existingStreamer) existingStreamer.stop()

        const vc = new VoiceConnection(guildId)
        vc.update(sessionId, event.token, event.endpoint)
        p.setVoice(vc)
        vc.connect()

        const dv = new DiscordVoice()
        if (this.#logger) dv.setLogger(this.#logger)
        if (this.#config?.voice) dv.setVoiceConfig(this.#config.voice)
        const userId = client.userId ?? ''
        const channelId = msg.channelId ?? guildId
        dv.connect({ guildId, userId, sessionId, token: event.token, endpoint: event.endpoint, channelId })
        dv.feedVoiceUpdate(sessionId, event.token, event.endpoint)

        this.#voices.set(guildId, dv)

        const streamer = new AudioStreamer(dv, this.#proxy ?? undefined)
        if (this.#logger) streamer.setLogger(this.#logger)
        if (this.#crossfade) streamer.setCrossfade(this.#crossfade)
        if (this.#normalizationEnabled) streamer.setNormalization(true, this.#normalizationTarget)
        if (this.#defaultFilters) streamer.setPlayerFilters(this.#defaultFilters)
        const pCfg = this.#config?.player
        if (pCfg?.gapless?.enabled) streamer.setGapless(pCfg.gapless)
        if (pCfg?.fade?.enabled) streamer.setFade(pCfg.fade)
        if (pCfg?.introOutro?.enabled) streamer.setIntroOutro(pCfg.introOutro)
        if (pCfg?.ducking?.enabled && streamer.mixer) {
          streamer.mixer.setFilters({ ducking: pCfg.ducking })
        }
        if (pCfg?.autoVolume?.enabled && streamer.mixer) {
          streamer.mixer.setFilters({ autoVolume: pCfg.autoVolume })
        }
        streamer.addEventListener('start', ((e: CustomEvent) => {
          this.#broadcast(client, 'event', {
            type: 'TrackStartEvent',
            guildId,
            track: e.detail.track?.encoded ?? '',
          })
        }) as EventListener)

        streamer.addEventListener('end', ((e: CustomEvent) => {
          p.skip(e.detail.reason ?? 'finished')
          this.#broadcast(client, 'event', {
            type: 'TrackEndEvent',
            guildId,
            track: e.detail.track?.encoded ?? '',
            reason: e.detail.reason ?? 'finished',
          })
        }) as EventListener)

        this.#streamers.set(guildId, streamer)

        // Process any pending play requests
        const pending = this.#pendingPlays.get(guildId)
        this.#logger?.debug('WS', `voiceUpdate: pending=${pending?.length ?? 0} guild=${guildId}`)
        if (pending && pending.length > 0) {
          for (const req of pending) {
            this.#streamAudio(guildId, req.track, req.client, req.startTime)
          }
          this.#pendingPlays.delete(guildId)
        }
        break
      }

      case 'play': {
        this.#logger?.debug('WS', `play: guild=${guildId} track_raw="${msg.track?.substring(0, 40)}..."`)
        const track = msg.track ? decodeTrack(msg.track, this.#logger ?? undefined) : null
        if (!track) {
          this.#logger?.debug('WS', `play: guild=${guildId} FAILED to decode track`)
          this.#broadcast(client, 'event', {
            type: 'TrackExceptionEvent',
            guildId,
            error: 'Failed to decode track',
          })
          return
        }

        this.#logger?.debug('WS', `play: guild=${guildId} track="${track.info.title}" voice=${this.#voices.has(guildId)}`)
        p.play(track)

        // If voice isn't set up yet, queue the play
        if (!this.#voices.has(guildId)) {
          const pending = this.#pendingPlays.get(guildId) ?? []
          pending.push({ track, client, startTime: msg.startTime ?? 0 })
          this.#pendingPlays.set(guildId, pending)
          return
        }

        // If crossfade is active and streamer is playing, queue it as next track
        const existingStreamer = this.#streamers.get(guildId)
        if (existingStreamer?.playing && this.#crossfade) {
          existingStreamer.setNextTrack(track)
          p.queue.setCurrent(track)
          break
        }

        this.#streamAudio(guildId, track, client, msg.startTime ?? 0)
        break
      }

      case 'stop': {
        this.#logger?.info('Player', `stop guild=${guildId}`)
        const streamer = this.#streamers.get(guildId)
        streamer?.stop()
        const t = p.track
        p.stop()
        if (t) {
          this.#broadcast(client, 'event', {
            type: 'TrackEndEvent',
            guildId,
            track: msg.track ?? '',
            reason: 'stopped',
          })
        }
        break
      }

      case 'pause': {
        const streamer = this.#streamers.get(guildId)
        if (msg.pause !== false) {
          this.#logger?.info('Player', `pause guild=${guildId}`)
          streamer?.pause()
          p.pause()
        } else {
          this.#logger?.info('Player', `resume guild=${guildId}`)
          streamer?.resume()
          p.resume()
        }
        break
      }

      case 'seek': {
        this.#logger?.info('Player', `seek guild=${guildId} pos=${msg.position ?? 0}`)
        const streamer = this.#streamers.get(guildId)
        streamer?.seek(msg.position ?? 0)
        p.setPosition(msg.position ?? 0)
        break
      }

      case 'volume': {
        this.#logger?.debug('Player', `volume guild=${guildId} vol=${msg.volume ?? 100}`)
        const streamer = this.#streamers.get(guildId)
        streamer?.setVolume(msg.volume ?? 100)
        p.setVolume(msg.volume ?? 100)
        break
      }

      case 'destroy': {
        this.#logger?.info('Player', `destroy guild=${guildId}`)
        this.#cleanup(guildId)
        p.stop()
        this.pm.remove(guildId)
        this.#broadcast(client, 'event', {
          type: 'TrackEndEvent',
          guildId,
          track: msg.track ?? '',
          reason: 'replaced',
        })
        break
      }

      case 'filters': {
        const f = { ...msg }
        delete f.op
        delete f.guildId
        this.#logger?.info('Player', `filters guild=${guildId} keys=${Object.keys(f).join(',')}`)
        p.setFilters(f)
        this.#streamers.get(guildId)?.setPlayerFilters(f)
        break
      }
    }
  }

  async #streamAudio(guildId: string, track: Track, client: WSClient, startTime = 0) {
    const streamer = this.#streamers.get(guildId)
    this.#logger?.debug('WS', `streamAudio: guild=${guildId} hasStreamer=${!!streamer} uri=${track.info.uri}`)
    if (!streamer) return

    // Resolve streaming URL if needed (YouTube tracks have uri = watch page URL)
    if (!track.info.uri || track.info.uri.includes('youtube.com/watch?v=') || track.info.uri.includes('youtu.be/')) {
      this.#logger?.debug('WS', `streamAudio: resolving stream URL for ${track.info.identifier}`)
      const resolved = await this.#resolveStreamUrl(track)
      this.#logger?.debug('WS', `streamAudio: resolved=${resolved}`)
      if (!resolved) {
        this.#logger?.warn('WS', `streamAudio: failed to resolve stream URL for ${track.info.identifier}, trying original URI`)
      }
    }

    this.#logger?.debug('WS', `streamAudio: calling streamer.play()`)
    streamer.play(track, startTime)
  }

  async #resolveStreamUrl(track: Track): Promise<string | null> {
    if (track.source === 'youtube') {
      const { InnerTubeClient } = await import('../resolving/youtube/innerTube.js')
      const client = new InnerTubeClient(undefined, undefined, this.#youtubeConfig)
      try {
        const video = await client.getVideo(track.info.identifier)
        if (video?.streamUrl) {
          track.info.uri = video.streamUrl
          return video.streamUrl
        }
      } catch {}
    }
    return null
  }

  cleanupGuild(guildId: string) {
    this.#cleanup(guildId)
  }

  #cleanup(guildId: string) {
    this.#logger?.debug('WS', `cleanup guild=${guildId}`)
    const streamer = this.#streamers.get(guildId)
    streamer?.stop()
    this.#streamers.delete(guildId)

    const dv = this.#voices.get(guildId)
    dv?.close()
    this.#voices.delete(guildId)
  }

  #startHeartbeat(ws: WSConnection, sessionId: string) {
    const interval = setInterval(() => {
      const client = this.#clients.get(sessionId)
      if (!client || !client.ws.connected) {
        clearInterval(interval)
        return
      }
      this.#send(client.ws, 'ping', {})
    }, this.#heartbeatInterval)

    ws.on('close', () => clearInterval(interval))
  }

  #send(ws: WSConnection, op: string, data: any) {
    if (ws.connected) {
      ws.send(JSON.stringify({ op, ...data }))
    }
  }

  #shouldAllowEvent(op: string, data: any): boolean {
    const wsCfg = this.#config?.ws
    if (!wsCfg?.eventFiltering) return true
    if (!wsCfg.allowedEvents?.length) return true
    if (op === 'event') return wsCfg.allowedEvents.includes(data?.type)
    return wsCfg.allowedEvents.includes(op)
  }

  #broadcast(client: WSClient, op: string, data: any) {
    if (!this.#shouldAllowEvent(op, data)) return
    if (client.ws.connected) {
      client.ws.send(JSON.stringify({ op, ...data }))
    }
  }

  #broadcastAll(op: string, data: any) {
    if (!this.#shouldAllowEvent(op, data)) return
    for (const c of this.#clients.values()) {
      if (c.ws.connected) {
        c.ws.send(JSON.stringify({ op, ...data }))
      }
    }
  }
}
