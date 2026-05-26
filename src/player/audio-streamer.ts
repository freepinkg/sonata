import https from 'node:https'
import http from 'node:http'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { DiscordVoice } from '../discord/voice.js'
import { AudioMixer } from '../audio/mixer.js'
import { WebmOpusDemuxer } from './webm-demuxer.js'
import { decryptDeezerBuffer } from './blowfish.js'
import type { Track, FilterOptions } from '../types/index.js'
import type { Logger } from '../utils/logger.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const OpusScript = require('opusscript') as typeof import('opusscript')

const SAMPLE_RATE = 48000
const FRAME_DURATION = 20
const FRAME_SIZE = 960 * 2 * 2
const CHANNELS = 2
const FRAME_SAMPLES = 960

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'

const PREBUFFER_FRAMES = 96 // ~2 seconds of audio pre-buffer

interface CrossfadeConfig {
  duration: number
  fadeIn: number
  fadeOut: number
}

function float32ToInt16(channelData: Float32Array[], samplesDecoded: number): Buffer {
  const channels = channelData.length
  const buf = Buffer.alloc(samplesDecoded * channels * 2)
  for (let s = 0; s < samplesDecoded; s++) {
    for (let c = 0; c < channels; c++) {
      const val = Math.max(-1, Math.min(1, channelData[c][s] ?? 0))
      buf.writeInt16LE(Math.round(val * 32767), (s * channels + c) * 2)
    }
  }
  return buf
}

function applyFade(buf: Buffer, sampleCount: number, totalFadeSamples: number, fadeIn: boolean): Buffer {
  if (totalFadeSamples <= 0) return buf
  const out = Buffer.alloc(buf.length)
  const samplesToFade = Math.min(sampleCount, totalFadeSamples)
  for (let i = 0; i < samplesToFade; i++) {
    const gain = fadeIn ? i / totalFadeSamples : (totalFadeSamples - i) / totalFadeSamples
    const idx = i * 2
    const s = buf.readInt16LE(idx)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * gain))), idx)
  }
  for (let i = samplesToFade; i < sampleCount; i++) {
    out.writeInt16LE(buf.readInt16LE(i * 2), i * 2)
  }
  return out
}

export class AudioStreamer extends EventTarget {
  #voice: DiscordVoice
  #currentTrack: Track | null = null
  #nextTrack: Track | null = null
  #playing = false
  #paused = false
  #prebuffering = true
  #position = 0
  #startTime = 0
  #seekPosition = 0
  #positionInterval: ReturnType<typeof setInterval> | null = null
  #sendInterval: ReturnType<typeof setInterval> | null = null
  #pcmBuffer: Buffer[] = []
  #nextPcmBuffer: Buffer[] = []
  #volume = 1.0
  #crossfade: CrossfadeConfig | null = null
  #isCrossfading = false
  #crossfadeStart = 0
  #crossfadingOut = false
  #mixer: AudioMixer | null = null
  #logger: Logger | null = null

  #gaplessCfg: { enabled: boolean; maxGapMs: number; preferAccurate: boolean } | null = null
  #fadeCfg: { enabled: boolean; fadeInMs: number; fadeOutMs: number; onPlay: boolean; onPause: boolean; onResume: boolean; onSkip: boolean } | null = null
  #fadeGain = 1.0
  #fadeTarget = 1.0
  #fadeStart = 0
  #skipFading = false
  #pausePendingFade = false

  #introOutroCfg: { enabled: boolean; introFile?: string; outroFile?: string; mixIntro?: boolean; mixOutro?: boolean } | null = null
  #introPcm: Buffer | null = null
  #outroPcm: Buffer | null = null
  #introPlayed = false
  #outroOffset = 0

  #opusDecoder: InstanceType<typeof OpusScript> | null = null
  #httpReq: http.ClientRequest | null = null
  #demuxer: WebmOpusDemuxer | null = null
  #nextHttpReq: http.ClientRequest | null = null
  #nextDemuxer: WebmOpusDemuxer | null = null
  #streamEnded = false
  #nextStreamEnded = false
  #pcmSource = false
  #opusBuffer: Buffer[] = []

