import { loadConfig } from './config/index.js'
import { Server } from './server/index.js'
import { PlayerManager } from './player/manager.js'
import { SessionManager } from './lavalink/session.js'
import { LavalinkAPI } from './lavalink/api.js'
import { LavalinkWS } from './lavalink/ws.js'
import { Resolver } from './resolving/index.js'
import { PluginManager } from './plugin/index.js'
import { Metrics } from './metrics/index.js'
import { TrackCache } from './cache/index.js'
import { AuthManager } from './middleware/auth.js'
import { corsHandler } from './middleware/cors.js'
import { dashboardHandler } from './dashboard/index.js'
import { createLogger } from './utils/logger.js'
import { logStartup, logMemory } from './utils/logging.js'
import { showBanner, formatTrackProgress } from './console/index.js'
import { VERSION } from './version.js'

const cfg = await loadConfig(process.argv[2])
const logger = createLogger(cfg.logging)

const resolver = new Resolver()
await resolver.init({
  youtube: { ...cfg.sources.youtube, proxy: cfg.proxy?.socks || cfg.sources.youtube?.proxy },
  soundcloud: cfg.sources.soundcloud,
  spotify: cfg.sources.spotify,
  bandcamp: cfg.sources.bandcamp?.enabled,
  twitch: cfg.sources.twitch?.enabled,
  vimeo: cfg.sources.vimeo?.enabled,
  deezer: cfg.sources.deezer,
  apple: cfg.sources.apple?.enabled,
  nico: cfg.sources.nico?.enabled,
  mixcloud: cfg.sources.mixcloud?.enabled,
  podcast: cfg.sources.podcast?.enabled,
  tiktok: cfg.sources.tiktok?.enabled,
  jiosaavn: cfg.sources.jiosaavn,
  http: cfg.sources.http === true || typeof cfg.sources.http === 'object',
  local: cfg.sources.local === true || typeof cfg.sources.local === 'object',
})

let cache: TrackCache | null = null
if (cfg.cache?.enabled) {
  if (cfg.cache.redis && typeof cfg.cache.redis === 'string' && cfg.cache.redis.length > 0) {
    const { RedisTrackCache } = await import('./cache/redis.js')
    cache = new RedisTrackCache(cfg.cache.redis, cfg.cache.ttl, cfg.cache.keyPrefix, logger) as unknown as TrackCache
  } else {
    cache = new TrackCache(cfg.cache.ttl, cfg.cache.maxSize)
  }
}
const pluginManager = new PluginManager({
  logger,
  pluginConfigs: cfg.plugins?.configs,
})
await pluginManager.loadFromConfig({
  paths: cfg.plugins?.paths,
  npm: cfg.plugins?.npm,
  scanDir: cfg.plugins?.scanDir,
})
const metrics = cfg.metrics?.enabled ? new Metrics(cfg.metrics) : null

const srv = new Server({
  logger,
  password: cfg.server.password,
})
const auth = new AuthManager([
  cfg.server.password,
  ...(cfg.server.tokens ?? []),
])

const sessions = new SessionManager(cfg.lavalink)
const pm = new PlayerManager({
  onTrackStart: (p, track) => {
    wsHandler.onTrackStart(p, track)
    pluginManager.emitTrackStart(p.guildId, track)
    if (metrics) metrics.tracksPlayed.inc()
  },
  onTrackEnd: (p, track, reason) => {
    wsHandler.onTrackEnd(p, track, reason)
    pluginManager.emitTrackEnd(p.guildId, track, reason)
  },
  onTrackStuck: (p, track, threshold) => {
    wsHandler.onTrackStuck(p, track, threshold)
    pluginManager.emitTrackStuck(p.guildId, track, threshold)
  },
  onTrackException: (p, track, err) => {
    wsHandler.onTrackException(p, track, err)
    pluginManager.emitTrackException(p.guildId, track, err)
  },
  onPlayerUpdate: (p, state) => {
    wsHandler.onPlayerUpdate(p, state)
    pluginManager.emitPlayerUpdate(p.guildId, state)
    if (metrics) metrics.playersActive.set(pm.count())
    if (state.track && !state.paused) {
      const progress = formatTrackProgress(state.position, state.track.info.duration)
      const mem = Math.round(process.memoryUsage().rss / 1024 / 1024)
      logger.info('player', `${progress} | players: ${pm.count()} | mem: ${mem}MB`)
    }
  },
  onQueueEnd: (p) => {
    wsHandler.onQueueEnd(p)
    pluginManager.emitQueueEnd(p.guildId)
    if (cfg.player?.autoPlay && p.queue.length > 0) {
      const next = p.queue.dequeue()
      if (next) p.play(next)
    }
  },
}, Boolean(cfg.player?.stickyQueue), cfg.player?.stickyQueueFile ?? '')

if (cfg.proxy?.socks) logger.info('proxy', `SOCKS5 proxy: ${cfg.proxy.socks}`)
const wsHandler = new LavalinkWS(pm, sessions, { queue: cfg.queue, player: cfg.player, proxy: cfg.proxy, youtube: cfg.sources?.youtube }, logger)

