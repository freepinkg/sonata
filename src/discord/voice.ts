import { Readable } from 'node:stream'
import voiceModule from '@performanc/voice'
import type { Logger } from '../utils/logger.js'

const OPUS_FRAME_DURATION = 20

export interface VoiceConnectOptions {
  guildId: string
  userId: string
  sessionId: string
  token: string
  endpoint: string
  channelId: string
}

export interface VoiceConfig {
  udpMode?: 'ipv4' | 'ipv6'
  externalAddress?: string
  portRange?: [number, number]
  bufferSize?: number
  forceIpDiscovery?: boolean
  encryptionFallback?: string[]
  silenceFrames?: number
  keepaliveInterval?: number
  maxReconnectAttempts?: number
  reconnectDelay?: number
}

class OpusFrameStream extends Readable {
  constructor(highWaterMark = 512) {
    super({ objectMode: true, highWaterMark })
  }

  pushFrame(frame: Buffer) {
    this.push(frame)
  }

  _read() {}

  endStream() {
    this.push(null)
  }
}

export class DiscordVoice extends EventTarget {
  #connection: ReturnType<typeof voiceModule.joinVoiceChannel> | null = null
  #opts: VoiceConnectOptions | null = null
  #readyEmitted = false
  #opusStream: OpusFrameStream | null = null
  #logger: Logger | null = null
  #voiceCfg: VoiceConfig = {}
  #reconnectAttempts = 0
  #keepaliveTimer: ReturnType<typeof setInterval> | null = null
  #silenceBuffer: Buffer[] = []

  connected = false
  ping = 0

  setLogger(logger: Logger) { this.#logger = logger }

  setVoiceConfig(cfg: VoiceConfig) { this.#voiceCfg = cfg }

  get ssrc() { return (this.#connection as any)?.udpInfo?.ssrc ?? 0 }

  connect(opts: VoiceConnectOptions) {
    this.#opts = opts
    this.#createConnection()
  }

  #createConnection() {
    const opts = this.#opts!
    this.#logger?.debug('voice', `Creating connection: guild=${opts.guildId} userId=${opts.userId} channelId=${opts.channelId}`)

    const encryption = this.#voiceCfg.encryptionFallback?.[0] ?? 'aead_aes256_gcm_rtpsize'
    this.#connection = voiceModule.joinVoiceChannel({
      guildId: opts.guildId,
      userId: opts.userId,
      channelId: opts.channelId,
      encryption,
    })
    ;(this.#connection as any).stuckTimeout = 30000
    this.#reconnectAttempts = 0

    if (this.#voiceCfg.silenceFrames && this.#voiceCfg.silenceFrames > 0) {
      const frame = Buffer.alloc(OPUS_FRAME_DURATION * 48 * 2)
      this.#silenceBuffer = Array.from({ length: this.#voiceCfg.silenceFrames }, () => frame)
    }

    this.#connection.on('stateChange', (_oldState: any, newState: any) => {
      const status = newState.status
      this.#logger?.debug('voice', `stateChange: ${_oldState?.status} -> ${status} (code=${newState.code})`)
      if (status === 'connected') {
        this.connected = true
        this.ping = (this.#connection as any)?.ping ?? 0
        if (!this.#readyEmitted) {
          this.#readyEmitted = true
          this.#logger?.debug('voice', 'dispatching ready event')
          this.#sendSilenceFrames()
          this.#startKeepalive()
          this.dispatchEvent(new CustomEvent('ready'))
        }
      } else if (status === 'disconnected' || status === 'destroyed') {
        this.connected = false
        this.#readyEmitted = false
        this.#stopKeepalive()
        if (status === 'disconnected' && this.#voiceCfg.maxReconnectAttempts && this.#reconnectAttempts < this.#voiceCfg.maxReconnectAttempts) {
          this.#reconnectAttempts++
          const delay = (this.#voiceCfg.reconnectDelay ?? 1000) * Math.pow(2, this.#reconnectAttempts - 1)
          this.#logger?.debug('voice', `reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`)
          setTimeout(() => {
            if (this.#opts && this.#connection) {
              ;(this.#connection as any).connect(() => {}, true)
            }
          }, delay)
        }
      }
    })
    this.#connection.on('playerStateChange', (_old: any, state: any) => {
      this.#logger?.debug('voice', `playerStateChange: ${_old?.status} -> ${state.status} (${state.reason})`)
      if (state.status === 'idle' && state.reason === 'finished') {
        this.dispatchEvent(new CustomEvent('finished'))
      }
    })
    this.#connection.on('error', (err: any) => {
      this.#logger?.error('voice', `Error: ${err?.message ?? err}`)
    })
    this.#connection.on('debug', (msg: string) => {
      this.#logger?.debug('voice', msg)
    })
  }

  feedVoiceUpdate(sessionId: string, token: string, endpoint: string) {
    if (!this.#connection) return

    const cleanEndpoint = endpoint.replace(/^wss:\/\//, '').replace(/\/\?v=\d+$/, '')
    this.#logger?.debug('voice', `feedVoiceUpdate: endpoint=${cleanEndpoint} sessionId=${sessionId}`)

    ;(this.#connection as any).voiceStateUpdate({ session_id: sessionId })
    ;(this.#connection as any).voiceServerUpdate({ token, endpoint: cleanEndpoint })
    ;(this.#connection as any).connect(() => {
      this.#logger?.debug('voice', 'connect callback fired (session description received)')
    })
  }

  #sendSilenceFrames() {
    for (const frame of this.#silenceBuffer) {
      this.sendOpus(frame)
    }
    this.#silenceBuffer = []
  }

  #startKeepalive() {
    const interval = this.#voiceCfg.keepaliveInterval ?? 15000
    if (interval <= 0) return
    this.#stopKeepalive()
    this.#keepaliveTimer = setInterval(() => {
      if (!this.connected || !this.#connection) {
        this.#stopKeepalive()
        return
      }
      try {
        ;(this.#connection as any).sendAudioChunk?.(Buffer.alloc(0))
      } catch {}
    }, interval)
  }

  #stopKeepalive() {
    if (this.#keepaliveTimer) {
      clearInterval(this.#keepaliveTimer)
      this.#keepaliveTimer = null
    }
  }

  sendPCM(_pcm: Buffer): number { return 0 }

  sendOpus(opus: Buffer) {
    if (!this.#connection || !this.connected) return
    if (!this.#opusStream) {
      const bufferSize = this.#voiceCfg.bufferSize ?? 512
      this.#opusStream = new OpusFrameStream(bufferSize)
      ;(this.#connection as any).play(this.#opusStream)
    }
    this.#opusStream.pushFrame(opus)
  }

  finishBuffering() {
    if (this.#opusStream) {
      ;(this.#connection as any)._markAsStoppable()
    }
  }

  stopSpeaking() {
    if (this.#opusStream) {
      this.#opusStream.endStream()
      this.#opusStream = null
    }
    if (this.#connection) {
      ;(this.#connection as any).stop('manual')
    }
  }

  destroy() {
    this.#stopKeepalive()
    if (this.#opusStream) {
      this.#opusStream.endStream()
      this.#opusStream = null
    }
    if (this.#connection) {
      ;(this.#connection as any).destroy()
      this.#connection = null
    }
    this.connected = false
    this.#readyEmitted = false
  }

  close() {
    this.destroy()
  }
}
