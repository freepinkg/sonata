import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { Config } from '../types/index.js'

const DEFAULTS: Config = {
  server: {
    host: '0.0.0.0',
    port: 2333,
    password: 'youshallnotpass',
    tokens: [],
    ipWhitelist: [],
    ipBlacklist: [],
    cors: true,
    dashboard: '/dashboard',
    versionPath: '/version',
    healthPath: '/health',
    maxBodySize: 1_048_576,
    socketTimeout: 30_000,
    keepAliveTimeout: 5_000,
    maxHeaderSize: 16_384,
    compression: false,
    http2: false,
    trustProxy: false,
    trustedIps: [],
    customHeaders: {},
  },
  logging: {
    level: 'trace',
    format: 'text',
    colorize: true,
    excludePaths: ['/health', '/metrics', '/dashboard', '/version'],
    file: { enabled: false, path: 'logs/sonata.log', maxSize: 10_485_760, maxFiles: 5, compress: false },
    moduleLevels: {},
    timestampFormat: 'iso',
    showPid: true,
  },
  sources: {
    youtube: { enabled: true, clientProfiles: ['WEB', 'MUSIC', 'ANDROID', 'IOS', 'TV'], apiKey: '', clientName: '', timeout: 10_000, maxResults: 20, fetchPlayerJS: false, playerUrl: 'https://www.youtube.com/s/player/c2f7551f/player_embed.vflset/en_US/base.js', oauth: { getOAuthToken: false }, cipher: { url: '', token: '' }, poToken: { service: '', token: '' }, clients: { settings: {} } },
    soundcloud: { enabled: true, clientId: '', apiUrl: 'https://api.soundcloud.com', resolveRedirects: true, timeout: 10_000 },
    spotify: { enabled: false, clientId: '', clientSecret: '', market: 'US', country: 'US', maxPlaylistTracks: 200, resolverFlavor: 'auto', retryCount: 2 },
    bandcamp: { enabled: true, quality: 'high', timeout: 10_000 },
    twitch: { enabled: true, quality: 'source', timeout: 10_000 },
    vimeo: { enabled: true, quality: 'best', timeout: 10_000 },
    deezer: { enabled: true, quality: 'MP3_320', timeout: 10_000 },
    apple: { enabled: true, quality: 'high', storefront: 'us', timeout: 10_000 },
    nico: { enabled: true, quality: 'best', timeout: 10_000 },
    mixcloud: { enabled: true, quality: 'best', timeout: 10_000 },
    podcast: { enabled: true, maxEpisodes: 50, timeout: 10_000 },
    jiosaavn: { enabled: true, quality: 'high', timeout: 10_000, decryptionKey: '' },
    http: true,
    local: true,
    priority: ['youtube', 'soundcloud', 'spotify', 'bandcamp', 'twitch', 'vimeo', 'deezer', 'apple', 'nico', 'mixcloud', 'podcast', 'jiosaavn', 'http', 'local'],
    requestTimeout: 10_000,
  },
  lavalink: {
    apiVersion: 4,
    resumeTimeout: 60,
    resumeKey: '',
    sessionTimeout: 300,
    pluginDir: '',
    maxTrackLength: 0,
    strictValidation: true,
  },
  voice: {
    udpMode: 'ipv4',
    externalAddress: '',
    portRange: [0, 0],
    bufferSize: 4096,
    forceIpDiscovery: false,
    encryptionFallback: ['xsalsa20_poly1305', 'aes256_gcm'],
    silenceFrames: 5,
    keepaliveInterval: 30_000,
    maxReconnectAttempts: 5,
    reconnectDelay: 1_000,
  },
  queue: {
    maxHistorySize: 100,
    defaultVolume: 100,
    maxSize: 0,
    crossfade: 0,
    crossfadeFadeIn: 0,
    crossfadeFadeOut: 0,
    shuffle: false,
    emptyRepeatMode: 'none',
    perSourceLimits: {},
  },
  player: {
    autoPlay: true,
    replaygain: false,
    eventHistory: 50,
    emptyQueueBehavior: 'stop',
    autoLeaveMs: 300_000,
    skipOnError: true,
    maxErrorSkips: 3,
    maxTrackDuration: 0,
    minTrackDuration: 0,
    idleTimeout: 300_000,
    crossfadeOffset: 0,
    allowStreamSeek: false,
    maxSeekPosition: 0,
    stickyQueue: false,
    stickyQueueFile: '',
    normalization: false,
    normalizationTarget: -14,
  },
  cache: {
    enabled: true,
    ttl: 300_000,
    maxSize: 500,
    redis: '',
    searchTtl: 60_000,
    playlistTtl: 300_000,
    negativeTtl: 10_000,
    keyPrefix: 'sonata:',
    memoryOnly: false,
  },
  metrics: {
    enabled: true,
    path: '/metrics',
    prefix: 'sonata',
    histogramBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    labels: {},
    excludeRoutes: [],
  },
  rateLimiting: {
    enabled: false,
    windowMs: 60_000,
    maxRequests: 100,
    perRoute: {},
    statusCode: 429,
    message: 'Too many requests, please try again later.',
    sendHeaders: true,
    trustProxy: false,
  },
  security: {
    rateLimit: false,
    maxRequests: 100,
    windowMs: 60_000,
    blockMethods: [],
    blockPaths: [],
    maxBodyDepth: 10,
    enforceContentType: false,
    hstsMaxAge: 0,
    requireUserAgent: false,
    blockSqlInjection: false,
    blockXss: false,
  },
  plugins: {
    paths: [],
    configs: {},
    npm: [],
    scanDir: '',
  },
  clustering: {
    enabled: false,
    nodes: [],
    nodeId: '',
    heartbeatInterval: 10_000,
    heartbeatTimeout: 30_000,
    electionStrategy: 'manual',
  },
  shutdownDelay: 10_000,
  proxy: {
    socks: '',
    http: '',
  },
  dashboard: {
    title: 'Sonata',
    theme: 'dark',
    refreshInterval: 5_000,
    showTrackHistory: true,
    showPlayerControls: true,
    brandColor: '#5865F2',
    footerText: 'Sonata Audio Server',
  },
  resolving: {
    strict: false,
    maxUriLength: 2048,
    defaultSearch: 'youtube',
    searchAliases: { yt: 'youtube', sc: 'soundcloud', sp: 'spotify', bc: 'bandcamp', tw: 'twitch', vm: 'vimeo' },
    retryCount: 2,
    retryDelay: 1_000,
    fallbacks: ['youtube', 'soundcloud'],
  },
}

export async function loadConfig(path?: string): Promise<Config> {
  const cfg = structuredClone(DEFAULTS) as Config
  const configPath = path ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../config.js')
  if (existsSync(configPath)) {
    const url = pathToFileURL(configPath).href
    const mod = await import(url)
    const userConfig = mod.default ?? mod
    deepMerge(cfg, userConfig)
  }
  return cfg
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(target: any, source: any) {
  for (const key of Object.keys(source)) {
    if (source[key] === undefined) continue
    if (isObject(source[key]) && isObject(target[key])) {
      deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
}