// Auto-leave (voice activity detection)
if (cfg.player?.autoLeaveMs && cfg.player.autoLeaveMs > 0) {
  pm.setAutoLeave(cfg.player.autoLeaveMs, (guildId) => {
    logger.info('autoleave', `guild=${guildId} disconnected due to inactivity`)
    wsHandler.cleanupGuild(guildId)
    pm.remove(guildId)
  })
}

// Public paths (no auth required)
const publicPaths = [
  cfg.server.healthPath ?? '/health',
  cfg.server.versionPath ?? '/version',
  cfg.server.dashboard ?? '/dashboard',
  '/lyrics',
  `${cfg.server.dashboard}/ws`,
]
for (const p of publicPaths) srv.noAuth(p)

// CORS
if (cfg.server.cors) {
  srv.onPreHandle(corsHandler)
}

// IP filters
const whitelist = cfg.server.ipWhitelist
const blacklist = cfg.server.ipBlacklist
if (whitelist?.length || blacklist?.length) {
  const { ipWhitelist, ipBlacklist } = await import('./middleware/ipfilter.js')
  srv.onPreHandle((req, res) => {
    if (blacklist?.length && !ipBlacklist(blacklist)(req)) {
      res.statusCode = 403
      res.end(JSON.stringify({ error: 'Forbidden' }))
      return true
    }
    if (whitelist?.length && !ipWhitelist(whitelist)(req)) {
      res.statusCode = 403
      res.end(JSON.stringify({ error: 'Forbidden' }))
      return true
    }
    return false
  })
}

// Rate limiter
const rateLimitCfg = cfg.rateLimiting?.enabled ? cfg.rateLimiting : (cfg.security?.rateLimit ? { windowMs: cfg.security.windowMs ?? 60_000, maxRequests: cfg.security.maxRequests ?? 100, perUser: false } : null)
if (rateLimitCfg) {
  const { RateLimiter } = await import('./middleware/ratelimit.js')
  const limiter = new RateLimiter(rateLimitCfg.maxRequests ?? 100, rateLimitCfg.windowMs ?? 60_000, rateLimitCfg.perUser ?? false)
  srv.onPreHandle((req, res) => {
    return !limiter.check(req, res)
  })
}

// API
const api = new LavalinkAPI(pm, resolver, sessions, cache)
api.register(srv, cfg.lavalink.apiVersion)

// Plugin routes
pluginManager.registerRoutes(srv)

// WebSocket - Lavalink v4 clients connect to root path
srv.ws('/')
srv.wss.on('connection', (ws: any, req?: any) => {
  const userId = req?.headers?.['user-id'] as string ?? ''
  wsHandler.handleConnection(ws, undefined, userId)
})

// Dashboard
if (cfg.server.dashboard) {
  srv.handle('GET', cfg.server.dashboard, dashboardHandler(() => ({
    players: pm.count(),
    playing: pm.playingCount(),
    uptime: process.uptime(),
    sessions: sessions.count(),
    memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
    sources: Object.entries(cfg.sources)
      .filter(([k, v]) => {
        if (k === 'priority' || k === 'userAgent' || k === 'requestTimeout') return false
        if (typeof v === 'object' && v !== null) return 'enabled' in v ? (v as any).enabled : false
        return !!v
      })
      .map(([k]) => k),
  })))

  const { createDashboardWS } = await import('./dashboard/ws.js')
  const dashboardWSS = srv.addWS(`${cfg.server.dashboard}/ws`, { auth: false })
  dashboardWSS.on('connection', createDashboardWS(pm))
}

// Metrics
if (metrics && cfg.metrics.path) {
  srv.handle('GET', cfg.metrics.path, async (req, res) => {
    res.setHeader('Content-Type', 'text/plain')
    res.end(await metrics.metrics)
  })
}

// Health
srv.handle('GET', '/health', (req, res) => {
  res.end(JSON.stringify({
    status: 'ok',
    uptime: process.uptime(),
    players: pm.count(),
    playing: pm.playingCount(),
    sessions: sessions.count(),
    cache: cache?.size ?? 0,
    version: VERSION,
    memory: process.memoryUsage().rss,
  }))
})

// Version
if (cfg.server.versionPath) {
  srv.handle('GET', cfg.server.versionPath, (req, res) => {
    res.end(JSON.stringify({
      name: 'sonata',
      version: VERSION,
      lavalink: cfg.lavalink.apiVersion,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    }))
  })
}

// Graceful shutdown
const shutdownDelay = cfg.shutdownDelay ?? 10_000
async function shutdown() {
  logger.info('system', 'Shutting down...')
  pm.reset()
  await new Promise(r => setTimeout(r, 100))
  srv.close().then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Memory usage log every 5 minutes
if (process.env['NODE_ENV'] !== 'test') {
  setInterval(() => logMemory(logger), 300_000)
}

// Start
srv.listen(cfg.server.port, cfg.server.host, () => {
  showBanner(cfg)
  logStartup(cfg, pluginManager.all.length, logger)
})
