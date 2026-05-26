import type { IncomingMessage, ServerResponse } from 'node:http'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

export interface Track {
  encoded: string
  info: TrackInfo
  source: string
  userData?: Record<string, unknown>
}

export interface TrackInfo {
  identifier: string
  title: string
  author: string
  duration: number
  length?: number
  uri: string
  artworkUrl: string
  sourceName: string
  isStream: boolean
  position: number
  isSeekable?: boolean
}

export interface PlayerState {
  guildId: string
  track?: Track
  volume: number
  paused: boolean
  position: number
  connected: boolean
  ping: number
}

export interface VoiceState {
  sessionId: string
  token: string
  endpoint: string
}

export interface SessionState {
  id: string
  resume: boolean
  resumeKey?: string
}

export interface LoadTracksResult {
  loadType: 'track' | 'search' | 'playlist' | 'empty' | 'error'
  tracks: Track[]
  playlistInfo?: PlaylistInfo
  exception?: Exception
}

export interface PlaylistInfo {
  name: string
  trackCount: number
}

export interface Exception {
  message: string
  severity: 'COMMON' | 'SUSPICIOUS' | 'FAULT'
}

export interface Stats {
  players: number
  playing: number
  uptime: number
  memory: MemoryStats
  cpu: CpuStats
  frameStats?: FrameStats
}

export interface MemoryStats {
  free: number
  used: number
  allocated: number
  reservable: number
}

export interface CpuStats {
  cores: number
  systemLoad: number
  processLoad: number
}

export interface FrameStats {
  sent: number
  nulled: number
  dropped: number
}

export interface Plugin {
  name: string
  version: string
  install(ctx: PluginContext): void | Promise<void>
}

export type LogLevel = 'trace' | 'verbose' | 'debug' | 'normal' | 'warn' | 'error'

export type TrackStartHandler = (guildId: string, track: Track) => void
export type TrackEndHandler = (guildId: string, track: Track, reason: string) => void
export type TrackStuckHandler = (guildId: string, track: Track, thresholdMs: number) => void
export type TrackExceptionHandler = (guildId: string, track: Track, error: string) => void
export type TrackExceptionRawHandler = (guildId: string, track: Track, error: Error | string) => void
export type QueueEndHandler = (guildId: string) => void
export type PlayerUpdateHandler = (guildId: string, state: PlayerState) => void
export type QueueEventHandler = (guildId: string, detail: unknown) => void
export type QueueEventType = 'add' | 'remove' | 'clear' | 'shuffle'

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>

export interface PluginContext {
  config: Record<string, unknown>
  onTrackStart: (handler: TrackStartHandler) => void
  onTrackEnd: (handler: TrackEndHandler) => void
  onTrackStuck: (handler: TrackStuckHandler) => void
  onTrackException: (handler: TrackExceptionHandler) => void
  onQueueEnd: (handler: QueueEndHandler) => void
  onPlayerUpdate: (handler: PlayerUpdateHandler) => void
  onQueueEvent: (type: QueueEventType, handler: QueueEventHandler) => void
  registerRoute: (method: HttpMethod, path: string, handler: RouteHandler) => void
  log: (level: LogLevel, message: string, ...args: unknown[]) => void
}

export type TrackEventHandler = TrackStartHandler

export interface QueueState {
  current: Track | null
  queue: Track[]
  history: Track[]
}

export interface FilterOptions {
  volume?: number
  equalizer?: Band[]
  karaoke?: KaraokeOptions
  timescale?: TimescaleOptions
  tremolo?: TremoloOptions
  vibrato?: VibratoOptions
  rotation?: RotationOptions
  distortion?: DistortionOptions
  channelMix?: ChannelMixOptions
  lowPass?: LowPassOptions
  highPass?: HighPassOptions
  reverb?: ReverbOptions
  limiter?: LimiterOptions
}

export interface Band {
  band: number
  gain: number
}

export interface KaraokeOptions {
  level?: number
  monoLevel?: number
  filterBand?: number
  filterWidth?: number
}

export interface TimescaleOptions {
  speed?: number
  pitch?: number
  rate?: number
}

export interface TremoloOptions {
  frequency?: number
  depth?: number
}

export interface VibratoOptions {
  frequency?: number
  depth?: number
}

export interface RotationOptions {
  rotationHz?: number
}

export interface DistortionOptions {
  sinOffset?: number
  sinScale?: number
  cosOffset?: number
  cosScale?: number
  tanOffset?: number
  tanScale?: number
  offset?: number
  scale?: number
}

export interface ChannelMixOptions {
  leftToLeft?: number
  leftToRight?: number
  rightToLeft?: number
  rightToRight?: number
}

