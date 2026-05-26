import { VERSION, NAME } from '../version.js'
import type { Logger } from './logger.js'

const CHECK = '\u2705'
const CROSS = '\u274C'

export function logStartup(cfg: any, pluginCount: number, logger?: Logger) {
  const features: string[] = [
    cfg.cache?.enabled && 'cache',
    cfg.server.cors && 'cors',
    cfg.server.dashboard && 'dashboard',
    cfg.player?.autoPlay && 'autoplay',
  ].filter(Boolean) as string[]

  const sources = Object.entries(cfg.sources)
    .filter(([k]) => !['priority', 'requestTimeout'].includes(k))
    .map(([name, src]: [string, any]) => {
      const enabled = typeof src === 'object' ? src.enabled : src
      const icon = enabled ? CHECK : CROSS
      return ` ${icon} ${name}`
    })

  logger?.info('startup', `\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`)
  logger?.info('startup', `\u2502 ${NAME} v${VERSION}${' '.repeat(Math.max(0, 40 - VERSION.length - NAME.length - 4))} \u2502`)
  logger?.info('startup', `\u2502 Host: ${cfg.server.host}:${cfg.server.port}                        \u2502`)
  logger?.info('startup', `\u2502 Node: ${process.version} (${process.platform})                    \u2502`)
  logger?.info('startup', `\u2502 Lavalink: v${cfg.lavalink.apiVersion}                                   \u2502`)
  if (pluginCount > 0) {
    logger?.info('startup', `\u2502 Plugins: ${pluginCount} loaded                                      \u2502`)
  }
  logger?.info('startup', `\u2502 Features: ${features.join(', ')}${' '.repeat(Math.max(0, 41 - features.join(', ').length - 10))} \u2502`)
  logger?.info('startup', `\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524`)

  for (const line of sources) {
    logger?.info('startup', `\u2502${line}${' '.repeat(48 - line.length)} \u2502`)
  }

  logger?.info('startup', `\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518`)
}

export function logMemory(logger?: Logger) {
  const mem = process.memoryUsage()
  logger?.debug('memory', `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB ext=${(mem.external / 1024 / 1024).toFixed(1)}MB`)
}

export function logPlayerAction(guildId: string, action: string, detail?: string, logger?: Logger) {
  const msg = `${guildId} ${action}${detail ? ` (${detail})` : ''}`
  logger?.info('player', msg)
}
