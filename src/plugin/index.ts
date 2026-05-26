import { createRequire } from 'node:module'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Logger } from '../utils/logger.js'
import type { Server } from '../server/index.js'
import type {
  Plugin, PluginContext,
  Track, PlayerState,
  TrackStartHandler, TrackEndHandler, TrackStuckHandler, TrackExceptionHandler,
  QueueEndHandler, PlayerUpdateHandler, QueueEventHandler, QueueEventType,
  RouteHandler, LogLevel, HttpMethod
} from '../types/index.js'

const require = createRequire(import.meta.url)

type LogMethod = 'trace' | 'verbose' | 'debug' | 'info' | 'warn' | 'error'
const LEVEL_MAP: Record<string, LogMethod> = {
  trace: 'trace',
  verbose: 'verbose',
  debug: 'debug',
  normal: 'info',
  warn: 'warn',
  error: 'error',
}

export class PluginManager {
  #plugins: Plugin[] = []
  #trackStartHandlers: TrackStartHandler[] = []
  #trackEndHandlers: TrackEndHandler[] = []
  #trackStuckHandlers: TrackStuckHandler[] = []
  #trackExceptionHandlers: TrackExceptionHandler[] = []
  #queueEndHandlers: QueueEndHandler[] = []
  #playerUpdateHandlers: PlayerUpdateHandler[] = []
  #queueEventHandlers: Map<QueueEventType, QueueEventHandler[]> = new Map()
  #routeHandlers: { method: HttpMethod; path: string; handler: RouteHandler }[] = []
  #logger: Logger
  #pluginConfigs: Record<string, Record<string, unknown>>

  constructor(opts: {
    logger: Logger
    pluginConfigs?: Record<string, Record<string, unknown>>
  }) {
    this.#logger = opts.logger
    this.#pluginConfigs = opts.pluginConfigs ?? {}
  }

  registerRoutes(srv: Server) {
    for (const { method, path, handler } of this.#routeHandlers) {
      srv.handle(method, path, handler)
    }
  }

  async loadFromConfig(config: {
    paths?: string[]
    npm?: string[]
    scanDir?: string
  }) {
    const seen = new Set<string>()

    for (const pkg of config.npm ?? []) {
      if (seen.has(pkg)) continue
      seen.add(pkg)
      try {
        const mod = require(pkg)
        const plugin = mod.default ?? mod
        this.register(plugin, { source: pkg })
      } catch (err) {
        this.#logger.error('plugins', `Failed to load npm plugin "${pkg}": ${(err as Error).message}`)
      }
    }

    for (const filePath of config.paths ?? []) {
      if (seen.has(filePath)) continue
      seen.add(filePath)
      try {
        const abs = resolve(filePath)
        const url = pathToFileURL(abs).href
        const mod = await import(url)
        const plugin = mod.default ?? mod
        this.register(plugin, { source: filePath })
      } catch (err) {
        this.#logger.error('plugins', `Failed to load plugin "${filePath}": ${(err as Error).message}`)
      }
    }

    if (config.scanDir) {
      const dir = resolve(config.scanDir)
      if (existsSync(dir)) {
        const entries = readdirSync(dir)
        for (const entry of entries) {
          const ext = extname(entry)
          if (ext !== '.js' && ext !== '.mjs') continue
          const abs = resolve(dir, entry)
          if (!statSync(abs).isFile()) continue
          if (seen.has(abs)) continue
          seen.add(abs)
          try {
            const url = pathToFileURL(abs).href
            const mod = await import(url)
            const plugin = mod.default ?? mod
            this.register(plugin, { source: abs })
          } catch (err) {
            this.#logger.error('plugins', `Failed to load plugin "${abs}": ${(err as Error).message}`)
          }
        }
      }
    }

    this.#logger.info('Plugins', `Loaded ${this.#plugins.length} plugin(s)`)
  }

  register(plugin: Plugin, meta?: { source?: string }) {
    const pluginCfg = { ...(this.#pluginConfigs[plugin.name] ?? {}) }

    const ctx: PluginContext = {
      config: pluginCfg,

      onTrackStart: (handler) => {
        this.#trackStartHandlers.push(handler)
      },

      onTrackEnd: (handler) => {
        this.#trackEndHandlers.push(handler)
      },

      onTrackStuck: (handler) => {
        this.#trackStuckHandlers.push(handler)
      },

      onTrackException: (handler) => {
        this.#trackExceptionHandlers.push(handler)
      },

      onQueueEnd: (handler) => {
        this.#queueEndHandlers.push(handler)
      },

      onPlayerUpdate: (handler) => {
        this.#playerUpdateHandlers.push(handler)
      },

      onQueueEvent: (type, handler) => {
        const handlers = this.#queueEventHandlers.get(type) ?? []
        handlers.push(handler)
        this.#queueEventHandlers.set(type, handlers)
      },

      registerRoute: (method, path, handler) => {
        this.#routeHandlers.push({ method, path, handler })
      },

      log: (level, message, ...args) => {
        const method = LEVEL_MAP[level] ?? 'info'
        this.#logger[method](`plugin:${plugin.name}`, message, ...args)
      },
    }

    const result = plugin.install(ctx)
    if (result instanceof Promise) {
      result.catch(err => {
        this.#logger.error('plugins', `Plugin "${plugin.name}" install() failed: ${(err as Error).message}`)
      })
    }

    this.#plugins.push(plugin)
    this.#logger.info('plugins', `Registered plugin "${plugin.name}" v${plugin.version}${meta?.source ? ` (${meta.source})` : ''}`)
  }

  get all() { return [...this.#plugins] }

  emitTrackStart(guildId: string, track: Track) {
    for (const h of this.#trackStartHandlers) h(guildId, track)
  }

  emitTrackEnd(guildId: string, track: Track, reason: string) {
    for (const h of this.#trackEndHandlers) h(guildId, track, reason)
  }

  emitTrackStuck(guildId: string, track: Track, thresholdMs: number) {
    for (const h of this.#trackStuckHandlers) h(guildId, track, thresholdMs)
  }

  emitTrackException(guildId: string, track: Track, error: Error | string) {
    const msg = typeof error === 'string' ? error : error.message
    for (const h of this.#trackExceptionHandlers) h(guildId, track, msg)
  }

  emitQueueEnd(guildId: string) {
    for (const h of this.#queueEndHandlers) h(guildId)
  }

  emitPlayerUpdate(guildId: string, state: PlayerState) {
    for (const h of this.#playerUpdateHandlers) h(guildId, state)
  }

  emitQueueEvent(guildId: string, type: QueueEventType, detail: unknown) {
    const handlers = this.#queueEventHandlers.get(type)
    if (handlers) {
      for (const h of handlers) h(guildId, detail)
    }
  }
}
