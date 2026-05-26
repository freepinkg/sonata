import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Track } from '../types/index.js'

export interface QueueFilterConfig {
  deduplicate?: boolean
  maxPerSource?: number
  maxPerArtist?: number
  minDurationMs?: number
  maxDurationMs?: number
  allowedSources?: string[]
  blockedSources?: string[]
}

export interface QueueDJConfig {
  enabled: boolean
  roles?: string[]
  users?: string[]
  allowSelfPlay?: boolean
  bypassOnEmpty?: boolean
}

export interface QueueCollaborativeConfig {
  enabled: boolean
  maxTracksPerUser?: number
  minVotesToSkip?: number
  voteSkipEnabled?: boolean
}

export type QueueEventType = 'add' | 'remove' | 'clear' | 'shuffle'

export interface QueueEventPayload {
  add: { track: Track; index: number }
  remove: { track: Track; index: number }
  clear: { tracks: Track[] }
  shuffle: { tracks: Track[] }
}

export class Queue extends EventTarget {
  #tracks: Track[] = []
  #history: Track[] = []
  #current: Track | null = null
  #stickyFile = ''
  #stickyDirtyTimer: ReturnType<typeof setTimeout> | null = null
  #filters: QueueFilterConfig = {}
  #maxHistorySize = 0
  #emptyRepeatMode: 'none' | 'track' | 'queue' = 'none'
  #perSourceLimits: Record<string, number> = {}
  #userTrackCount = new Map<string, Set<string>>()
  #trackUser = new Map<string, string>()
  #votes = new Map<string, Set<string>>()
  #djCfg: QueueDJConfig = { enabled: false }
  #collabCfg: QueueCollaborativeConfig = { enabled: false }

  constructor(stickyFile = '', filters: QueueFilterConfig = {}, opts?: { maxHistorySize?: number; emptyRepeatMode?: 'none' | 'track' | 'queue'; perSourceLimits?: Record<string, number>; djMode?: QueueDJConfig; collaborative?: QueueCollaborativeConfig }) {
    super()
    this.#filters = filters
    this.#maxHistorySize = opts?.maxHistorySize ?? 0
    this.#emptyRepeatMode = opts?.emptyRepeatMode ?? 'none'
    this.#perSourceLimits = opts?.perSourceLimits ?? {}
    if (opts?.djMode) this.#djCfg = opts.djMode
    if (opts?.collaborative) this.#collabCfg = opts.collaborative
    if (stickyFile) {
      this.#stickyFile = stickyFile
      this.#restore()
    }
  }

