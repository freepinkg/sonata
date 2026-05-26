import { loadConfig } from '#config/index'
import { Server } from '#server/index'
import { PlayerManager } from '#player/manager'
import { SessionManager } from '#lavalink/session'
import { LavalinkAPI } from '#lavalink/api'
import { LavalinkWS } from '#lavalink/ws'
import { Resolver } from '#resolving/index'
import { PluginManager } from '#plugin/index'
import { Metrics } from '#metrics/index'
import { TrackCache } from '#cache/index'
import { AuthManager } from '#middleware/auth'
import { corsHandler } from '#middleware/cors'
import { dashboardHandler } from '#dashboard/index'
import { createLogger } from '#utils/logger'
import { logBanner, logMemory } from '#utils/logging'
import { showBanner, formatTrackProgress } from '#console/index'
import { VERSION } from '#version'
import { ClusterManager } from '#cluster/index'
import { WebhookManager } from '#webhooks/index'
import { MaintenanceMode } from '#maintenance/index'
import { AuditLogger } from '#audit/index'
import { RadioMode } from '#radio/index'
import { DatabaseManager } from '#database/index'
import { RecordingManager } from '#recording/index'
import { SSEManager } from '#sse/index'
import { initSentry } from '#tracing/sentry'
import { DatadogStatsD } from '#tracing/datadog'
import { initOpenTelemetry } from '#tracing/opentelemetry'

const cfg = await loadConfig(process.argv[2])
const logger = createLogger(cfg.logging)

showBanner(cfg)
logBanner(cfg, logger)

const resolver = new Resolver()
resolver.setLogger(logger)
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
}, cfg.resolving)

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

// Clustering
const clusterManager = cfg.clustering?.enabled && cfg.clustering?.nodes?.length
  ? new ClusterManager({
    nodeId: cfg.clustering.nodeId || `sonata-${process.pid}`,
    host: cfg.server.host,
    port: cfg.server.port + 1,
    strategy: cfg.clustering.electionStrategy,
    heartbeatInterval: cfg.clustering.heartbeatInterval,
    heartbeatTimeout: cfg.clustering.heartbeatTimeout,
    logger,
  })
  : null
if (clusterManager) {
  for (const n of cfg.clustering?.nodes ?? []) {
    clusterManager.register({ id: `${n.host}:${n.port}`, host: n.host, port: n.port, load: 0, players: 0, lastSeen: Date.now() })
  }
  clusterManager.startSync(() => pm.count())
  clusterManager.listen(cfg.server.port + 1, '127.0.0.1')
}

// Webhooks
const webhooks = cfg.webhooks?.length ? new WebhookManager(cfg.webhooks, logger) : null

// Discord Gateway (auto-connect mode)
const discordCfg = cfg.discord
if (discordCfg?.enabled && discordCfg?.token) {
  import('#discord/gateway').then(({ DiscordGateway }) => {
    const dg = new DiscordGateway(discordCfg.token, discordCfg.intents ?? 0)
    dg.connect()
    logger.info('Discord', `Gateway connected (intents: ${discordCfg.intents ?? 0})`)
  }).catch((err: any) => logger.warn('Discord', `Gateway init failed: ${err.message}`))
}

// Database
if (cfg.database?.enabled) {
  const db = new DatabaseManager(cfg.database)
  db.setLogger(logger)
  await db.connect()
}

// Recording
if (cfg.recording?.enabled) {
  const recording = new RecordingManager(cfg.recording)
  recording.setLogger(logger)
}

// Sentry
await initSentry(cfg.sentry ?? { enabled: false }, logger)

// Datadog
let datadog: DatadogStatsD | null = null
if (cfg.datadog?.enabled) {
  datadog = new DatadogStatsD(cfg.datadog)
  datadog.setLogger(logger)
  datadog.start()
  logger.info('Datadog', `StatsD agent: ${cfg.datadog.agentHost}:${cfg.datadog.agentPort}`)
}

// OpenTelemetry
if (cfg.opentelemetry?.enabled && cfg.opentelemetry?.endpoint) {
  await initOpenTelemetry(cfg.opentelemetry, logger)
}

// SSE
const sse = new SSEManager(cfg.sse ?? { enabled: false })
sse.setLogger(logger)
sse.start()

const audit = new AuditLogger(cfg.logging?.audit ?? { enabled: false })
const maintenance = new MaintenanceMode(cfg.maintenance ?? { enabled: false }, [cfg.server.password, ...(cfg.server.tokens ?? [])], ['/maintenance/enable', '/maintenance/disable'])

