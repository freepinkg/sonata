import { Player, PlayerEventHandlers, State } from './player.js'
import { TrackCache } from '../cache/index.js'
import type { QueueFilterConfig } from './queue.js'
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'

const IDLE_TIMEOUT = 300_000

export class PlayerManager {
  #players = new Map<string, Player>()
  #handler: PlayerEventHandlers
  #idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  #autoLeaveMs = 0
  #autoLeaveInterval: ReturnType<typeof setInterval> | null = null
  #onAutoLeave: ((guildId: string) => void) | null = null
  #stickyQueueEnabled = false
  #stickyQueueFileTemplate = ''
  #queueFilters: QueueFilterConfig = {}
  #queueCfg: any = {}

  #snapshotCfg: { enabled: boolean; dir: string; autoSave: boolean; saveIntervalMs: number; maxSnapshots: number } | null = null
  #snapshotSaveInterval: ReturnType<typeof setInterval> | null = null

  constructor(handler: PlayerEventHandlers, stickyQueue = false, stickyQueueFile = '', queueFilters: QueueFilterConfig = {}, queueCfg: any = {}) {
    this.#handler = handler
    this.#stickyQueueEnabled = stickyQueue
    this.#stickyQueueFileTemplate = stickyQueueFile
    this.#queueFilters = queueFilters
    this.#queueCfg = queueCfg
  }

  setSnapshotConfig(cfg: { enabled: boolean; dir: string; autoSave: boolean; saveIntervalMs: number; maxSnapshots: number }) {
    this.#snapshotCfg = cfg
    if (!cfg.enabled) return
    if (!existsSync(cfg.dir)) mkdirSync(cfg.dir, { recursive: true })
    if (cfg.autoSave && cfg.saveIntervalMs > 0) {
      if (this.#snapshotSaveInterval) clearInterval(this.#snapshotSaveInterval)
      this.#snapshotSaveInterval = setInterval(() => {
        for (const p of this.#players.values()) {
          if (p.state !== State.Stopped) this.#saveSnapshot(p)
        }
      }, cfg.saveIntervalMs)
    }
  }

  async saveSnapshot(guildId: string) {
    const p = this.#players.get(guildId)
    if (!p || !this.#snapshotCfg?.enabled) return
    this.#saveSnapshot(p)
  }

  async restoreSnapshot(guildId: string): Promise<boolean> {
    if (!this.#snapshotCfg?.enabled) return false
    const dir = this.#snapshotCfg.dir
    const file = join(dir, `${guildId}.json`)
    if (!existsSync(file)) return false
    try {
      const raw = readFileSync(file, 'utf-8')
      const data = JSON.parse(raw)
      const p = this.getOrCreate(guildId)
      p.fromSnapshot(data)
      return true
    } catch { return false }
  }

  #saveSnapshot(p: Player) {
    if (!this.#snapshotCfg?.enabled) return
    const dir = this.#snapshotCfg.dir
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const snap = p.toSnapshot()
    const file = join(dir, `${p.guildId}.json`)
    writeFileSync(file, JSON.stringify(snap, null, 2), 'utf-8')
    this.#rotateSnapshots(dir)
  }

  #rotateSnapshots(dir: string) {
    const max = this.#snapshotCfg?.maxSnapshots ?? 10
    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime)
      if (files.length <= max) return
      const toDelete = files.slice(0, files.length - max)
      for (const f of toDelete) {
        try { unlinkSync(join(dir, f.name)) } catch {}
      }
    } catch {}
  }

  setAutoLeave(ms: number, onLeave: (guildId: string) => void) {
    this.#autoLeaveMs = ms
    this.#onAutoLeave = onLeave
    if (ms > 0 && !this.#autoLeaveInterval) {
      this.#autoLeaveInterval = setInterval(() => this.#checkAutoLeave(), 10_000)
    }
  }

  #checkAutoLeave() {
    if (this.#autoLeaveMs <= 0) return
    for (const [guildId, p] of this.#players) {
      if (!p.voice?.connected) continue
      if (p.state === State.Playing || p.state === State.Paused) continue
      if (p.getIdleTime() >= this.#autoLeaveMs) {
        this.#onAutoLeave?.(guildId)
      }
    }
  }

  get(guildId: string): Player | undefined { return this.#players.get(guildId) }

  getOrCreate(guildId: string): Player {
    let p = this.#players.get(guildId)
    if (!p) {
      const stickyFile = this.#stickyQueueEnabled
        ? (this.#stickyQueueFileTemplate || `data/queue-${guildId}.json`).replace('{guildId}', guildId)
        : ''
      p = new Player(guildId, this.#handler, stickyFile, {
        defaultVolume: this.#queueCfg?.defaultVolume,
        shuffle: this.#queueCfg?.shuffle,
        maxHistorySize: this.#queueCfg?.maxHistorySize,
        emptyRepeatMode: this.#queueCfg?.emptyRepeatMode,
        perSourceLimits: this.#queueCfg?.perSourceLimits,
        djMode: this.#queueCfg?.djMode,
        collaborative: this.#queueCfg?.collaborative,
      })
      p.queue.setFilters(this.#queueFilters)
      this.#players.set(guildId, p)
      this.#resetIdle(guildId)
    }
    return p
  }

  remove(guildId: string) {
    this.#players.get(guildId)?.stop()
    this.#players.delete(guildId)
    this.#clearIdle(guildId)
  }

  all(): Player[] { return [...this.#players.values()] }
  count() { return this.#players.size }
  playingCount() { return this.all().filter(p => p.state === State.Playing).length }
  pausedCount() { return this.all().filter(p => p.state === State.Paused).length }
  connectedCount() { return this.all().filter(p => p.voice?.connected).length }
  reset() {
    this.#players.forEach(p => p.stop())
    this.#players.clear()
    if (this.#autoLeaveInterval) {
      clearInterval(this.#autoLeaveInterval)
      this.#autoLeaveInterval = null
    }
  }

  getStats() {
    return {
      players: this.count(),
      playing: this.playingCount(),
      paused: this.pausedCount(),
      connected: this.connectedCount(),
      uptime: process.uptime(),
    }
  }

  #resetIdle(guildId: string) {
    this.#clearIdle(guildId)
    const timer = setTimeout(() => {
      const p = this.#players.get(guildId)
      if (p && p.state === State.Stopped) {
        p.stop()
        this.#players.delete(guildId)
      }
    }, IDLE_TIMEOUT)
    this.#idleTimers.set(guildId, timer)
  }

  #clearIdle(guildId: string) {
    const t = this.#idleTimers.get(guildId)
    if (t) { clearTimeout(t); this.#idleTimers.delete(guildId) }
  }
}