  #proxyAgent: SocksProxyAgent | null = null

  constructor(voice: DiscordVoice, proxy?: { socks?: string }) {
    super()
    this.#voice = voice
    this.#mixer = new AudioMixer()
    if (proxy?.socks) {
      try { this.#proxyAgent = new SocksProxyAgent(proxy.socks) } catch {}
    }
    voice.addEventListener('ready', () => {
      this.#logger?.debug('streamer', `voice ready, currentTrack=${!!this.#currentTrack} playing=${this.#playing}`)
      if (this.#currentTrack && !this.#playing) this.#startStream()
    })
    voice.addEventListener('finished', () => {
      if (!this.#playing) return
      this.#logger?.debug('streamer', 'voice finished')
      this.#onEnd('finished')
    })
  }

  setLogger(logger: Logger) { this.#logger = logger }

  setNormalization(enabled: boolean, target = -14) {
    if (this.#mixer) {
      this.#mixer.setFilters({ normalization: { enabled, target } })
    }
  }

  get mixer() { return this.#mixer }

  get playing() { return this.#playing }
  get paused() { return this.#paused }
  get track() { return this.#currentTrack }
  get position() {
    if (!this.#playing) return this.#seekPosition
    return this.#seekPosition + (Date.now() - this.#startTime)
  }

  setCrossfade(cfg: CrossfadeConfig | null) { this.#crossfade = cfg }

  setGapless(cfg: { enabled: boolean; maxGapMs: number; preferAccurate: boolean } | null) { this.#gaplessCfg = cfg }
  setFade(cfg: { enabled: boolean; fadeInMs: number; fadeOutMs: number; onPlay: boolean; onPause: boolean; onResume: boolean; onSkip: boolean } | null) { this.#fadeCfg = cfg }
  setIntroOutro(cfg: { enabled: boolean; introFile?: string; outroFile?: string; mixIntro?: boolean; mixOutro?: boolean } | null) {
    this.#introOutroCfg = cfg
    if (cfg?.enabled) {
      this.#loadIntroOutro(cfg)
    }
  }

  async #loadIntroOutro(cfg: { introFile?: string; outroFile?: string; mixIntro?: boolean; mixOutro?: boolean }) {
    const { readFile } = await import('node:fs/promises')
    if (cfg.introFile) {
      try {
        const raw = await readFile(cfg.introFile)
        const pcm = await this.#decodeToPcm(raw)
        if (pcm) this.#introPcm = pcm
      } catch { this.#introPcm = null }
    }
    if (cfg.outroFile) {
      try {
        const raw = await readFile(cfg.outroFile)
        const pcm = await this.#decodeToPcm(raw)
        if (pcm) this.#outroPcm = pcm
      } catch { this.#outroPcm = null }
    }
  }

  async #decodeToPcm(data: Buffer): Promise<Buffer | null> {
    try {
      const mod = await import('@sonata-sdk/decoder')
      const { detectFormat, createDecoder } = mod
      const arr = new Uint8Array(data)
      const fmt = detectFormat(arr)
      if (!fmt) return null
      const decoder = await createDecoder(fmt)
      const { channelData, samplesDecoded } = await decoder.decode(arr)
      decoder.free()
      return float32ToInt16(channelData, samplesDecoded)
    } catch {
      return null
    }
  }

  setNextTrack(track: Track) {
    this.#nextTrack = track
    if (this.#playing && this.#crossfade && this.#crossfade.duration > 0) {
      this.#beginCrossfade()
    }
  }

  #getOpusDecoder(): InstanceType<typeof OpusScript> {
    if (!this.#opusDecoder) {
      this.#opusDecoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO)
    }
    return this.#opusDecoder
  }

  #beginCrossfade() {
    if (!this.#nextTrack || this.#isCrossfading) return
    this.#logger?.debug('streamer', `beginning crossfade to "${this.#nextTrack.info.title}"`)
    this.#isCrossfading = true
    this.#crossfadeStart = Date.now()
    this.#crossfadingOut = true

    const uri = this.#nextTrack.userData?.audioUrl as string ?? this.#nextTrack.info.uri
    if (!uri) return

    this.#nextStreamEnded = false
    this.#nextPcmBuffer = []

    this.#nextDemuxer = new WebmOpusDemuxer()
    this.#nextDemuxer.on('data', (opusPacket: Buffer) => {
      try {
          const pcm = this.#getOpusDecoder().decode(opusPacket)
        this.#nextPcmBuffer.push(Buffer.from(pcm))
      } catch {}
    })
    this.#nextDemuxer.on('end', () => {
      this.#nextStreamEnded = true
    })
    this.#nextDemuxer.on('error', () => {})

    const xfOpts = { headers: { 'User-Agent': UA, 'Referer': 'https://www.youtube.com' } } as any
    if (this.#proxyAgent) xfOpts.agent = this.#proxyAgent
    const parsedUrl = new URL(uri)
    const mod = parsedUrl.protocol === 'https:' ? https : http
    const req = mod.get(uri, xfOpts, (res: http.IncomingMessage) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy()
        this.#startHttpsStream(res.headers.location, true)
        return
      }
      if (res.statusCode !== 200) {
        this.#logger?.error('streamer', `crossfade HTTP ${res.statusCode} for ${uri}`)
        return
      }
      res.pipe(this.#nextDemuxer!)
    })
    req.on('error', () => {})
    this.#nextHttpReq = req
  }

  async play(track: Track, startTime = 0) {
    this.#logger?.debug('streamer', `play: track="${track.info.title}" voice.connected=${this.#voice.connected}`)

    if (this.#playing && this.#crossfade && this.#crossfade.duration > 0 && this.#currentTrack && !this.#isCrossfading) {
      this.setNextTrack(track)
      return
    }

    if (this.#isCrossfading) {
      this.#nextTrack = track
      return
    }

    this.#currentTrack = track
    this.#seekPosition = startTime
    this.#position = 0
    this.#paused = false

    if (this.#fadeCfg?.enabled && this.#fadeCfg.onPlay) {
      this.#fadeGain = 0
      this.#fadeTarget = 1
      this.#fadeStart = Date.now()
    } else {
      this.#fadeGain = 1
      this.#fadeTarget = 1
    }

    if (!this.#voice.connected) {
      this.#logger?.debug('streamer', `play: voice not connected, waiting for ready event`)
      return
    }

    this.#startStream()
  }

  async #startStream() {
    if (!this.#currentTrack) return

    const uri = this.#currentTrack.userData?.audioUrl as string ?? this.#currentTrack.info.uri
    if (!uri) {
      this.#onEnd('loadFailed')
      return
    }

    this.#logger?.debug('streamer', `starting HTTP stream for ${uri?.substring(0, 80)}`)

    this.#playing = true
    this.#prebuffering = true
    this.#startTime = Date.now()
    this.#streamEnded = false
    this.#pcmBuffer = []
    this.#pcmSource = false
    this.#introPlayed = false

    if (this.#introPcm && this.#introOutroCfg?.enabled) {
      this.#pcmBuffer.push(this.#introPcm)
      this.#introPlayed = true
    }

    this.dispatchEvent(new CustomEvent('start', { detail: { track: this.#currentTrack } }))

    const isDeezer = this.#currentTrack.source === 'deezer' && uri !== this.#currentTrack.info.uri
    const isJioSaavn = this.#currentTrack.source === 'jiosaavn'

    if (isDeezer) {
      this.#pcmSource = true
      await this.#startDeezerStream(uri)
    } else if (isJioSaavn) {
      this.#pcmSource = true
      await this.#startMp3Stream(uri)
    } else {
      this.#opusBuffer = []
      this.#demuxer = new WebmOpusDemuxer()
      this.#demuxer.on('data', (opusPacket: Buffer) => {
        this.#opusBuffer.push(opusPacket)
      })
      this.#demuxer.on('end', () => {
        this.#logger?.debug('streamer', `demuxer stream ended`)
        this.#streamEnded = true
      })
      this.#demuxer.on('error', () => {})
      this.#startHttpsStream(uri, false)
    }

    this.#logger?.debug('streamer', 'starting sendInterval')
    this.#prebuffering = true
    this.#sendInterval = setInterval(() => {
      if (this.#skipFading && this.#fadeGain <= 0.01) {
        this.#hardStop()
        return
      }
      if (this.#pausePendingFade && this.#fadeGain <= 0.01) {
        this.#pausePendingFade = false
        this.#paused = true
        this.#voice.stopSpeaking()
        this.dispatchEvent(new CustomEvent('pause'))
        return
      }
      if (!this.#pausePendingFade && (this.#paused || !this.#playing)) return
      if (this.#prebuffering) {
        if (this.#pcmSource) {
          this.#prebuffering = false
        } else if (this.#streamEnded) {
          this.#prebuffering = false
          this.#logger?.debug('streamer', `pre-buffer done, ${this.#opusBuffer.length} opus frames (stream ended)`)
        }
        return
      }
      if (this.#pcmBuffer.length === 0 && this.#streamEnded && this.#opusBuffer.length === 0) {
        if (this.#isCrossfading) {
          this.#finishCrossfade()
        } else if (this.#pcmSource) {
          this.#voice.finishBuffering()
        } else {
          // Gapless: if next track ready, transition without stopping
          if (this.#gaplessCfg?.enabled && this.#nextTrack) {
            this.#performGaplessTransition()
            return
          }
          // Append outro PCM if available
          if (this.#outroPcm) {
            this.#pcmBuffer.push(this.#outroPcm)
            this.#streamEnded = false
            this.#outroPcm = null
            return
          }
          this.#onEnd('finished')
        }
        return
      }
      if (this.#isCrossfading && this.#nextPcmBuffer.length > 0) {
        this.#sendCrossfadeFrame()
      } else if (this.#pcmBuffer.length > 0) {
        this.#sendNextFrame()
      } else if (this.#opusBuffer.length > 0) {
        const opus = this.#opusBuffer.shift()!
        this.#voice.sendOpus(opus)
      }
    }, FRAME_DURATION)

    this.#positionInterval = setInterval(() => {
      this.#seekPosition = this.position
    }, 1000)
  }

  async #startMp3Stream(uri: string) {
    try {
      const mod = await import('@sonata-sdk/decoder')
      const { detectFormat, createDecoder } = mod

      const raw = await new Promise<Buffer>((resolve, reject) => {
        const opts: https.RequestOptions = { headers: { 'User-Agent': UA }, timeout: 15000 }
        if (this.#proxyAgent) (opts as any).agent = this.#proxyAgent
        const req = https.get(uri, opts, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      })

      this.#logger?.debug('streamer', `MP3 download complete: ${raw.length} bytes`)
      const data = new Uint8Array(raw)
      // Skip ID3v2 header for format detection (MP3 sync word comes after metadata)
      let detectOffset = 0
      if (data.length >= 10 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
        const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f)
        detectOffset = 10 + size
      }
      let fmt = detectFormat(data.subarray(detectOffset))
      if (!fmt) {
        const fallback = this.#currentTrack?.userData?.fallbackUrl as string | undefined
        if (fallback && fallback !== uri) {
          this.#logger?.debug('streamer', `format not detected, retrying with fallbackUrl: ${fallback.substring(0, 60)}`)
          await this.#startMp3Stream(fallback)
          return
        }
        this.#logger?.error('streamer', 'unknown audio format for MP3 stream')
        this.#onEnd('loadFailed')
        return
      }

      const decoder = await createDecoder(fmt)
      const { channelData, samplesDecoded } = await decoder.decode(data)
      decoder.free()

      const pcm = float32ToInt16(channelData, samplesDecoded)
      this.#pcmBuffer.push(pcm)
      this.#streamEnded = true
    } catch (err) {
      const fallback = this.#currentTrack?.userData?.fallbackUrl as string | undefined
      if (fallback && fallback !== uri) {
        this.#logger?.debug('streamer', `MP3 stream error, retrying with fallbackUrl: ${(err as Error).message}`)
        await this.#startMp3Stream(fallback)
        return
      }
      this.#logger?.error('streamer', `MP3 stream error: ${(err as Error).message}`)
      this.#onEnd('loadFailed')
    }
  }

  async #startDeezerStream(uri: string) {
    try {
      const mod = await import('@sonata-sdk/decoder')
      const { detectFormat, createDecoder } = mod

      const raw = await new Promise<Buffer>((resolve, reject) => {
        const opts: https.RequestOptions = { headers: { 'User-Agent': UA } }
        if (this.#proxyAgent) (opts as any).agent = this.#proxyAgent
        https.get(uri, opts, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        }).on('error', reject)
      })

      const trackId = this.#currentTrack!.info.identifier

      let data: Uint8Array
      let fmt = detectFormat(new Uint8Array(raw))

      if (fmt) {
        data = new Uint8Array(raw)
      } else {
        const decrypted = decryptDeezerBuffer(raw, trackId)
        data = new Uint8Array(decrypted)
        fmt = detectFormat(data)
        if (!fmt) {
          this.#logger?.error('streamer', 'unknown deezer audio format')
          this.#onEnd('loadFailed')
          return
        }
      }

      const decoder = await createDecoder(fmt)
      const { channelData, samplesDecoded } = await decoder.decode(data)
      decoder.free()

      const pcm = float32ToInt16(channelData, samplesDecoded)
      this.#pcmBuffer.push(pcm)
      this.#streamEnded = true
    } catch (err) {
      this.#logger?.error('streamer', `Deezer stream error: ${(err as Error).message}`)
      this.#onEnd('loadFailed')
    }
  }

  #startHttpsStream(uri: string, isNext: boolean) {
    const opts: https.RequestOptions & { agent?: any } = {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://www.youtube.com',
      },
    }
    if (this.#proxyAgent) opts.agent = this.#proxyAgent
    const req = https.get(uri, opts, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy()
        this.#startHttpsStream(res.headers.location, isNext)
        return
      }
      if (res.statusCode !== 200) {
        this.#logger?.error('streamer', `HTTP ${res.statusCode} for ${uri}`)
        if (!isNext) this.#onEnd('loadFailed')
        return
      }
      this.#logger?.debug('streamer', `HTTP 200 for ${uri?.substring(0, 80)}...`)
      const targetDemuxer = isNext ? this.#nextDemuxer : this.#demuxer
      if (targetDemuxer) {
        let httpBytes = 0
        res.on('data', (c: Buffer) => {
          httpBytes += c.length
          if (httpBytes % 65536 < c.length) this.#logger?.debug('streamer', `HTTP received ${httpBytes} bytes total`)
        })
        res.on('end', () => this.#logger?.debug('streamer', `HTTP response ended, total=${httpBytes} bytes`))
        res.pipe(targetDemuxer)
      }
    })
    req.on('error', (err) => {
      this.#logger?.error('streamer', `HTTP error: ${err.message}`)
      if (!isNext) this.#onEnd('loadFailed')
    })
    if (isNext) {
      this.#nextHttpReq = req
    } else {
      this.#httpReq = req
    }
  }

  #sendCrossfadeFrame() {
    const cf = this.#crossfade
    if (!cf) {
      this.#isCrossfading = false
      this.#sendNextFrame()
      return
    }

    const fadeOutDur = cf.fadeOut || cf.duration
    const fadeInDur = cf.fadeIn || cf.duration
    const elapsed = Date.now() - this.#crossfadeStart
    const fadeOutTotalSamples = (fadeOutDur / 1000) * SAMPLE_RATE
    const fadeInTotalSamples = (fadeInDur / 1000) * SAMPLE_RATE
    const fadeOutProgress = Math.min(1, elapsed / fadeOutDur)
    const fadeInProgress = Math.min(1, elapsed / fadeInDur)

    let needed = FRAME_SIZE
    let frame = Buffer.alloc(0)

    while (needed > 0 && this.#pcmBuffer.length > 0) {
      const chunk = this.#pcmBuffer[0]
      if (chunk.length <= needed) {
        frame = Buffer.concat([frame, chunk])
        needed -= chunk.length
        this.#pcmBuffer.shift()
      } else {
        frame = Buffer.concat([frame, chunk.subarray(0, needed)])
        this.#pcmBuffer[0] = chunk.subarray(needed)
        needed = 0
      }
    }

    if (frame.length < FRAME_SIZE) {
      if (this.#nextPcmBuffer.length > 0) {
        this.#finishCrossfade()
        return
      }
      return
    }

    const sampleCount = frame.length / 2
    for (let i = 0; i < sampleCount; i++) {
      const gain = 1 - fadeOutProgress
      const idx = i * 2
      const s = frame.readInt16LE(idx)
      frame.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * gain))), idx)
    }

    needed = FRAME_SIZE
    let nextFrame = Buffer.alloc(0)
    while (needed > 0 && this.#nextPcmBuffer.length > 0) {
      const chunk = this.#nextPcmBuffer[0]
      if (chunk.length <= needed) {
        nextFrame = Buffer.concat([nextFrame, chunk])
        needed -= chunk.length
        this.#nextPcmBuffer.shift()
      } else {
        nextFrame = Buffer.concat([nextFrame, chunk.subarray(0, needed)])
        this.#nextPcmBuffer[0] = chunk.subarray(needed)
        needed = 0
      }
    }

    if (nextFrame.length >= FRAME_SIZE) {
      for (let i = 0; i < sampleCount; i++) {
        const gain = fadeInProgress
        const idx = i * 2
        const s = nextFrame.readInt16LE(idx)
        nextFrame.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * gain))), idx)
      }

      for (let i = 0; i < frame.length; i += 2) {
        const a = frame.readInt16LE(i)
        const b = nextFrame.readInt16LE(i)
        let mixed = a + b
        if (mixed > 32767) mixed = 32767
        if (mixed < -32768) mixed = -32768
        frame.writeInt16LE(mixed, i)
      }
    }

    if (fadeOutProgress >= 1 && this.#nextPcmBuffer.length > 0) {
      this.#finishCrossfade()
      return
    }

    if (this.#mixer) {
      const pcm = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2)
      const processed = this.#mixer.apply(pcm, SAMPLE_RATE)
      frame = Buffer.from(processed.buffer as ArrayBuffer)
    }
    try {
      const opus = this.#getOpusDecoder().encode(frame, FRAME_SAMPLES)
      this.#voice.sendOpus(Buffer.from(opus))
    } catch {}
  }

  #performGaplessTransition() {
    if (!this.#nextTrack) return
    this.#logger?.debug('streamer', `gapless transition to "${this.#nextTrack.info.title}"`)
    this.#cleanupHttp(false)
    const oldTrack = this.#currentTrack
    if (this.#nextDemuxer || this.#nextPcmBuffer.length > 0) {
      this.#currentTrack = this.#nextTrack
      this.#nextTrack = null
      this.#seekPosition = 0
      this.#startTime = Date.now()
      this.#demuxer = this.#nextDemuxer
      this.#nextDemuxer = null
      this.#httpReq = this.#nextHttpReq
      this.#nextHttpReq = null
      this.#streamEnded = this.#nextStreamEnded
      this.#nextStreamEnded = false
      this.#pcmBuffer = [...this.#nextPcmBuffer]
      this.#nextPcmBuffer = []
      if (oldTrack) {
        this.dispatchEvent(new CustomEvent('start', { detail: { track: this.#currentTrack } }))
      }
    } else {
      const track = this.#nextTrack
      this.#nextTrack = null
      this.#onEnd('finished')
      // player will advance to next track via onTrackEnd callback
    }
  }

  #finishCrossfade() {
    this.#isCrossfading = false
    this.#nextPcmBuffer = []

    this.#cleanupHttp(false)

    const oldTrack = this.#currentTrack
    if (this.#nextTrack) {
      this.#currentTrack = this.#nextTrack
      this.#nextTrack = null
      this.#seekPosition = 0
      this.#startTime = Date.now()
      this.#demuxer = this.#nextDemuxer
      this.#nextDemuxer = null
      this.#httpReq = this.#nextHttpReq
      this.#nextHttpReq = null
      this.#streamEnded = this.#nextStreamEnded
      this.#nextStreamEnded = false
      this.#pcmBuffer = [...this.#nextPcmBuffer]
      this.#nextPcmBuffer = []

      this.dispatchEvent(new CustomEvent('start', { detail: { track: this.#currentTrack } }))
    }

    if (oldTrack) {
      this.dispatchEvent(new CustomEvent('crossfade', { detail: { oldTrack, newTrack: this.#currentTrack } }))
    }
  }

  #sendNextFrame() {
    let needed = FRAME_SIZE
    let frame = Buffer.alloc(0)

    while (needed > 0 && this.#pcmBuffer.length > 0) {
      const chunk = this.#pcmBuffer[0]
      if (chunk.length <= needed) {
        frame = Buffer.concat([frame, chunk])
        needed -= chunk.length
        this.#pcmBuffer.shift()
      } else {
        frame = Buffer.concat([frame, chunk.subarray(0, needed)])
        this.#pcmBuffer[0] = chunk.subarray(needed)
        needed = 0
      }
    }

    if (frame.length >= FRAME_SIZE) {
      // Apply fade envelope
      const fc = this.#fadeCfg
      if (fc?.enabled && this.#fadeGain !== this.#fadeTarget) {
        const elapsed = Date.now() - this.#fadeStart
        const dur = this.#fadeTarget === 0 ? fc.fadeOutMs : fc.fadeInMs
        const progress = dur > 0 ? Math.min(1, elapsed / dur) : 1
        this.#fadeGain = this.#fadeTarget === 0 ? (1 - progress) : progress
        if (progress >= 1) this.#fadeGain = this.#fadeTarget
        const sampleCount = frame.length / 2
        for (let i = 0; i < sampleCount; i++) {
          const idx = i * 2
          const s = frame.readInt16LE(idx)
          frame.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * this.#fadeGain))), idx)
        }
        if (this.#fadeTarget === 0 && this.#fadeGain <= 0.01) {
          // pause fade or skip fade handled in send loop
        }
      }

      if (this.#mixer) {
        const pcm = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2)
        const processed = this.#mixer.apply(pcm, SAMPLE_RATE)
        frame = Buffer.from(processed.buffer as ArrayBuffer)
      }
      try {
        const opus = this.#getOpusDecoder().encode(frame, FRAME_SAMPLES)
        this.#voice.sendOpus(Buffer.from(opus))
      } catch {}
    }
  }

  pause() {
    if (this.#fadeCfg?.enabled && this.#fadeCfg.onPause && this.#fadeGain > 0.01) {
      this.#fadeTarget = 0
      this.#fadeStart = Date.now()
      this.#pausePendingFade = true
      this.#seekPosition = this.position
      return
    }
    this.#paused = true
    this.#seekPosition = this.position
    this.#voice.stopSpeaking()
    this.dispatchEvent(new CustomEvent('pause'))
  }

  resume() {
    if (!this.#paused) return
    this.#paused = false
    this.#startTime = Date.now()
    if (this.#fadeCfg?.enabled && this.#fadeCfg.onResume) {
      this.#fadeGain = 0
      this.#fadeTarget = 1
      this.#fadeStart = Date.now()
    }
    this.dispatchEvent(new CustomEvent('resume'))
  }

  seek(position: number) {
    this.#seekPosition = Math.max(0, position)
    this.#startTime = Date.now()
    this.#isCrossfading = false
    this.#cleanupHttp(true)
    this.#nextPcmBuffer = []
    this.#nextTrack = null
    if (this.#currentTrack) {
      this.#startStream()
    }
  }

  setPlayerFilters(f: FilterOptions) {
    if (!this.#mixer) return
    const mf: any = {}
    if (f.volume !== undefined) mf.volume = f.volume
    if (f.equalizer) mf.equalizer = f.equalizer
    if (f.karaoke) mf.karaoke = f.karaoke
    if (f.timescale) mf.timescale = f.timescale
    if (f.tremolo) mf.tremolo = f.tremolo
    if (f.vibrato) mf.vibrato = f.vibrato
    if (f.rotation) mf.rotation = f.rotation
    if (f.distortion) mf.distortion = f.distortion
    if (f.channelMix) mf.channelMix = f.channelMix
    if (f.lowPass) mf.lowPass = f.lowPass
    if (f.highPass) mf.highPass = f.highPass
    if (f.reverb) mf.reverb = f.reverb
    if (f.limiter) mf.limiter = f.limiter
    if ((f as any).ducking) mf.ducking = (f as any).ducking
    if ((f as any).autoVolume) mf.autoVolume = (f as any).autoVolume
    this.#mixer.setFilters(mf)
  }

  setVolume(v: number) {
    this.#volume = Math.max(0, Math.min(1, v / 100))
  }

  stop() {
    if (this.#playing && this.#fadeCfg?.enabled && this.#fadeCfg.onSkip && this.#fadeGain > 0.01) {
      this.#fadeTarget = 0
      this.#fadeStart = Date.now()
      this.#skipFading = true
      this.#paused = false
      return
    }
    this.#hardStop()
  }

  #hardStop() {
    this.#skipFading = false
    this.#playing = false
    this.#paused = false
    this.#seekPosition = 0
    this.#startTime = 0
    this.#currentTrack = null
    this.#nextTrack = null
    this.#isCrossfading = false

    this.#clearIntervals()
    this.#cleanupHttp(false)
    this.#cleanupHttp(true)
    this.#pcmBuffer = []
    this.#nextPcmBuffer = []
    this.#opusBuffer = []
    this.#voice.stopSpeaking()
  }

  #clearIntervals() {
    if (this.#sendInterval) {
      clearInterval(this.#sendInterval)
      this.#sendInterval = null
    }
    if (this.#positionInterval) {
      clearInterval(this.#positionInterval)
      this.#positionInterval = null
    }
  }

  #cleanupHttp(isNext: boolean) {
    const req = isNext ? this.#nextHttpReq : this.#httpReq
    const demuxer = isNext ? this.#nextDemuxer : this.#demuxer

    if (req) {
      req.destroy()
      if (isNext) this.#nextHttpReq = null
      else this.#httpReq = null
    }
    if (demuxer) {
      demuxer.destroy()
      if (isNext) this.#nextDemuxer = null
      else this.#demuxer = null
    }
  }

  #onEnd(reason: string) {
    this.#playing = false

    this.#clearIntervals()
    this.#cleanupHttp(false)
    this.#cleanupHttp(true)

    this.#voice.stopSpeaking()

    const track = this.#currentTrack
    this.#currentTrack = null
    this.#nextTrack = null
    this.#isCrossfading = false

    this.dispatchEvent(new CustomEvent('end', { detail: { track, reason } }))
  }
}