const srv = new Server({
  logger,
  password: cfg.server.password,
  ssl: cfg.server.ssl ? { cert: cfg.server.ssl.cert, key: cfg.server.ssl.key, ca: cfg.server.ssl.ca, passphrase: cfg.server.ssl.passphrase, secureOptions: cfg.server.ssl.secureOptions } : undefined,
  compression: cfg.server.compression,
  http2: cfg.server.http2,
  security: cfg.security,
  customHeaders: cfg.server.customHeaders,
  correlationId: cfg.logging?.correlationId,
  maxBodySize: cfg.server.maxBodySize,
  socketTimeout: cfg.server.socketTimeout,
  keepAliveTimeout: cfg.server.keepAliveTimeout,
  trustProxy: cfg.server.trustProxy,
  trustedIps: cfg.server.trustedIps,
})
const auth = new AuthManager([
  cfg.server.password,
  ...(cfg.server.tokens ?? []),
])

const sessions = new SessionManager(cfg.lavalink, logger)
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
    sse.send('playerUpdate', { guildId: p.guildId, state })
    if (state.track && !state.paused) {
      const progress = formatTrackProgress(state.position, state.track.info.duration)
      const mem = Math.round(process.memoryUsage().rss / 1024 / 1024)
      logger.info('Player', `${progress} | players: ${pm.count()} | mem: ${mem}MB`)
    }
  },
  onQueueEnd: (p) => {
    wsHandler.onQueueEnd(p)
    pluginManager.emitQueueEnd(p.guildId)

    // Smart queue: auto-fill from history
    const smartQ = cfg.queue?.smartQueue
    if (smartQ?.enabled && p.queue.length < (smartQ.minTracksToTrigger ?? 5)) {
      const radio = new RadioMode(resolver, { enabled: true, source: 'youtube', basedOn: 'history' }, logger)
      radio.generateTrack(p.queue.history).then(track => {
        if (track && p.queue.enqueue(track) === null) {
          audit.log('smartQueue.fill', { guildId: p.guildId, track: track.info.title })
        }
      })
    }

    if (cfg.player?.autoPlay && p.queue.length > 0) {
      const next = p.queue.dequeue()
      if (next) p.play(next)
    } else if (cfg.queue?.radioMode?.enabled) {
      const radio = new RadioMode(resolver, cfg.queue.radioMode, logger)
      radio.generateTrack(p.queue.history).then(track => {
        if (track) {
          p.play(track)
          audit.log('radio.next', { guildId: p.guildId, track: track.info.title })
        }
      })
    }
  },
}, Boolean(cfg.player?.stickyQueue), cfg.player?.stickyQueueFile ?? '', cfg.queue?.filters, cfg.queue)

// Snapshot config
const snapCfg = cfg.player?.snapshot
if (snapCfg?.enabled) {
  pm.setSnapshotConfig({
    enabled: snapCfg.enabled,
    dir: snapCfg.dir ?? 'data/snapshots',
    autoSave: snapCfg.autoSave ?? true,
    saveIntervalMs: snapCfg.saveIntervalMs ?? 60_000,
    maxSnapshots: snapCfg.maxSnapshots ?? 10,
  })
}

// proxy is logged in logBanner now
const wsHandler = new LavalinkWS(pm, sessions, { queue: cfg.queue, player: { ...cfg.player, ducking: cfg.player?.ducking, gapless: cfg.player?.gapless, fade: cfg.player?.fade, autoVolume: cfg.player?.autoVolume, introOutro: cfg.player?.introOutro, snapshot: cfg.player?.snapshot }, voice: cfg.voice, ws: cfg.ws, proxy: cfg.proxy, youtube: cfg.sources?.youtube }, logger)

