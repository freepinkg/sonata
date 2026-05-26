export default {
  // ── Server ──────────────────────────────────────────────────────────
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
    customHeaders: { 'X-Powered-By': 'Sonata' },
  },

  // ── Logging ─────────────────────────────────────────────────────────
  logging: {
    level: 'trace',         // trace | verbose | debug | normal | warn | error
    format: 'text',         // text | json
    colorize: true,
    showPid: true,
    timestampFormat: 'iso', // iso | epoch | relative | none
    excludePaths: ['/health', '/metrics', '/dashboard', '/version'],
    moduleLevels: {},
    file: {
      enabled: false,
      path: 'logs/sonata.log',
      maxSize: 10_485_760,  // 10MB
      maxFiles: 5,
      compress: false,
    },
  },

  // ── Sources ─────────────────────────────────────────────────────────
  sources: {
    youtube: {
      enabled: true,
      clientProfiles: ['WEB', 'MUSIC', 'ANDROID', 'IOS', 'TV'],
      timeout: 10_000,
      maxResults: 20,
      fetchPlayerJS: false,
      // --
      // OAuth (device code flow) for TVHTML5 client.
      // Set getOAuthToken to true, start the server, visit the URL, enter the code,
      // then paste the refresh token below and set getOAuthToken back to false.
      // WARNING: Do NOT use your main Google account. Use a secondary/burner account!
      oauth: {
        getOAuthToken: false,
        refreshToken: '',
      },
      // --
      // Remote cipher service for resolving YouTube playback URLs.
      // Resolves the 'n' parameter and signature timestamps.
      cipher: {
        url: '',
        token: '',
      },
      // Proof-of-origin token service (optional).
      poToken: {
        service: '',
        token: '',
      },
      // Per-client settings (e.g. TV refresh tokens).
      clients: {
        settings: {
          TV: {
            refreshToken: [],
          },
        },
      },
      // Explicit player script URL for cipher/STS resolution.
      playerUrl: 'https://www.youtube.com/s/player/c2f7551f/player_embed.vflset/en_US/base.js',
    },
    soundcloud: {
      enabled: true,
      clientId: '',
      apiUrl: 'https://api.soundcloud.com',
      resolveRedirects: true,
      timeout: 10_000,
    },
    spotify: {
      enabled: false,
      clientId: '',
      clientSecret: '',
      market: 'US',
      country: 'US',
      maxPlaylistTracks: 200,
      resolverFlavor: 'auto',  // auto | mirror | direct
      retryCount: 2,
    },
    bandcamp:  { enabled: true, quality: 'high',  timeout: 10_000 },
    twitch:    { enabled: true, quality: 'source', timeout: 10_000 },
    vimeo:     { enabled: true, quality: 'best',   timeout: 10_000 },
    deezer:    { enabled: true, quality: 'MP3_320', timeout: 10_000, arl: '', proxy: '' },
    apple:     { enabled: true, quality: 'high',    timeout: 10_000, storefront: 'us' },
    nico:      { enabled: true, quality: 'best',    timeout: 10_000 },
    mixcloud:  { enabled: true, quality: 'best',    timeout: 10_000 },
    podcast:   { enabled: true, maxEpisodes: 50,    timeout: 10_000 },
    tiktok:    { enabled: false, quality: 'best', timeout: 10_000 },
    http:      true,
    local:     true,

    // Source priority ordering (first match wins)
    priority: ['youtube', 'soundcloud', 'spotify', 'bandcamp', 'twitch',
               'vimeo', 'deezer', 'apple', 'nico', 'mixcloud', 'podcast', 'tiktok', 'http', 'local'],
    requestTimeout: 10_000,
  },

  // ── Lavalink ────────────────────────────────────────────────────────
  lavalink: {
    apiVersion: 4,
    resumeTimeout: 60,
    resumeKey: '',
    sessionTimeout: 300,
    pluginDir: '',
    maxTrackLength: 0,        // 0 = unlimited
    strictValidation: true,
  },

  // ── Voice ───────────────────────────────────────────────────────────
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

  // ── Queue ───────────────────────────────────────────────────────────
  queue: {
    maxHistorySize: 100,
    defaultVolume: 100,
    maxSize: 0,               // 0 = unlimited
    crossfade: 0,             // 0 = disabled
    crossfadeFadeIn: 0,
    crossfadeFadeOut: 0,
    shuffle: false,
    emptyRepeatMode: 'none',  // none | track | queue
    perSourceLimits: {},
  },

  // ── Player ──────────────────────────────────────────────────────────
  player: {
    autoPlay: true,
    replaygain: false,
    eventHistory: 50,
    emptyQueueBehavior: 'stop',  // stop | pause | await
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
    // Default filters applied to every player (optional).
    // Lavalink-compatible — all fields can be overridden per-player via API.
    filters: {
      // volume:  100,                     // 0 – 1000
      // equalizer: [],                    // [{ band: 0, gain: 0.25 }, ...]
      // karaoke:  { level: 0, monoLevel: 1, filterBand: 220, filterWidth: 100 },
      // timescale: { speed: 1, pitch: 1, rate: 1 },
      // tremolo:  { frequency: 2, depth: 0 },
      // vibrato:  { frequency: 2, depth: 0 },
      // rotation: { rotationHz: 0 },
      // distortion: { sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1, tanOffset: 0, tanScale: 1 },
      // channelMix: { leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 },
      // lowPass:  { smoothing: 1 },
      // highPass: { smoothing: 0 },
      // reverb:   { delay: 0.05, decay: 0.3, mix: 0 },
      // limiter:  { threshold: 1, attack: 0.002, release: 0.1, ratio: 20 },
    },
  },

  // ── Cache ───────────────────────────────────────────────────────────
  cache: {
    enabled: true,
    ttl: 300_000,
    searchTtl: 60_000,
    playlistTtl: 300_000,
    negativeTtl: 10_000,
    maxSize: 500,
    keyPrefix: 'sonata:',
    memoryOnly: false,
    redis: '',
  },

  // ── Metrics ─────────────────────────────────────────────────────────
  metrics: {
    enabled: true,
    path: '/metrics',
    prefix: 'sonata',
    histogramBuckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    labels: {},
    excludeRoutes: [],
  },

  // ── Rate Limiting ───────────────────────────────────────────────────
  rateLimiting: {
    enabled: false,
    windowMs: 60_000,
    maxRequests: 100,
    perRoute: {},
    statusCode: 429,
    message: 'Too many requests, please try again later.',
    sendHeaders: true,
    trustProxy: false,
    perUser: false,
  },

  // ── Security ────────────────────────────────────────────────────────
  security: {
    // rateLimit/maxRequests/windowMs are deprecated — use rateLimiting above
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

  // ── Plugins ─────────────────────────────────────────────────────────
  plugins: {
    paths: [],
    configs: {},
    npm: [],
    scanDir: '',
  },

  // ── Clustering ──────────────────────────────────────────────────────
  clustering: {
    enabled: false,
    nodes: [],
    nodeId: '',
    heartbeatInterval: 10_000,
    heartbeatTimeout: 30_000,
    electionStrategy: 'manual',  // manual | lowestLoad | roundRobin | hash
  },

  // ── Resolver ────────────────────────────────────────────────────────
  resolving: {
    strict: false,
    maxUriLength: 2048,
    defaultSearch: 'youtube',
    searchAliases: { yt: 'youtube', sc: 'soundcloud', sp: 'spotify', bc: 'bandcamp' },
    retryCount: 2,
    retryDelay: 1_000,
    fallbacks: ['youtube', 'soundcloud'],
  },

  // ── Dashboard ───────────────────────────────────────────────────────
  dashboard: {
    title: 'Sonata',
    theme: 'dark',
    refreshInterval: 5_000,
    showTrackHistory: true,
    showPlayerControls: true,
    brandColor: '#5865F2',
    footerText: 'Sonata Audio Server',
  },

  // ── Misc ────────────────────────────────────────────────────────────
  shutdownDelay: 10_000,
}
