import { spawn, ChildProcess } from 'node:child_process'
import { DiscordVoice } from '../discord/voice.js'
import type { Track } from '../types/index.js'

const SAMPLE_RATE = 48000
const FRAME_DURATION = 20
const FRAME_SIZE = 960 * 2 * 2

export class AudioStreamer extends EventTarget {
  #proc: ChildProcess | null = null
  #voice: DiscordVoice
  #currentTrack: Track | null = null
  #playing = false
  #paused = false
  #position = 0
  #startTime = 0
  #seekPosition = 0
  #positionInterval: ReturnType<typeof setInterval> | null = null
  #sendInterval: ReturnType<typeof setInterval> | null = null
  #pcmBuffer: Buffer[] = []
  #volume = 1.0

  constructor(voice: DiscordVoice) {
    super()
    this.#voice = voice
    voice.addEventListener('ready', () => {
      if (this.#currentTrack && !this.#playing) this.#startStream()
    })
  }

  get playing() { return this.#playing }
  get paused() { return this.#paused }
  get track() { return this.#currentTrack }
  get position() {
    if (!this.#playing) return this.#seekPosition
    return this.#seekPosition + (Date.now() - this.#startTime)
  }

  async play(track: Track, startTime = 0) {
    console.log(`[Streamer] play: track="${track.info.title}" voice.connected=${this.#voice.connected}`)
    this.#currentTrack = track
    this.#seekPosition = startTime
    this.#position = 0
    this.#paused = false

    if (!this.#voice.connected) {
      console.log(`[Streamer] play: voice not connected, waiting for ready event`)
      return
    }

    this.#startStream()
  }

  #startStream() {
    if (!this.#currentTrack) return

    const uri = this.#currentTrack.info.uri
    if (!uri) {
      this.#onEnd('loadFailed')
      return
    }

    const args = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', uri,
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-loglevel', 'quiet',
      'pipe:1',
    ]

    if (this.#seekPosition > 0) {
      args.unshift('-ss', String(this.#seekPosition / 1000))
    }

    console.log(`[Streamer] starting ffmpeg`)

    this.#proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    this.#proc.on('error', (e) => console.log(`[Streamer] ffmpeg error: ${e.message}`))

    const stdout = this.#proc.stdout
    if (!stdout) {
      this.#onEnd('loadFailed')
      return
    }

    this.#playing = true
    this.#startTime = Date.now()
    this.dispatchEvent(new CustomEvent('start', { detail: { track: this.#currentTrack } }))

    this.#pcmBuffer = []
    let feedDone = false

    stdout.on('data', (chunk: Buffer) => {
      if (this.#paused) return
      this.#pcmBuffer.push(chunk)
    })

    stdout.on('end', () => {
      console.log(`[Streamer] ffmpeg done, total PCM buffered`)
      feedDone = true
    })

    this.#proc.on('exit', (code, signal) => {
      console.log(`[Streamer] ffmpeg exit: code=${code} signal=${signal}`)
      feedDone = true
      if (code !== 0 && this.#playing) {
        this.#onEnd('loadFailed')
      }
    })

    this.#sendInterval = setInterval(() => {
      if (this.#paused || !this.#playing) return
      if (this.#pcmBuffer.length === 0) {
        if (feedDone) {
          this.#onEnd('finished')
        }
        return
      }
      this.#sendNextFrame()
    }, FRAME_DURATION)

    this.#positionInterval = setInterval(() => {
      this.#seekPosition = this.position
    }, 1000)
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
      this.#voice.sendPCM(frame)
    }
  }

  pause() {
    this.#paused = true
    this.#seekPosition = this.position
    this.#voice.stopSpeaking()
    if (this.#proc) {
      this.#proc.kill('SIGSTOP')
    }
    this.dispatchEvent(new CustomEvent('pause'))
  }

  resume() {
    if (!this.#paused) return
    this.#paused = false
    this.#startTime = Date.now()
    if (this.#proc) {
      this.#proc.kill('SIGCONT')
    }
    this.dispatchEvent(new CustomEvent('resume'))
  }

  seek(position: number) {
    this.#seekPosition = Math.max(0, position)
    this.#startTime = Date.now()
    this.#proc?.kill('SIGKILL')
    if (this.#currentTrack) {
      this.#startStream()
    }
  }

  setVolume(v: number) {
    this.#volume = Math.max(0, Math.min(1, v / 100))
  }

  stop() {
    this.#playing = false
    this.#paused = false
    this.#seekPosition = 0
    this.#startTime = 0
    this.#currentTrack = null

    if (this.#sendInterval) {
      clearInterval(this.#sendInterval)
      this.#sendInterval = null
    }
    if (this.#positionInterval) {
      clearInterval(this.#positionInterval)
      this.#positionInterval = null
    }
    if (this.#proc) {
      this.#proc.kill('SIGKILL')
      this.#proc = null
    }
    this.#pcmBuffer = []
    this.#voice.stopSpeaking()
  }

  #onEnd(reason: string) {
    this.#playing = false

    if (this.#sendInterval) {
      clearInterval(this.#sendInterval)
      this.#sendInterval = null
    }
    if (this.#positionInterval) {
      clearInterval(this.#positionInterval)
      this.#positionInterval = null
    }
    if (this.#proc) {
      this.#proc.kill('SIGKILL')
      this.#proc = null
    }

    this.#voice.stopSpeaking()

    const track = this.#currentTrack
    this.#currentTrack = null

    this.dispatchEvent(new CustomEvent('end', { detail: { track, reason } }))
  }
}