// Auto-leave (voice activity detection)
if (cfg.player?.autoLeaveMs && cfg.player.autoLeaveMs > 0) {
  pm.setAutoLeave(cfg.player.autoLeaveMs, (guildId) => {
    logger.info('AutoLeave', `Guild ${guildId} disconnected due to inactivity`)
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

// Maintenance mode
srv.onPreHandle((req, res) => maintenance.handler(req, res))
srv.handle('POST', '/maintenance/enable', (req, res, params, body) => {
  maintenance.enable(body?.message)
  audit.log('maintenance.enable', { message: body?.message })
  res.end(JSON.stringify({ status: 'maintenance enabled' }))
})
srv.handle('POST', '/maintenance/disable', (req, res) => {
  maintenance.disable()
  audit.log('maintenance.disable', {})
  res.end(JSON.stringify({ status: 'maintenance disabled' }))
})

// Swagger docs
const swaggerDocs = cfg.docs?.swagger
if (swaggerDocs?.enabled) {
  srv.handle('GET', swaggerDocs.path ?? '/api-docs', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      openapi: '3.0.0',
      info: { title: swaggerDocs.title ?? 'Sonata API', version: swaggerDocs.version ?? '4.0.0' },
      paths: {
        '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
        '/version': { get: { summary: 'Version info', responses: { '200': { description: 'OK' } } } },
        '/v4/stats': { get: { summary: 'Server stats', responses: { '200': { description: 'OK' } } } },
        '/v4/sessions': { post: { summary: 'Create session', responses: { '201': { description: 'Created' } } } },
        '/v4/loadtracks': { get: { summary: 'Load tracks', parameters: [{ name: 'identifier', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } } },
      },
    }))
  })
}

// Rate limiter
const rateLimitCfg = cfg.rateLimiting?.enabled ? cfg.rateLimiting : (cfg.security?.rateLimit ? { windowMs: cfg.security.windowMs ?? 60_000, maxRequests: cfg.security.maxRequests ?? 100, perUser: false } : null)
if (rateLimitCfg) {
  const { RateLimiter } = await import('./middleware/ratelimit.js')
  const limiter = new RateLimiter(rateLimitCfg.maxRequests ?? 100, rateLimitCfg.windowMs ?? 60_000, rateLimitCfg.perUser ?? false, rateLimitCfg.perRoute ?? {}, rateLimitCfg.sendHeaders ?? true)
  srv.onPreHandle((req, res) => {
    return !limiter.check(req, res)
  })
}

// API
const api = new LavalinkAPI(pm, resolver, sessions, cache, logger)
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
  }), cfg.dashboard))

  const { createDashboardWS } = await import('./dashboard/ws.js')
  const dashboardWSS = srv.addWS(`${cfg.server.dashboard}/ws`, { auth: false })
  dashboardWSS.on('connection', createDashboardWS(pm))
}

// SSE
if (cfg.sse?.enabled) {
  const ssePath = cfg.sse.path ?? '/events'
  srv.handle('GET', ssePath, (req, res) => {
    sse.handleConnection(req, res)
  })
  srv.noAuth(ssePath)
}

// Health checks
if (cfg.healthChecks?.enabled) {
  const hcInterval = cfg.healthChecks.intervalMs ?? 30_000
  setInterval(async () => {
    const results: Record<string, string> = {}
    for (const check of cfg.healthChecks?.checks ?? []) {
      if (check === 'sentry') results.sentry = cfg.sentry?.enabled && !!cfg.sentry?.dsn ? 'ok' : 'disabled'
      else if (check === 'sources') {
        const sourceCount = Object.entries(cfg.sources).filter(([k, v]) => {
          if (k === 'priority' || k === 'userAgent' || k === 'requestTimeout') return false
          return typeof v === 'object' ? (v as any).enabled : !!v
        }).length
        results.sources = `${sourceCount} sources`
      } else if (check === 'database') results.database = cfg.database?.enabled ? 'ok' : 'disabled'
      else if (check === 'memory') results.memory = `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`
      else results[check] = 'unknown'
    }
    logger.debug('HealthChecks', JSON.stringify(results))
  }, hcInterval)
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
  logger.info('System', 'Shutting down...')
  pm.reset()
  sse?.stop()
  datadog?.stop()
  await new Promise(r => setTimeout(r, 100))
  srv.close().then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Config hot-reload (SIGHUP)
process.on('SIGHUP', async () => {
  try {
    logger.info('System', 'Reloading config...')
    const newCfg = await loadConfig(process.argv[2])
    Object.assign(cfg, newCfg)
    logger.info('System', 'Config reloaded successfully')
  } catch (err: any) {
    logger.error('System', `Config reload failed: ${err.message}`)
  }
})

// Memory usage log every 5 minutes
if (process.env['NODE_ENV'] !== 'test') {
  setInterval(() => logMemory(logger), 300_000)
}

// Start
srv.listen(cfg.server.port, cfg.server.host, () => {})
