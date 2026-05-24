import { WebSocket } from 'ws'
import { PlayerManager } from '../player/manager.js'
import { SessionManager } from './session.js'
import { VoiceConnection } from '../player/voice.js'
import { DiscordVoice } from '../discord/voice.js'
import { AudioStreamer } from '../player/audio-streamer.js'
import { decodeTrack } from '../player/encoder.js'
import type { Track, PlayerState } from '../types/index.js'

interface WSClient { ws: WebSocket; sessionId: string; resumed: boolean; userId?: string }
interface PendingPlay { track: Track; client: WSClient; startTime: number }

export class LavalinkWS {
  pm: PlayerManager
  sessions: SessionManager
  #clients = new Map<string, WSClient>()
  #heartbeatInterval = 30000
  #voices = new Map<string, DiscordVoice>()
  #streamers = new Map<string, AudioStreamer>()
  #pendingPlays = new Map<string, PendingPlay[]>()

  constructor(pm: PlayerManager, sessions: SessionManager) {
    this.pm = pm
    this.sessions = sessions
  }

  handleConnection(ws: WebSocket, resumeSessionId?: string, userId = '') {
    let sessionId: string
    let resumed = false

    if (resumeSessionId && this.sessions.get(resumeSessionId)) {
      sessionId = resumeSessionId
      resumed = true
    } else {
      const session = this.sessions.create(false, '')
      sessionId = session.id
    }

    const client: WSClient = { ws, sessionId, resumed, userId }
    this.#clients.set(sessionId, client)

    this.#send(ws, 'ready', { resumed, sessionId })

    ws.on('message', (data) => {
      try { this.#handleMessage(client, JSON.parse(data.toString())) }
      catch { /* ignore */ }
    })

    ws.on('close', () => {
      setTimeout(() => {
        const c = this.#clients.get(sessionId)
        if (c && c === client) this.#clients.delete(sessionId)
      }, 60000)
    })

    ws.on('ping', () => ws.pong())

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

        console.log(`[WS] voiceUpdate: guild=${guildId} endpoint=${event.endpoint}`)

        const existing = this.#voices.get(guildId)
        if (existing) existing.close()

        const vc = new VoiceConnection(guildId)
        vc.update(sessionId, event.token, event.endpoint)
        p.setVoice(vc)
        vc.connect()

        const dv = new DiscordVoice()
        const userId = client.userId ?? ''
        const channelId = msg.channelId ?? guildId
        dv.connect({ guildId, userId, sessionId, token: event.token, endpoint: event.endpoint, channelId })
        dv.feedVoiceUpdate(sessionId, event.token, event.endpoint)

        this.#voices.set(guildId, dv)

        const streamer = new AudioStreamer(dv)
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
        console.log(`[WS] voiceUpdate: pending=${pending?.length ?? 0} guild=${guildId}`)
        if (pending && pending.length > 0) {
          for (const req of pending) {
            this.#streamAudio(guildId, req.track, req.client, req.startTime)
          }
          this.#pendingPlays.delete(guildId)
        }
        break
      }

      case 'play': {
        console.log(`[WS] play: guild=${guildId} track_raw="${msg.track?.substring(0, 40)}..."`)
        const track = msg.track ? decodeTrack(msg.track) : null
        if (!track) {
          console.log(`[WS] play: guild=${guildId} FAILED to decode track`)
          this.#broadcast(client, 'event', {
            type: 'TrackExceptionEvent',
            guildId,
            error: 'Failed to decode track',
          })
          return
        }

        console.log(`[WS] play: guild=${guildId} track="${track.info.title}" voice=${this.#voices.has(guildId)}`)
        p.play(track)

        // If voice isn't set up yet, queue the play
        if (!this.#voices.has(guildId)) {
          const pending = this.#pendingPlays.get(guildId) ?? []
          pending.push({ track, client, startTime: msg.startTime ?? 0 })
          this.#pendingPlays.set(guildId, pending)
          return
        }

        this.#streamAudio(guildId, track, client, msg.startTime ?? 0)
        break
      }

      case 'stop': {
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
          streamer?.pause()
          p.pause()
        } else {
          streamer?.resume()
          p.resume()
        }
        break
      }

      case 'seek': {
        const streamer = this.#streamers.get(guildId)
        streamer?.seek(msg.position ?? 0)
        p.setPosition(msg.position ?? 0)
        break
      }

      case 'volume': {
        const streamer = this.#streamers.get(guildId)
        streamer?.setVolume(msg.volume ?? 100)
        p.setVolume(msg.volume ?? 100)
        break
      }

      case 'destroy': {
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
        p.setFilters(f)
        break
      }
    }
  }

  async #streamAudio(guildId: string, track: Track, client: WSClient, startTime = 0) {
    const streamer = this.#streamers.get(guildId)
    console.log(`[WS] streamAudio: guild=${guildId} hasStreamer=${!!streamer} uri=${track.info.uri}`)
    if (!streamer) return

    // Resolve streaming URL if needed (YouTube tracks have uri = watch page URL)
    if (!track.info.uri || track.info.uri.includes('youtube.com/watch?v=') || track.info.uri.includes('youtu.be/')) {
      console.log(`[WS] streamAudio: resolving stream URL for ${track.info.identifier}`)
      const resolved = await this.#resolveStreamUrl(track)
      console.log(`[WS] streamAudio: resolved=${resolved}`)
      if (!resolved) {
        this.#broadcast(client, 'event', {
          type: 'TrackExceptionEvent',
          guildId,
          error: 'Failed to resolve stream URL',
        })
        return
      }
    }

    console.log(`[WS] streamAudio: calling streamer.play()`)
    streamer.play(track, startTime)
  }

  async #resolveStreamUrl(track: Track): Promise<string | null> {
    if (track.source === 'youtube') {
      const { InnerTubeClient } = await import('../resolving/youtube/innerTube.js')
      const client = new InnerTubeClient()
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

  #cleanup(guildId: string) {
    const streamer = this.#streamers.get(guildId)
    streamer?.stop()
    this.#streamers.delete(guildId)

    const dv = this.#voices.get(guildId)
    dv?.close()
    this.#voices.delete(guildId)
  }

  #startHeartbeat(ws: WebSocket, sessionId: string) {
    const interval = setInterval(() => {
      const client = this.#clients.get(sessionId)
      if (!client || client.ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval)
        return
      }
      this.#send(client.ws, 'ping', {})
    }, this.#heartbeatInterval)

    ws.on('close', () => clearInterval(interval))
  }

  #send(ws: WebSocket, op: string, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op, ...data }))
    }
  }

  #broadcast(client: WSClient, op: string, data: any) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ op, ...data }))
    }
  }

  #broadcastAll(op: string, data: any) {
    for (const c of this.#clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(JSON.stringify({ op, ...data }))
      }
    }
  }
}