  setFilters(f: QueueFilterConfig) { this.#filters = f }

  canAdd(track: Track, userId?: string): string | null {
    if (this.#collabCfg.enabled && this.#collabCfg.maxTracksPerUser && userId) {
      const count = this.#userTrackCount.get(userId)?.size ?? 0
      if (count >= this.#collabCfg.maxTracksPerUser) return `User max tracks (${this.#collabCfg.maxTracksPerUser}) reached`
    }
    const f = this.#filters
    if (f.deduplicate && this.#tracks.some(t => t.encoded === track.encoded)) return 'Track already in queue'
    if (f.maxPerSource) {
      const fromSource = this.#tracks.filter(t => t.source === track.source).length
      if (fromSource >= f.maxPerSource) return `Max ${f.maxPerSource} tracks from ${track.source}`
    }
    if (this.#perSourceLimits[track.source]) {
      const fromSource = this.#tracks.filter(t => t.source === track.source).length
      if (fromSource >= this.#perSourceLimits[track.source]) return `Max ${this.#perSourceLimits[track.source]} tracks from ${track.source}`
    }
    if (f.maxPerArtist) {
      const fromArtist = this.#tracks.filter(t => t.info.author === track.info.author).length
      if (fromArtist >= f.maxPerArtist) return `Max ${f.maxPerArtist} tracks by ${track.info.author}`
    }
    if (f.minDurationMs && track.info.duration < f.minDurationMs) return 'Track too short'
    if (f.maxDurationMs && track.info.duration > f.maxDurationMs) return 'Track too long'
    if (f.allowedSources?.length && !f.allowedSources.includes(track.source)) return `Source ${track.source} not allowed`
    if (f.blockedSources?.length && f.blockedSources.includes(track.source)) return `Source ${track.source} blocked`
    return null
  }

  setStickyFile(path: string) {
    this.#stickyFile = path
    this.#restore()
  }

  #restore() {
    if (!this.#stickyFile || !existsSync(this.#stickyFile)) return
    try {
      const raw = readFileSync(this.#stickyFile, 'utf-8')
      const data = JSON.parse(raw)
      if (data.current) this.#current = data.current
      if (Array.isArray(data.queue)) this.#tracks = data.queue
      if (Array.isArray(data.history)) this.#history = data.history
    } catch {}
  }

  #save() {
    if (!this.#stickyFile) return
    if (this.#stickyDirtyTimer) clearTimeout(this.#stickyDirtyTimer)
    this.#stickyDirtyTimer = setTimeout(() => {
      try {
        const dir = dirname(this.#stickyFile)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(this.#stickyFile, JSON.stringify({
          current: this.#current,
          queue: this.#tracks,
          history: this.#history,
        }, null, 2), 'utf-8')
      } catch {}
    }, 100)
  }

  enqueue(track: Track, userId?: string): string | null {
    const rejection = this.canAdd(track, userId)
    if (rejection) return rejection
    this.#tracks.push(track)
    if (userId && this.#collabCfg.enabled) {
      this.#trackUser.set(track.encoded, userId)
      if (!this.#userTrackCount.has(userId)) this.#userTrackCount.set(userId, new Set())
      this.#userTrackCount.get(userId)!.add(track.encoded)
    }
    this.#emit('add', { track, index: this.#tracks.length - 1 })
    this.#save()
    return null
  }

  dequeue(): Track | null {
    const track = this.#tracks.shift() ?? null
    if (track) {
      if (this.#collabCfg.enabled && this.#trackUser.has(track.encoded)) {
        const userId = this.#trackUser.get(track.encoded)!
        this.#userTrackCount.get(userId)?.delete(track.encoded)
        this.#trackUser.delete(track.encoded)
      }
      this.#emit('remove', { track, index: 0 })
    }
    this.#save()
    return track
  }

  peek(): Track | null { return this.#tracks[0] ?? null }

  add(track: Track, index?: number) {
    if (index === undefined || index < 0 || index >= this.#tracks.length) {
      this.#tracks.push(track)
      this.#emit('add', { track, index: this.#tracks.length - 1 })
    } else {
      this.#tracks.splice(index, 0, track)
      this.#emit('add', { track, index })
    }
    this.#save()
  }

  remove(index: number): Track | null {
    if (index < 0 || index >= this.#tracks.length) return null
    const [track] = this.#tracks.splice(index, 1)
    if (track) this.#emit('remove', { track, index })
    this.#save()
    return track ?? null
  }

  removeTrack(track: Track): boolean {
    const index = this.#tracks.indexOf(track)
    if (index === -1) return false
    this.#tracks.splice(index, 1)
    this.#emit('remove', { track, index })
    this.#save()
    return true
  }

  move(fromIndex: number, toIndex: number) {
    if (fromIndex < 0 || fromIndex >= this.#tracks.length) return
    if (toIndex < 0 || toIndex >= this.#tracks.length) return
    const [track] = this.#tracks.splice(fromIndex, 1)
    this.#tracks.splice(toIndex, 0, track)
    this.#save()
  }

  swap(i: number, j: number) {
    if (i < 0 || i >= this.#tracks.length) return
    if (j < 0 || j >= this.#tracks.length) return
    ;[this.#tracks[i], this.#tracks[j]] = [this.#tracks[j], this.#tracks[i]]
    this.#save()
  }

  clear() {
    const tracks = [...this.#tracks]
    this.#history.push(...this.#tracks)
    this.#tracks = []
    this.#emit('clear', { tracks })
    this.#save()
  }

  shuffle() {
    for (let i = this.#tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.#tracks[i], this.#tracks[j]] = [this.#tracks[j], this.#tracks[i]]
    }
    this.#emit('shuffle', { tracks: [...this.#tracks] })
    this.#save()
  }

  sortBy(criteria: 'title' | 'author' | 'duration' | 'source', order: 'asc' | 'desc' = 'asc') {
    this.#tracks.sort((a, b) => {
      let cmp = 0
      switch (criteria) {
        case 'title': cmp = a.info.title.localeCompare(b.info.title); break
        case 'author': cmp = a.info.author.localeCompare(b.info.author); break
        case 'duration': cmp = a.info.duration - b.info.duration; break
        case 'source': cmp = a.source.localeCompare(b.source); break
      }
      return order === 'asc' ? cmp : -cmp
    })
    this.#save()
  }

  get(index: number): Track | undefined {
    return this.#tracks[index]
  }

  toArray(): Track[] {
    return [...this.#tracks]
  }

  isEmpty(): boolean {
    return this.#tracks.length === 0
  }

  isFull(maxSize: number): boolean {
    return maxSize > 0 && this.#tracks.length >= maxSize
  }

  resize(maxSize: number) {
    if (maxSize < this.#tracks.length) {
      this.#tracks.length = maxSize
    }
    this.#save()
  }

  get duration(): number {
    return this.#tracks.reduce((sum, t) => sum + t.info.duration, 0)
  }

  checkDJ(userId: string, userRoles: string[]): boolean {
    if (!this.#djCfg.enabled) return true
    if (this.#djCfg.bypassOnEmpty && this.#tracks.length === 0 && !this.#current) return true
    if (this.#djCfg.users?.includes(userId)) return true
    if (this.#djCfg.roles?.length && userRoles.some(r => this.#djCfg.roles!.includes(r))) return true
    return false
  }

  voteSkip(userId: string, track: Track): boolean {
    if (!this.#collabCfg.voteSkipEnabled) return false
    const key = track.encoded
    if (!this.#votes.has(key)) this.#votes.set(key, new Set())
    this.#votes.get(key)!.add(userId)
    const threshold = this.#collabCfg.minVotesToSkip ?? 3
    return this.#votes.get(key)!.size >= threshold
  }

  getNextTrack(): Track | null {
    if (this.#tracks.length > 0) return this.dequeue()
    if (this.#emptyRepeatMode === 'track' && this.#current) return this.#current
    if (this.#emptyRepeatMode === 'queue' && this.#history.length > 0) {
      this.#tracks = [...this.#history]
      this.#history = []
      return this.#tracks.shift() ?? null
    }
    return null
  }

  setCurrent(track: Track | null) {
    if (this.#current) {
      this.#history.push(this.#current)
      if (this.#maxHistorySize > 0 && this.#history.length > this.#maxHistorySize) {
        this.#history.splice(0, this.#history.length - this.#maxHistorySize)
      }
    }
    this.#current = track
  }

  #emit(type: QueueEventType, detail: QueueEventPayload[QueueEventType]) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  get current() { return this.#current }
  get all(): Track[] { return [...this.#tracks] }
  get history(): Track[] { return [...this.#history] }
  get length() { return this.#tracks.length }

  toJSON() {
    return {
      current: this.#current,
      queue: this.#tracks,
      history: this.#history,
    }
  }

  fromJSON(data: { current: Track | null; queue: Track[]; history: Track[] }) {
    this.#current = data.current ?? null
    this.#tracks = Array.isArray(data.queue) ? data.queue : []
    this.#history = Array.isArray(data.history) ? data.history : []
  }
}
