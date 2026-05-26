import type { Logger } from '../utils/logger.js'

export interface DatabaseConfig {
  enabled: boolean
  type?: 'sqlite' | 'postgres' | 'mysql'
  url?: string
  sqlitePath?: string
  poolSize?: number
  migrate?: boolean
}

export class DatabaseManager {
  #cfg: DatabaseConfig
  #logger: Logger | null = null
  #connected = false
  #pool: any = null

  constructor(cfg: DatabaseConfig) {
    this.#cfg = cfg
  }

  setLogger(logger: Logger) { this.#logger = logger }

  get connected() { return this.#connected }

  async connect(): Promise<boolean> {
    if (!this.#cfg.enabled) return false
    try {
      if (this.#cfg.type === 'sqlite') {
        const { default: Database } = await import('better-sqlite3').catch(() => ({ default: null }))
        if (!Database) {
          this.#logger?.warn('Database', 'better-sqlite3 not installed')
          return false
        }
        this.#pool = new Database(this.#cfg.sqlitePath ?? 'data/sonata.db')
        this.#connected = true
      } else {
        this.#connected = false
        this.#logger?.warn('Database', `${this.#cfg.type} support not yet implemented`)
      }
      if (this.#connected && this.#cfg.migrate) {
        await this.#runMigrations()
      }
      return this.#connected
    } catch (err: any) {
      this.#logger?.warn('Database', `Connection failed: ${err.message}`)
      return false
    }
  }

  get db() { return this.#pool }

  async #runMigrations() {
    if (!this.#pool) return
  }

  close() {
    if (this.#pool) {
      try { this.#pool.close() } catch {}
      this.#pool = null
    }
    this.#connected = false
  }
}
