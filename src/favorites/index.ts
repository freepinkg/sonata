import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

interface SavedTrack {
  encoded: string
  title: string
  author: string
  uri: string
  source: string
  addedAt: number
  addedBy?: string
}

interface GuildFavorites {
  guildId: string
  tracks: SavedTrack[]
}

const BASE_DIR = 'data/favorites'

export class FavoritesManager {
  #cache = new Map<string, GuildFavorites>()
  #dir: string

  constructor(dir = BASE_DIR) {
    this.#dir = dir
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  #path(guildId: string) { return join(this.#dir, `${guildId}.json`) }

  #load(guildId: string): GuildFavorites {
    const cached = this.#cache.get(guildId)
    if (cached) return cached
    try {
      if (existsSync(this.#path(guildId))) {
        const data = JSON.parse(readFileSync(this.#path(guildId), 'utf-8'))
        this.#cache.set(guildId, data)
        return data
      }
    } catch {}
    const empty: GuildFavorites = { guildId, tracks: [] }
    this.#cache.set(guildId, empty)
    return empty
  }

  #save(guildId: string) {
    const data = this.#cache.get(guildId)
    if (data) {
      const dir = dirname(this.#path(guildId))
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.#path(guildId), JSON.stringify(data, null, 2))
    }
  }

  add(guildId: string, track: SavedTrack) {
    const fav = this.#load(guildId)
    const exists = fav.tracks.some(t => t.encoded === track.encoded)
    if (exists) return false
    fav.tracks.push({ ...track, addedAt: Date.now() })
    this.#save(guildId)
    return true
  }

  remove(guildId: string, encoded: string): boolean {
    const fav = this.#load(guildId)
    const before = fav.tracks.length
    fav.tracks = fav.tracks.filter(t => t.encoded !== encoded)
    if (fav.tracks.length !== before) {
      this.#save(guildId)
      return true
    }
    return false
  }

  list(guildId: string): SavedTrack[] {
    return this.#load(guildId).tracks
  }

  count(guildId: string): number {
    return this.#load(guildId).tracks.length
  }

  clear(guildId: string) {
    this.#cache.set(guildId, { guildId, tracks: [] })
    this.#save(guildId)
  }

  isFavorite(guildId: string, encoded: string): boolean {
    return this.#load(guildId).tracks.some(t => t.encoded === encoded)
  }
}
