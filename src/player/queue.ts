import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Track } from '../types/index.js'

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

  constructor(stickyFile = '') {
    super()
    if (stickyFile) {
      this.#stickyFile = stickyFile
      this.#restore()
    }
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

  enqueue(track: Track) {
    this.#tracks.push(track)
    this.#emit('add', { track, index: this.#tracks.length - 1 })
    this.#save()
  }

  dequeue(): Track | null {
    const track = this.#tracks.shift() ?? null
    if (track) this.#emit('remove', { track, index: 0 })
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

  setCurrent(track: Track | null) {
    if (this.#current) this.#history.push(this.#current)
    this.#current = track
  }

  #emit(type: QueueEventType, detail: QueueEventPayload[QueueEventType]) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  get current() { return this.#current }
  get all(): Track[] { return [...this.#tracks] }
  get history(): Track[] { return [...this.#history] }
  get length() { return this.#tracks.length }
}
