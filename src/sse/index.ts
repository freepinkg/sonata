import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Logger } from '../utils/logger.js'

export interface SSEConfig {
  enabled: boolean
  path?: string
  maxClients?: number
  heartbeatInterval?: number
  allowedEvents?: string[]
}

export class SSEManager {
  #cfg: SSEConfig
  #logger: Logger | null = null
  #clients = new Set<ServerResponse>()
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(cfg: SSEConfig) {
    this.#cfg = cfg
  }

  setLogger(logger: Logger) { this.#logger = logger }

  start() {
    if (!this.#cfg.enabled) return
    const interval = this.#cfg.heartbeatInterval ?? 30_000
    this.#heartbeatTimer = setInterval(() => {
      for (const res of this.#clients) {
        try { res.write(': heartbeat\n\n') } catch { this.#clients.delete(res) }
      }
    }, interval)
  }

  handleConnection(req: IncomingMessage, res: ServerResponse) {
    if (!this.#cfg.enabled) {
      res.statusCode = 404
      res.end()
      return
    }
    if (this.#cfg.maxClients && this.#clients.size >= this.#cfg.maxClients) {
      res.statusCode = 503
      res.end('Too many clients')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')
    this.#clients.add(res)
    req.on('close', () => { this.#clients.delete(res) })
  }

  send(event: string, data: any) {
    if (!this.#cfg.enabled) return
    if (this.#cfg.allowedEvents?.length && !this.#cfg.allowedEvents.includes(event)) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of this.#clients) {
      try { res.write(payload) } catch { this.#clients.delete(res) }
    }
  }

  stop() {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer)
    for (const res of this.#clients) {
      try { res.end() } catch {}
    }
    this.#clients.clear()
  }
}