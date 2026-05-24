import { createSocket, Socket } from 'node:dgram'
import { OpusEncoder } from '../native/index.js'
import nacl from 'tweetnacl'

const VOICE_VERSION = 0x80 | 0x70
const FRAME_SIZE = 960
const CHANNELS = 2
const NONCE_LEN = 24
const HEADER_LEN = 12
const MAC_LEN = 16

export interface VoiceOptions {
  endpoint: string
  port: number
  ssrc: number
  token: string
  guildId: string
}

export class DiscordVoice extends EventTarget {
  #socket: Socket | null = null
  endpoint = ''
  port = 0
  ssrc = 0
  #token = ''
  #guildId = ''
  connected = false
  #speaking = false
  #sequence = 0
  #timestamp = 0
  #encoder: OpusEncoder
  #secretKey: Uint8Array = new Uint8Array(0)

  constructor() {
    super()
    this.#encoder = new OpusEncoder({ sampleRate: 48000, channels: 2, frameSize: FRAME_SIZE })
  }

  get speaking() { return this.#speaking }

  connect(opts: VoiceOptions) {
    this.endpoint = opts.endpoint
    this.port = opts.port
    this.ssrc = opts.ssrc
    this.#token = opts.token
    this.#guildId = opts.guildId
    this.#sequence = 0
    this.#timestamp = 0

    this.#socket = createSocket('udp4')
    this.#socket.on('error', (err) => this.dispatchEvent(new CustomEvent('error', { detail: err })))
    this.#socket.on('message', (msg) => this.#handleMessage(msg))
    this.#socket.send(this.#ipDiscovery(), this.port, this.endpoint)
  }

  close() {
    this.#socket?.close()
    this.#socket = null
    this.connected = false
    this.#speaking = false
    this.#sequence = 0
    this.#timestamp = 0
  }

  setSecretKey(key: Uint8Array) {
    this.#secretKey = key
  }

  sendAudio(pcm: Buffer): number {
    if (!this.connected || !this.#socket || this.#secretKey.length === 0) return 0

    if (!this.#speaking) {
      this.#speaking = true
      this.#sendSpeaking(1)
    }

    const frames = Math.floor(pcm.length / (FRAME_SIZE * CHANNELS * 2))
    let sent = 0

    for (let f = 0; f < frames; f++) {
      const offset = f * FRAME_SIZE * CHANNELS * 2
      const frame = pcm.subarray(offset, offset + FRAME_SIZE * CHANNELS * 2)
      const opus = this.#encoder.encode(frame)
      if (opus.length > 0) {
        this.#sendPacket(opus)
        sent++
      }
    }
    return sent
  }

  stop() {
    if (this.#speaking) {
      this.#sendSpeaking(0)
      this.#speaking = false
    }
  }

  #handleMessage(msg: Buffer) {
    if (msg.length === 74) {
      const ip = msg.slice(8, 72).toString().replace(/\0/g, '')
      const ourPort = msg.readUInt16BE(72)
      this.dispatchEvent(new CustomEvent('ipDiscovery', { detail: { ip, port: ourPort, ssrc: this.ssrc } }))
      this.connected = true
      this.#selectProtocol(ip, ourPort)
    } else if (msg.length === 70) {
      const code = msg.readUInt32BE(4)
      this.connected = code === 1
      if (this.connected) {
        this.dispatchEvent(new CustomEvent('ready'))
      }
    }
  }

  #ipDiscovery(): Buffer {
    const p = Buffer.alloc(74)
    p.writeUInt16BE(0x1, 0)
    p.writeUInt16BE(70, 2)
    p.writeUInt32BE(this.ssrc, 4)
    return p
  }

  #selectProtocol(ip: string, port: number) {
    const p = Buffer.alloc(76)
    p.writeUInt16BE(0x1, 0)
    p.writeUInt16BE(70, 2)
    p.writeUInt32BE(this.ssrc, 4)
    Buffer.from(ip).copy(p, 8, 0, Math.min(ip.length, 64))
    p.writeUInt16BE(port, 72)
    this.#socket?.send(p, this.port, this.endpoint)
  }

  #sendSpeaking(state: number) {
    const p = Buffer.alloc(17)
    p.writeUInt16BE(0x1, 0)
    p.writeUInt16BE(16, 2)
    p.writeUInt32BE(this.ssrc, 4)
    p.writeUInt32BE(state, 8)
    p.writeUInt32BE(0, 12)
    this.#socket?.send(p, this.port, this.endpoint)
  }

  #sendPacket(opus: Buffer) {
    const nonceSuffix = nacl.randomBytes(12)

    // nonce = RTP header (12 bytes) + random suffix (12 bytes)
    const nonce = new Uint8Array(24)
    const header = Buffer.alloc(HEADER_LEN)
    header[0] = VOICE_VERSION
    header[1] = 0x00
    header.writeUInt16BE(this.#sequence & 0xFFFF, 2)
    header.writeUInt32BE(this.#timestamp, 4)
    header.writeUInt32BE(this.ssrc, 8)
    nonce.set(header, 0)
    nonce.set(nonceSuffix, 12)

    const encrypted = nacl.secretbox(opus, nonce, this.#secretKey)
    if (!encrypted) return

    const p = Buffer.alloc(HEADER_LEN + encrypted.length + 12)
    header.copy(p, 0)
    Buffer.from(encrypted).copy(p, HEADER_LEN)
    Buffer.from(nonceSuffix).copy(p, HEADER_LEN + encrypted.length)

    this.#socket?.send(p, this.port, this.endpoint)

    this.#sequence++
    this.#timestamp += FRAME_SIZE
  }
}
