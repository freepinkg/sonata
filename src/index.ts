import { loadConfig } from './config/index.js'
import { Server } from './server/index.js'
import { PlayerManager } from './player/manager.js'
import { SessionManager } from './lavalink/session.js'
import { LavalinkAPI } from './lavalink/api.js'
import { LavalinkWS } from './lavalink/ws.js'
import { Resolver } from './resolving/index.js'
import { pluginManager } from './plugin/index.js'
import { Metrics } from './metrics/index.js'
import { TrackCache } from './cache/index.js'
import { AuthManager } from './middleware/auth.js'
import { corsHandler } from './middleware/cors.js'
import { dashboardHandler } from './dashboard/index.js'
import { logStartup, logMemory } from './utils/logging.js'
import { VERSION } from './version.js'

const cfg = await loadConfig(process.argv[2])

const resolver = new Resolver({
  youtube: cfg.sources.youtube,
  soundcloud: cfg.sources.soundcloud,
  spotify: cfg.sources.spotify,
  bandcamp: cfg.sources.bandcamp?.enabled,
  twitch: cfg.sources.twitch?.enabled,
  vimeo: cfg.sources.vimeo?.enabled,
  deezer: cfg.sources.deezer?.enabled,
  apple: cfg.sources.apple?.enabled,
  nico: cfg.sources.nico?.enabled,
  mixcloud: cfg.sources.mixcloud?.enabled,
  podcast: cfg.sources.podcast?.enabled,
  http: cfg.sources.http === true || typeof cfg.sources.http === 'object',
  local: cfg.sources.local === true || typeof cfg.sources.local === 'object',
})

const cache = cfg.cache?.enabled ? new TrackCache(cfg.cache.ttl, cfg.cache.maxSize) : null
const metrics = cfg.metrics?.enabled ? new Metrics(cfg.metrics) : null
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
  onTrackStuck: (p, track, threshold) => wsHandler.onTrackStuck(p, track, threshold),
  onTrackException: (p, track, err) => wsHandler.onTrackException(p, track, err),
  onPlayerUpdate: (p, state) => {
    wsHandler.onPlayerUpdate(p, state)
    if (metrics) metrics.playersActive.set(pm.count())
  },
  onQueueEnd: (p) => {
    wsHandler.onQueueEnd(p)
    if (cfg.player?.autoPlay && p.queue.length > 0) {
      const next = p.queue.dequeue()
      if (next) p.play(next)
    }
  },
})

const wsHandler = new LavalinkWS(pm, sessions)

const srv = new Server({
  level: cfg.logging.level,
  format: cfg.logging.format,
  password: cfg.server.password,
})

// Public paths (no auth required)
const publicPaths = [
  cfg.server.healthPath ?? '/health',
  cfg.server.versionPath ?? '/version',
  cfg.server.dashboard ?? '/dashboard',
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
if (cfg.security?.rateLimit) {
  const { RateLimiter } = await import('./middleware/ratelimit.js')
  const limiter = new RateLimiter(cfg.security.windowMs ?? 60_000, cfg.security.maxRequests ?? 100)
  srv.onPreHandle((req, res) => {
    return !limiter.check(req, res)
  })
}

// API
const api = new LavalinkAPI(pm, resolver, sessions, cache)
api.register(srv, cfg.lavalink.apiVersion)

// WebSocket
srv.ws('/ws')
srv.wss.on('connection', (ws) => wsHandler.handleConnection(ws))

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
  console.log('\nShutting down...')
  pm.reset()
  await new Promise(r => setTimeout(r, 100))
  srv.close().then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Memory usage log every 5 minutes
if (process.env['NODE_ENV'] !== 'test') {
  setInterval(logMemory, 300_000)
}

// Start
srv.listen(cfg.server.port, cfg.server.host, () => {
  logStartup(cfg)
})
