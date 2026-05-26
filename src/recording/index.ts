import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import type { Logger } from '../utils/logger.js'

export interface RecordingConfig {
  enabled: boolean
  dir?: string
  format?: 'wav' | 'opus' | 'pcm'
  maxDuration?: number
  splitOnTrack?: boolean
  autoStart?: boolean
  maxConcurrent?: number
}

export class RecordingManager {
  #cfg: RecordingConfig
  #logger: Logger | null = null
  #activeRecordings = new Map<string, { stream: import('node:fs').WriteStream; startTime: number; guildId: string }>()

  constructor(cfg: RecordingConfig) {
    this.#cfg = cfg
  }

  setLogger(logger: Logger) { this.#logger = logger }

  get activeCount() { return this.#activeRecordings.size }

  startRecording(guildId: string, trackName?: string): boolean {
    if (!this.#cfg.enabled) return false
    if (this.#cfg.maxConcurrent && this.#activeRecordings.size >= this.#cfg.maxConcurrent) return false

    const dir = this.#cfg.dir ?? 'recordings'
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const ext = this.#cfg.format === 'opus' ? '.opus' : this.#cfg.format === 'pcm' ? '.pcm' : '.wav'
    const name = trackName ? `${trackName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : guildId
    const file = join(dir, `${name}-${Date.now()}${ext}`)
    const stream = createWriteStream(file)

    this.#activeRecordings.set(guildId, { stream, startTime: Date.now(), guildId })
    this.#logger?.info('Recording', `Started recording ${file}`)
    return true
  }

  stopRecording(guildId: string): boolean {
    const rec = this.#activeRecordings.get(guildId)
    if (!rec) return false
    rec.stream.end()
    this.#activeRecordings.delete(guildId)
    this.#logger?.info('Recording', `Stopped recording guild=${guildId}`)
    return true
  }

  getDuration(guildId: string): number {
    const rec = this.#activeRecordings.get(guildId)
    return rec ? Date.now() - rec.startTime : 0
  }

  stopAll() {
    for (const [guildId] of this.#activeRecordings) {
      this.stopRecording(guildId)
    }
  }
}