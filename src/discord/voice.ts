import OpusScript from 'opusscript'
import voiceLib from '@performanc/voice'

const { joinVoiceChannel } = voiceLib

const OPUS_FRAME_SIZE = 960
const PCM_FRAME_SIZE = OPUS_FRAME_SIZE * 2 * 2

export interface VoiceConnectOptions {
  guildId: string
  userId: string
  sessionId: string
  token: string
  endpoint: string
  channelId: string
}

export class DiscordVoice extends EventTarget {
  #connection: any = null
  #opts: VoiceConnectOptions | null = null
  #readyEmitted = false
  #encoder: any = null
  #hasSpoken = false

  connected = false
  ping = 0

  get ssrc() { return this.#connection?.udpInfo?.ssrc ?? 0 }
  get speaking() { return this.#connection?.playerState?.status === 'playing' }

  connect(opts: VoiceConnectOptions) {
    this.#opts = opts
    this.#createConnection()
  }

  #createConnection() {
    const opts = this.#opts!
    console.log(`[Voice] Creating connection: guild=${opts.guildId} userId=${opts.userId} channelId=${opts.channelId}`)

    this.#connection = joinVoiceChannel({
      guildId: opts.guildId,
      userId: opts.userId,
      channelId: opts.channelId,
      encryption: 'aead_aes256_gcm_rtpsize',
    })

    console.log(`[Voice] Connection object created, initial state=${this.#connection.state?.status}`)

    this.#connection.on('stateChange', (_oldState: any, newState: any) => {
      const status = newState.status
      const reason = newState.reason
      const code = newState.code
      const closeReason = newState.closeReason
      console.log(`[Voice] stateChange: ${_oldState?.status} -> ${status} (reason=${reason}, code=${code}, closeReason=${closeReason})`)
      if (status === 'connected') {
        this.connected = true
        this.ping = this.#connection.ping ?? 0
        if (!this.#readyEmitted) {
          this.#readyEmitted = true
          this.dispatchEvent(new CustomEvent('ready'))
        }
      } else if (status === 'disconnected' || status === 'destroyed') {
        this.connected = false
        this.#readyEmitted = false
      }
    })

    this.#connection.on('playerStateChange', (_oldState: any, newState: any) => {
      if (newState.status === 'idle' && _oldState.status === 'playing') {
        this.dispatchEvent(new CustomEvent('end'))
      } else if (newState.status === 'playing' && _oldState.status !== 'playing') {
        this.dispatchEvent(new CustomEvent('start'))
      }
    })

    this.#connection.on('error', (err: any) => {
      console.log(`[Voice] Error: ${err?.message ?? err}`)
    })
  }

  feedVoiceUpdate(sessionId: string, token: string, endpoint: string) {
    if (!this.#connection) return

    const cleanEndpoint = endpoint.replace(/^wss:\/\//, '').replace(/\/\?v=\d+$/, '')
    console.log(`[Voice] feedVoiceUpdate: endpoint=${cleanEndpoint} sessionId=${sessionId}`)

    this.#connection.voiceStateUpdate({ session_id: sessionId })
    this.#connection.voiceServerUpdate({ token, endpoint: cleanEndpoint })
    console.log(`[Voice] calling connect()...`)
    this.#connection.connect()
    console.log(`[Voice] connect() returned, state=${this.#connection.state?.status}`)
  }

  sendPCM(pcm: Buffer): number {
    const c = this.#connection
    if (!c || !this.connected) return 0
    if (!this.#encoder) {
      this.#encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO)
      console.log(`[Voice] Opus encoder created`)
    }
    if (pcm.length < PCM_FRAME_SIZE) {
      console.log(`[Voice] sendPCM: short frame ${pcm.length} < ${PCM_FRAME_SIZE}`)
      return 0
    }
    try {
      const opus = this.#encoder.encode(pcm, OPUS_FRAME_SIZE)
      if (opus?.length > 0) {
        if (!this.#hasSpoken) {
          this.#hasSpoken = true
          console.log(`[Voice] first audio chunk, setting speaking`)
          try { c._setSpeaking(1 << 0) } catch (e) { console.log(`[Voice] _setSpeaking error: ${e}`) }
        }
        c.sendAudioChunk(opus)
      } else {
        console.log(`[Voice] opus encode returned empty`)
        return 0
      }
    } catch (e) {
      console.log(`[Voice] sendPCM error: ${e}`)
      return 0
    }
    return 1
  }

  stopSpeaking() {
    if (this.#connection) {
      this.#connection.stop()
      this.#connection._setSpeaking(0)
    }
    this.#hasSpoken = false
  }

  destroy() {
    this.stopSpeaking()
    if (this.#encoder) {
      this.#encoder.delete()
      this.#encoder = null
    }
    if (this.#connection) {
      this.#connection.destroy()
      this.#connection.removeAllListeners()
      this.#connection = null
    }
    this.connected = false
    this.#readyEmitted = false
  }

  close() {
    this.destroy()
  }
}
