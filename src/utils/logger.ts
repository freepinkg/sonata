import { createWriteStream, existsSync, mkdirSync, WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { inspect } from 'node:util'
import chalk from 'chalk'

const LEVELS = ['trace', 'verbose', 'debug', 'normal', 'warn', 'error'] as const
type Level = typeof LEVELS[number]

const LEVEL_MAP: Record<string, Level> = {
  silly: 'trace',
  info: 'normal',
  fatal: 'error',
}

const LEVEL_STYLES: Record<Level, { dot: string; label: string }> = {
  trace: { dot: chalk.dim('\u25CB'), label: 'trace' },
  verbose: { dot: chalk.cyan('\u25D8'), label: 'verbose' },
  debug: { dot: chalk.blue('\u25C9'), label: 'debug' },
  normal: { dot: chalk.green('\u25C9'), label: 'info' },
  warn: { dot: chalk.yellow('\u26A0'), label: 'warn' },
  error: { dot: chalk.red('\u2716'), label: 'error' },
}

const MODULE_COLORS: Record<string, (...s: string[]) => string> = {
  System: chalk.bold.cyan,
  Cluster: chalk.bold.magenta,
  RateLimiter: chalk.bold.yellow,
  Server: chalk.bold.blue,
  Cache: chalk.bold.green,
  Player: chalk.bold.white,
  Queue: chalk.bold.cyan,
  Proxy: chalk.bold.hex('#FF8C00'),
  Logging: chalk.bold.gray,
  Sources: chalk.bold.hex('#00BFFF'),
  Plugins: chalk.bold.hex('#9370DB'),
  Resolve: chalk.bold.hex('#20B2AA'),
  Sessions: chalk.bold.hex('#FF69B4'),
  WS: chalk.bold.hex('#87CEEB'),
  Memory: chalk.bold.hex('#A9A9A9'),
  AutoLeave: chalk.bold.hex('#FFA07A'),
}

function moduleColor(mod: string): (...s: string[]) => string {
  return MODULE_COLORS[mod] ?? chalk.bold
}

function normalizeLevel(level: string): number {
  const mapped = LEVEL_MAP[level.toLowerCase().trim()] ?? level.toLowerCase().trim()
  const idx = LEVELS.indexOf(mapped as Level)
  return idx >= 0 ? idx : LEVELS.indexOf('normal')
}

function ts(): string {
  const d = new Date()
  return `${[
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export class Logger {
  #levelIdx: number
  #format: string
  #moduleLevels: Record<string, string>
  #fileCfg: any
  #fileStream: WriteStream | null = null
  #module: string
  #excludePaths: string[] = []

  constructor(cfg: {
    level?: string
    format?: string
    moduleLevels?: Record<string, string>
    file?: { enabled?: boolean; path?: string; maxSize?: number; maxFiles?: number; compress?: boolean }
    excludePaths?: string[]
    module?: string
  }) {
    this.#levelIdx = normalizeLevel(cfg.level ?? 'normal')
    this.#format = cfg.format ?? 'text'
    this.#moduleLevels = cfg.moduleLevels ?? {}
    this.#module = cfg.module ?? ''
    this.#excludePaths = cfg.excludePaths ?? []
    this.#fileCfg = cfg.file ?? null
    if (this.#fileCfg?.enabled && this.#fileCfg.path) {
      const dir = dirname(this.#fileCfg.path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      this.#fileStream = createWriteStream(this.#fileCfg.path, { flags: 'a' })
    }
  }

  #shouldLog(level: string): boolean {
    const lvl = LEVELS.indexOf(level as Level)
    if (lvl < 0) return false
    if (this.#module && this.#moduleLevels[this.#module]) {
      const modLvl = normalizeLevel(this.#moduleLevels[this.#module])
      return lvl >= modLvl
    }
    return lvl >= this.#levelIdx
  }

  #fmt(level: Level, module: string, msg: string, args: any[]): string {
    let fullMsg = msg
    if (args.length > 0) {
      fullMsg = `${msg} ${args.map(a => {
        if (a instanceof Error) return a.stack ?? a.message
        if (typeof a === 'object') return inspect(a, { depth: 2, colors: false })
        return String(a)
      }).join(' ')}`
    }
    const style = LEVEL_STYLES[level]
    const mod = module ? moduleColor(module)(` ${module} `) : ''
    return `${chalk.dim(`[${ts()}]`)} ${style.dot}${mod}· ${fullMsg}`
  }

  #write(level: Level, module: string, msg: string, ...args: any[]) {
    if (!this.#shouldLog(level)) return

    if (this.#format === 'json') {
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: LEVEL_STYLES[level].label,
        module,
        message: msg,
        args: args.length > 0 ? args.map(a => a instanceof Error ? a.message : a) : undefined,
      })
      process.stderr.write(entry + '\n')
    } else {
      process.stderr.write(this.#fmt(level, module, msg, args) + '\n')
    }

    if (this.#fileStream) {
      const label = LEVEL_STYLES[level].label
      const mod = module ? ` ${module} >` : ''
      const tsFull = new Date().toISOString()
      let fullMsg = msg
      if (args.length > 0) {
        fullMsg = `${msg} ${args.map(a => {
          if (a instanceof Error) return a.stack ?? a.message
          if (typeof a === 'object') return JSON.stringify(a)
          return String(a)
        }).join(' ')}`
      }
      this.#fileStream.write(`[${tsFull}] [${label}]${mod} ${fullMsg}\n`)
    }
  }

  trace(module: string, msg: string, ...args: any[]) { this.#write('trace', module, msg, ...args) }
  verbose(module: string, msg: string, ...args: any[]) { this.#write('verbose', module, msg, ...args) }
  debug(module: string, msg: string, ...args: any[]) { this.#write('debug', module, msg, ...args) }
  info(module: string, msg: string, ...args: any[]) { this.#write('normal', module, msg, ...args) }
  warn(module: string, msg: string, ...args: any[]) { this.#write('warn', module, msg, ...args) }
  error(module: string, msg: string, ...args: any[]) { this.#write('error', module, msg, ...args) }

  setLevel(level: string) {
    this.#levelIdx = normalizeLevel(level)
  }

  setModuleLevel(module: string, level: string) {
    this.#moduleLevels[module] = level
  }

  setModuleLevels(levels: Record<string, string>) {
    this.#moduleLevels = levels
  }

  child(module: string): Logger {
    return new Logger({
      level: LEVELS[this.#levelIdx],
      format: this.#format,
      moduleLevels: this.#moduleLevels,
      file: this.#fileCfg,
      module,
      excludePaths: this.#excludePaths,
    })
  }

  get level() { return LEVELS[this.#levelIdx] }
  get moduleLevels() { return { ...this.#moduleLevels } }
}

export function createLogger(cfg: any): Logger {
  return new Logger({
    level: cfg.level ?? 'normal',
    format: cfg.format ?? 'text',
    moduleLevels: cfg.moduleLevels ?? {},
    file: cfg.file ?? null,
  })
}
