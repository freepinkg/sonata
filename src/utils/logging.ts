import { execSync } from 'node:child_process'
import { VERSION, NAME } from '../version.js'
import type { Logger } from './logger.js'

let _gitInfo: { branch: string; commit: string; date: string } | null = null

export function getGitInfo() {
  if (_gitInfo) return _gitInfo
  try {
    _gitInfo = {
      branch: execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf-8' }).trim(),
      commit: execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf-8' }).trim(),
      date: execSync('git log -1 --format=%cI 2>/dev/null', { encoding: 'utf-8' }).trim(),
    }
  } catch {
    _gitInfo = { branch: 'unknown', commit: 'unknown', date: '' }
  }
  return _gitInfo
}

const SOURCE_ICONS: Record<string, string> = {
  youtube: '▶️',
  soundcloud: '☁️',
  spotify: '🎧',
  bandcamp: '💿',
  twitch: '📺',
  vimeo: '🎬',
  deezer: '🎵',
  apple: '🍎',
  nico: '📹',
  mixcloud: '🌧️',
  podcast: '🎤',
  jiosaavn: '🎼',
  http: '🌐',
  local: '💾',
  tiktok: '🎶',
}

const BOX_W = 52

function pad(s: string, w = BOX_W) {
  return s + ' '.repeat(Math.max(0, w - s.length))
}

function fmt(s: string) {
  return `\u2502 ${pad(s)} \u2502`
}

export function logBanner(cfg: any, logger?: Logger) {
  const git = getGitInfo()

  const features: string[] = [
    cfg.cache?.enabled && 'cache',
    cfg.server.cors && 'cors',
    cfg.server.dashboard && 'dashboard',
    cfg.player?.autoPlay && 'autoplay',
  ].filter(Boolean) as string[]

  const cluster = cfg.clustering?.enabled ? `cluster:${cfg.clustering.nodes?.length ?? 0} nodes` : 'standalone'
  const ratelimit = cfg.rateLimiting?.enabled ? `rate-limit: ${cfg.rateLimiting.maxRequests}/${cfg.rateLimiting.windowMs / 1000}s` : 'rate-limit: off'
  const logFile = cfg.logging?.file?.enabled ? `log: ${cfg.logging.file.path}` : 'log: console'

  const sources = Object.entries(cfg.sources)
    .filter(([k]) => !['priority', 'requestTimeout', 'userAgent'].includes(k))
    .map(([name, src]: [string, any]) => {
      const enabled = typeof src === 'object' ? src.enabled : src
      const iconName = SOURCE_ICONS[name] || '?'
      const icon = enabled ? iconName : '🔴'
      return ` ${icon} ${name}`
    })

  logger?.info('system', `Starting ${NAME} v${VERSION} | ${process.version} ${process.platform} ${process.arch}`)
  logger?.info('system', `Git ${git.branch}/${git.commit}${git.date ? ` (${git.date})` : ''}`)

  logger?.info('startup', `\u250C${'\u2500'.repeat(BOX_W + 2)}\u2510`)
  logger?.info('startup', fmt(`${NAME} v${VERSION}`))
  logger?.info('startup', fmt(`Host: ${cfg.server.host}:${cfg.server.port}`))
  logger?.info('startup', fmt(`Node: ${process.version} (${process.platform})`))
  logger?.info('startup', fmt(`Lavalink: v${cfg.lavalink.apiVersion}`))
  logger?.info('startup', fmt(cluster))
  logger?.info('startup', fmt(ratelimit))
  logger?.info('startup', fmt(logFile))
  if (features.length > 0) logger?.info('startup', fmt(`Features: ${features.join(', ')}`))
  logger?.info('startup', `\u251C${'\u2500'.repeat(BOX_W + 2)}\u2524`)

  for (const line of sources) {
    logger?.info('startup', fmt(pad(line, BOX_W - 1)))
  }

  logger?.info('startup', `\u2514${'\u2500'.repeat(BOX_W + 2)}\u2518`)
}

export function logMemory(logger?: Logger) {
  const mem = process.memoryUsage()
  logger?.debug('memory', `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB ext=${(mem.external / 1024 / 1024).toFixed(1)}MB`)
}

export function logPlayerAction(guildId: string, action: string, detail?: string, logger?: Logger) {
  const msg = `${guildId} ${action}${detail ? ` (${detail})` : ''}`
  logger?.info('player', msg)
}
