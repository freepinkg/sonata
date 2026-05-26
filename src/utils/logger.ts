import { createWriteStream, existsSync, mkdirSync, renameSync, readFileSync, writeFileSync, unlinkSync, WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { inspect } from 'node:util'
import { gzipSync } from 'node:zlib'
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
  #fileBytes: number = 0
  #module: string
  #excludePaths: string[] = []
  #colorize: boolean = true
  #showPid: boolean = false
  #tsFormat: string = 'default'

  constructor(cfg: {
    level?: string
    format?: string
    moduleLevels?: Record<string, string>
    file?: { enabled?: boolean; path?: string; maxSize?: number; maxFiles?: number; compress?: boolean }
    excludePaths?: string[]
    module?: string
    colorize?: boolean
    showPid?: boolean
    tsFormat?: string
  }) {
    this.#levelIdx = normalizeLevel(cfg.level ?? 'normal')
    this.#format = cfg.format ?? 'text'
    this.#moduleLevels = cfg.moduleLevels ?? {}
    this.#module = cfg.module ?? ''
    this.#excludePaths = cfg.excludePaths ?? []
    this.#colorize = cfg.colorize ?? true
    this.#showPid = cfg.showPid ?? false
    this.#tsFormat = cfg.tsFormat ?? 'default'
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

  #timestamp(): string {
    switch (this.#tsFormat) {
      case 'iso': return new Date().toISOString()
      case 'epoch': return String(Date.now())
      case 'relative': return process.uptime().toFixed(3)
      case 'none': return ''
      default: return ts()
    }
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
    const tsStr = this.#timestamp()
    const tsPrefix = tsStr ? `[${tsStr}]` : ''
    const pidPrefix = this.#showPid ? `[${process.pid}]` : ''
    if (this.#colorize) {
      const mod = module ? moduleColor(module)(` ${module} `) : ''
      return `${pidPrefix}${chalk.dim(tsPrefix)} ${style.dot}${mod}· ${fullMsg}`
    }
    const mod = module ? ` ${module} ` : ''
    return `${pidPrefix}${tsPrefix} ${LEVEL_STYLES[level].label}${mod}· ${fullMsg}`
  }

  #rotate() {
    const basePath = this.#fileCfg?.path
    if (!basePath || !this.#fileStream) return
    const maxFiles = this.#fileCfg.maxFiles ?? 5
    const compress = this.#fileCfg.compress ?? false

    this.#fileStream.close()
    this.#fileStream = null

    const oldest = `${basePath}.${maxFiles}${compress ? '.gz' : ''}`
    if (existsSync(oldest)) unlinkSync(oldest)

    for (let i = maxFiles - 1; i >= 1; i--) {
      const src = `${basePath}.${i}${compress ? '.gz' : ''}`
      const dst = `${basePath}.${i + 1}${compress ? '.gz' : ''}`
      if (existsSync(src)) renameSync(src, dst)
    }

    if (existsSync(basePath)) {
      if (compress) {
        const data = readFileSync(basePath)
        writeFileSync(`${basePath}.1.gz`, gzipSync(data))
        unlinkSync(basePath)
      } else {
        renameSync(basePath, `${basePath}.1`)
      }
    }

    this.#fileStream = createWriteStream(basePath, { flags: 'a' })
    this.#fileBytes = 0
  }

  #write(level: Level, module: string, msg: string, ...args: any[]) {
    if (!this.#shouldLog(level)) return

    if (this.#format === 'json') {
      const entry: any = {
        timestamp: new Date().toISOString(),
        level: LEVEL_STYLES[level].label,
        module,
        message: msg,
      }
      if (this.#showPid) entry.pid = process.pid
      if (args.length > 0) entry.args = args.map(a => a instanceof Error ? a.message : a)
      process.stderr.write(JSON.stringify(entry) + '\n')
    } else {
      process.stderr.write(this.#fmt(level, module, msg, args) + '\n')
    }

    if (this.#fileStream) {
      if (this.#fileCfg?.maxSize && this.#fileBytes >= this.#fileCfg.maxSize) {
        this.#rotate()
        if (!this.#fileStream) return
      }

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
      const line = `[${tsFull}] [${label}]${mod} ${fullMsg}\n`
      this.#fileStream.write(line)
      this.#fileBytes += Buffer.byteLength(line)
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
      colorize: this.#colorize,
      showPid: this.#showPid,
      tsFormat: this.#tsFormat,
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
    colorize: cfg.colorize,
    showPid: cfg.showPid,
    tsFormat: cfg.timestampFormat,
    moduleLevels: cfg.moduleLevels ?? {},
    file: cfg.file ?? null,
    excludePaths: cfg.excludePaths,
  })
}