export interface LowPassOptions {
  smoothing?: number
}

export interface HighPassOptions {
  smoothing?: number
}

export interface ReverbOptions {
  delay?: number
  decay?: number
  mix?: number
}

export interface LimiterOptions {
  threshold?: number
  attack?: number
  release?: number
  ratio?: number
}

export interface Config {
  server: {
    host: string
    port: number
    password: string
    workers?: number
    maxBodySize?: number
    socketTimeout?: number
    trustProxy?: boolean
    /** Auth tokens (can have multiple) */
    tokens?: string[]
    /** IP whitelist (empty = allow all) */
    ipWhitelist?: string[]
    /** IP blacklist */
    ipBlacklist?: string[]
    /** Enable CORS */
    cors?: boolean
    /** Dashboard path (empty = disabled) */
    dashboard?: string
    /** Version endpoint path */
    versionPath?: string
    /** Health endpoint path */
    healthPath?: string
    /** HTTP keep-alive timeout (ms) */
    keepAliveTimeout?: number
    /** Max header size (bytes) */
    maxHeaderSize?: number
    /** Enable gzip/deflate compression */
    compression?: boolean
    /** HTTP/2 support */
    http2?: boolean
    /** HTTPS/TLS options */
    ssl?: {
      cert: string
      key: string
      ca?: string
      passphrase?: string
      secureOptions?: number
    }
    /** Custom response headers */
    customHeaders?: Record<string, string>
    /** Rate limit bypass IPs (always allowed) */
    trustedIps?: string[]
  }
  logging: {
    level: 'trace' | 'verbose' | 'debug' | 'normal' | 'warn' | 'error'
    format: 'text' | 'json'
    destination?: string
    colorize?: boolean
    excludePaths?: string[]
    /** File-based logging */
    file?: {
      enabled: boolean
      path: string
      maxSize?: number
      maxFiles?: number
      compress?: boolean
    }
    /** Per-module log levels (e.g. { server: 'debug', resolving: 'warn' }) */
    moduleLevels?: Record<string, 'trace' | 'verbose' | 'debug' | 'normal' | 'warn' | 'error'>
    /** Timestamp format in logs */
    timestampFormat?: 'iso' | 'epoch' | 'relative' | 'none'
    /** Include process PID in logs */
    showPid?: boolean
  }
  sources: {
    youtube: {
      enabled: boolean
      clientProfiles?: ('WEB' | 'MUSIC' | 'ANDROID' | 'IOS' | 'TV')[]
      proxy?: string
      /** Custom InnerTube API key */
      apiKey?: string
      /** Custom client name sent to InnerTube */
      clientName?: string
      /** Request timeout per search */
      timeout?: number
      /** Max results per search */
      maxResults?: number
      /** Fetch and parse player.js for cipher decoding */
      fetchPlayerJS?: boolean
      /** Explicit player script URL for cipher service */
      playerUrl?: string
      /** OAuth configuration for authenticated clients (TVHTML5) */
      oauth?: {
        /** Set to true to trigger the device code flow on next startup */
        getOAuthToken?: boolean
        /** Refresh token from a previous OAuth device flow */
        refreshToken?: string
      }
      /** Remote cipher service configuration */
      cipher?: {
        /** URL of the remote cipher service (e.g. https://cipher.kikkia.dev/api) */
        url?: string
        /** Optional bearer token for the cipher service */
        token?: string
      }
      /** Proof-of-origin token configuration */
      poToken?: {
        /** URL of the poToken service */
        service?: string
        /** Pre-obtained poToken value */
        token?: string
      }
      /** Per-client settings (e.g. TV refresh token) */
      clients?: {
        settings?: {
          TV?: {
            refreshToken?: string | string[]
          }
        }
      }
    }
    soundcloud: {
      enabled: boolean
      clientId?: string
      /** Custom API URL (for mirrors) */
      apiUrl?: string
      /** Resolve redirects */
      resolveRedirects?: boolean
      /** Timeout per request */
      timeout?: number
    }
    spotify: {
      enabled: boolean
      clientId: string
      clientSecret: string
      market?: string
      /** Country code for regional filtering */
      country?: string
      /** Max playlist tracks to fetch */
      maxPlaylistTracks?: number
      /** Flavor of resolver to use (auto = try mirror first, then fallback) */
      resolverFlavor?: 'auto' | 'mirror' | 'direct'
      /** Retry on failure count */
      retryCount?: number
    }
    bandcamp?: { enabled: boolean; quality?: 'high' | 'medium' | 'low'; timeout?: number }
    twitch?: { enabled: boolean; clientId?: string; clientSecret?: string; quality?: string; timeout?: number }
    vimeo?: { enabled: boolean; quality?: string; timeout?: number }
    deezer?: { enabled: boolean; quality?: 'FLAC' | 'MP3_320' | 'MP3_128'; arl?: string; timeout?: number }
    apple?: { enabled: boolean; quality?: 'high' | 'medium' | 'low'; storefront?: string; timeout?: number }
    nico?: { enabled: boolean; quality?: string; timeout?: number }
    mixcloud?: { enabled: boolean; quality?: string; timeout?: number }
    podcast?: { enabled: boolean; maxEpisodes?: number; userAgent?: string; timeout?: number }
    tiktok?: { enabled: boolean; quality?: string; timeout?: number }
    jiosaavn?: { enabled: boolean; quality?: 'high' | 'medium' | 'low'; timeout?: number; decryptionKey?: string }
    http?: boolean | { timeout?: number; retryCount?: number; userAgent?: string; followRedirects?: boolean; maxRedirects?: number }
    local?: boolean | { basePath?: string; allowedExtensions?: string[]; maxFileSize?: number }
    /** Source priority ordering (first match wins) */
    priority?: string[]
    /** Custom user-agent per source */
    userAgent?: string
    /** Global source request timeout */
    requestTimeout?: number
  }
  lavalink: {
    apiVersion: 3 | 4
    resumeTimeout?: number
    resumeKey?: string
    sessionTimeout?: number
    /** Path to lavalink plugin jars (auto-load) */
    pluginDir?: string
    /** External API base URL for plugin calls */
    externalApi?: string
    /** Custom track decoder URL */
    decoderEndpoint?: string
    /** Max track length in ms for inbound requests */
    maxTrackLength?: number
    /** Validate track payload structure */
    strictValidation?: boolean
  }
  voice: {
    udpMode?: 'ipv4' | 'ipv6'
    externalAddress?: string
    portRange?: [number, number]
    bufferSize?: number
    /** Force IP discovery even if externalAddress is set */
    forceIpDiscovery?: boolean
    /** Encryption fallback modes (ordered) */
    encryptionFallback?: ('xsalsa20_poly1305' | 'aes256_gcm' | 'aes256_cbc' | 'plain')[]
    /** Silence frames to send on connection */
    silenceFrames?: number
    /** Keepalive interval (ms) */
    keepaliveInterval?: number
    /** Max reconnect attempts */
    maxReconnectAttempts?: number
    /** Reconnect delay base (ms, exponential backoff) */
    reconnectDelay?: number
  }
  queue: {
    maxHistorySize?: number
    defaultVolume?: number
    /** Max queue size (0 = unlimited) */
    maxSize?: number
    /** Crossfade duration in ms */
    crossfade?: number
    /** Separate crossfade fade-in duration (ms) */
    crossfadeFadeIn?: number
    /** Separate crossfade fade-out duration (ms) */
    crossfadeFadeOut?: number
    /** Enable shuffle by default */
    shuffle?: boolean
    /** Repeat mode when queue is empty (none = stop, track = repeat last, queue = refill from history) */
    emptyRepeatMode?: 'none' | 'track' | 'queue'
    /** Max tracks per source (e.g. { youtube: 50, soundcloud: 30 }) */
    perSourceLimits?: Record<string, number>
  }
  player: {
    /** Auto advance to next track */
    autoPlay?: boolean
    /** Volume normalization (replaygain) */
    replaygain?: boolean
    /** Max event history entries */
    eventHistory?: number
    /** Behavior when queue is empty */
    emptyQueueBehavior?: 'stop' | 'pause' | 'await'
    /** Auto-leave voice after inactivity (ms) */
    autoLeaveMs?: number
    /** Skip track on decode error */
    skipOnError?: boolean
    /** Max consecutive error skips before stopping */
    maxErrorSkips?: number
    /** Max track duration in ms (0 = unlimited) */
    maxTrackDuration?: number
    /** Minimum track duration in ms */
    minTrackDuration?: number
    /** Idle timeout (ms) before cleanup */
    idleTimeout?: number
    /** Start crossfade this many ms before track end */
    crossfadeOffset?: number
    /** Enable seeking for streams */
    allowStreamSeek?: boolean
    /** Max seek position (ms) */
    maxSeekPosition?: number
    /** Persist queue to disk */
    stickyQueue?: boolean
    /** File path for sticky queue */
    stickyQueueFile?: string
    /** Audio normalization (volume leveling) */
    normalization?: boolean
    /** Normalization target LUFS */
    normalizationTarget?: number
    /** Default filters applied to all players */
    filters?: FilterOptions
  }
  cache: {
    /** Enable track cache */
    enabled: boolean
    /** Cache TTL in ms */
    ttl?: number
    /** Max cached entries */
    maxSize?: number
    /** Redis URL (if using redis cache) */
    redis?: string
    /** Separate TTL for search results (ms) */
    searchTtl?: number
    /** Separate TTL for playlist results (ms) */
    playlistTtl?: number
    /** Negative cache TTL (failed lookups, ms) */
    negativeTtl?: number
    /** Cache keys prefix (useful with redis) */
    keyPrefix?: string
    /** Memory cache only (ignore redis config) */
    memoryOnly?: boolean
  }
  metrics: {
    enabled: boolean
    path?: string
    prefix?: string
    /** Histogram buckets for latency (ms) */
    histogramBuckets?: number[]
    /** Custom label values */
    labels?: Record<string, string>
    /** Exclude specific routes from metrics */
    excludeRoutes?: string[]
  }
  rateLimiting: {
    enabled?: boolean
    windowMs?: number
    maxRequests?: number
    /** Rate limit per route (overrides global) */
    perRoute?: Record<string, { maxRequests: number; windowMs: number }>
    /** Status code to return on rate limit */
    statusCode?: number
    /** Error message on rate limit */
    message?: string
    /** Include rate limit headers */
    sendHeaders?: boolean
    /** Trust forwarded-for header for rate limiting IP */
    trustProxy?: boolean
    /** Per-user rate limiting (key by user ID from Authorization) */
    perUser?: boolean
  }
  security: {
    /** Rate limit enabled (deprecated, use rateLimiting.enabled) */
    rateLimit?: boolean
    /** Max requests per window (deprecated, use rateLimiting.maxRequests) */
    maxRequests?: number
    /** Window in ms (deprecated, use rateLimiting.windowMs) */
    windowMs?: number
    /** Block specific HTTP methods */
    blockMethods?: string[]
    /** Block specific paths (glob patterns) */
    blockPaths?: string[]
    /** Request body validation (max nested depth) */
    maxBodyDepth?: number
    /** Require specific content-type for POST/PUT/PATCH */
    enforceContentType?: boolean
    /** HSTS header max-age (seconds, 0 = disable) */
    hstsMaxAge?: number
    /** Block requests without User-Agent header */
    requireUserAgent?: boolean
    /** SQL injection pattern blocking */
    blockSqlInjection?: boolean
    /** XSS pattern blocking */
    blockXss?: boolean
  }
  plugins: {
    paths?: string[]
    configs?: Record<string, Record<string, unknown>>
    /** Auto-install plugins from npm */
    npm?: string[]
    /** Plugin directory to scan for .js/.mjs files */
    scanDir?: string
  }
  clustering: {
    enabled: boolean
    nodes?: { host: string; port: number; password?: string; secure?: boolean; weight?: number }[]
    /** Node ID (for identification in logs) */
    nodeId?: string
    /** Heartbeat interval (ms) */
    heartbeatInterval?: number
    /** Heartbeat timeout (ms) */
    heartbeatTimeout?: number
    /** Node election strategy */
    electionStrategy?: 'manual' | 'lowestLoad' | 'roundRobin' | 'hash'
    /** Auto-scale settings */
    autoScale?: {
      minNodes: number
      maxNodes: number
      cpuThreshold: number
      cooldownMs: number
    }
  }
  /** Graceful shutdown delay in ms */
  shutdownDelay?: number
  /** Dashboard customization */
  dashboard?: {
    title?: string
    theme?: 'light' | 'dark' | 'auto'
    refreshInterval?: number
    showTrackHistory?: boolean
    showPlayerControls?: boolean
    brandColor?: string
    customCss?: string
    logoUrl?: string
    faviconUrl?: string
    footerText?: string
  }
  /** Proxy configuration for audio streaming */
  proxy?: {
    /** SOCKS5 proxy URL (e.g. socks5://127.0.0.1:40000) */
    socks?: string
    /** HTTP proxy URL */
    http?: string
  }
  /** Custom resolver behavior */
  resolving?: {
    /** Strict mode (reject unknown sources) */
    strict?: boolean
    /** Max URI length for direct link resolution */
    maxUriLength?: number
    /** Default search engine when no source prefix */
    defaultSearch?: string
    /** Search engine aliases (e.g. { yt: 'youtube', sc: 'soundcloud' }) */
    searchAliases?: Record<string, string>
    /** Retry count per source */
    retryCount?: number
    /** Retry delay base (ms) */
    retryDelay?: number
    /** Fallback sources if primary fails */
    fallbacks?: string[]
  }
}

export interface Route {
  method: HttpMethod
  path: string
  handler: (req: Request, res: Response) => void | Promise<void>
}
