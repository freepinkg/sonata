import type { Logger } from '../utils/logger.js'
import { createSocket } from 'node:dgram'

export interface DatadogConfig {
  enabled: boolean
  agentHost?: string
  agentPort?: number
  prefix?: string
  tags?: Record<string, string>
}

export class DatadogStatsD {
  #cfg: DatadogConfig
  #logger: Logger | null = null
  #socket: ReturnType<typeof createSocket> | null = null
  #timer: ReturnType<typeof setInterval> | null = null

  constructor(cfg: DatadogConfig) {
    this.#cfg = cfg
  }

  setLogger(logger: Logger) { this.#logger = logger }

  start() {
    if (!this.#cfg.enabled) return
    this.#socket = createSocket('udp4')
  }

  gauge(name: string, value: number, tags?: Record<string, string>) {
    this.#send(`${this.#cfg.prefix ?? 'sonata.'}${name}:${value}|g${this.#tagString(tags)}`)
  }

  increment(name: string, tags?: Record<string, string>) {
    this.#send(`${this.#cfg.prefix ?? 'sonata.'}${name}:1|c${this.#tagString(tags)}`)
  }

  #send(msg: string) {
    if (!this.#socket) return
    const buf = Buffer.from(msg)
    this.#socket.send(buf, 0, buf.length, this.#cfg.agentPort ?? 8125, this.#cfg.agentHost ?? 'localhost')
  }

  #tagString(tags?: Record<string, string>): string {
    const all = { ...(this.#cfg.tags ?? {}), ...(tags ?? {}) }
    const entries = Object.entries(all)
    if (entries.length === 0) return ''
    return '|#' + entries.map(([k, v]) => `${k}:${v}`).join(',')
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer)
    if (this.#socket) this.#socket.close()
  }
}