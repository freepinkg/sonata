import type { Track, PlayerState, FilterOptions } from '../types/index.js'
import { Queue } from './queue.js'
import { VoiceConnection } from './voice.js'
import { PlayerEvents } from './events.js'

export enum State { Stopped, Playing, Paused, Ended }

export interface PlayerEventHandlers {
  onTrackStart: (player: Player, track: Track) => void
  onTrackEnd: (player: Player, track: Track, reason: string) => void
  onTrackStuck: (player: Player, track: Track, threshold: number) => void
  onTrackException: (player: Player, track: Track, err: Error) => void
  onPlayerUpdate: (player: Player, state: PlayerState) => void
  onQueueEnd: (player: Player) => void
}

export class Player {
  readonly guildId: string
  readonly events = new PlayerEvents()
  #queue: Queue
  #state = State.Stopped
  #volume = 100
  #position = 0
  #lastUpdate = Date.now()
  #lastActive = Date.now()
  #voice: VoiceConnection | null = null
  #filters: FilterOptions = {}
  #events: PlayerEventHandlers
  #loopMode: 'none' | 'track' | 'queue' = 'none'

  constructor(guildId: string, events: PlayerEventHandlers, stickyFile = '', opts?: { defaultVolume?: number; shuffle?: boolean; maxHistorySize?: number; emptyRepeatMode?: 'none' | 'track' | 'queue'; perSourceLimits?: Record<string, number>; djMode?: any; collaborative?: any }) {
    this.guildId = guildId
    this.#events = events
    this.#queue = new Queue(stickyFile, {}, {
      maxHistorySize: opts?.maxHistorySize,
      emptyRepeatMode: opts?.emptyRepeatMode,
      perSourceLimits: opts?.perSourceLimits,
      djMode: opts?.djMode,
      collaborative: opts?.collaborative,
    })
    if (opts?.defaultVolume) this.#volume = opts.defaultVolume
    if (opts?.shuffle && this.#queue.length > 0) this.#queue.shuffle()
  }

  play(track?: Track | null) {
    if (!track) track = this.#queue.dequeue()
    if (!track) {
      track = this.#queue.getNextTrack()
    }
    if (!track) {
      this.#state = State.Stopped
      this.#events.onQueueEnd(this)
      this.#lastActive = Date.now()
      return
    }

    this.#queue.setCurrent(track)
    this.#state = State.Playing
    this.#position = 0
    this.#lastUpdate = Date.now()
    this.#lastActive = Date.now()
    this.#events.onTrackStart(this, track)
    this.events.emit('trackStart', { guildId: this.guildId, track })
  }

  stop() {
    this.#state = State.Stopped
    this.#position = 0
    this.#queue.clear()
    this.#lastActive = Date.now()
  }

  pause(): boolean {
    if (this.#state === State.Paused) return false
    if (this.#state === State.Playing) {
      this.#state = State.Paused
      this.#lastActive = Date.now()
      this.events.emit('pause', { guildId: this.guildId })
      return true
    }
    return false
  }

  resume(): boolean {
    if (this.#state === State.Paused) {
      this.#state = State.Playing
      this.#lastUpdate = Date.now()
      this.#lastActive = Date.now()
      this.events.emit('resume', { guildId: this.guildId })
      return true
    }
    return false
  }

  skip(reason?: string) {
    const track = this.#queue.current
    this.#state = State.Stopped
    this.#position = 0
    this.#lastActive = Date.now()
    if (track) {
      this.#events.onTrackEnd(this, track, reason ?? 'stopped')
      this.events.emit('trackEnd', { guildId: this.guildId, track, reason: reason ?? 'stopped' })
    }
  }

  setPosition(pos: number) {
    this.#position = pos
    this.#lastUpdate = Date.now()
    this.#lastActive = Date.now()
    this.events.emit('seek', { guildId: this.guildId, position: pos })
  }

  setVolume(v: number) {
    this.#volume = Math.max(0, Math.min(1000, v))
    this.#lastActive = Date.now()
    this.events.emit('volumeChange', { guildId: this.guildId, volume: this.#volume })
  }

  setVoice(vc: VoiceConnection) { this.#voice = vc }

  setFilters(f: FilterOptions) {
    this.#filters = f
    this.#lastActive = Date.now()
    this.events.emit('filterChange', { guildId: this.guildId, filters: f })
  }

  setLoop(mode: 'none' | 'track' | 'queue') { this.#loopMode = mode }
  loop(mode: 'none' | 'track' | 'queue') { this.#loopMode = mode }

  get state() { return this.#state }
  get stateName(): string { return State[this.#state] }
  get volume() { return this.#volume }
  get queue() { return this.#queue }
  get voice() { return this.#voice }
  get filters() { return { ...this.#filters } }
  get loopMode() { return this.#loopMode }

  get position(): number {
    if (this.#state === State.Playing) {
      return this.#position + (Date.now() - this.#lastUpdate)
    }
    return this.#position
  }

  get track(): Track | null {
    return this.#queue.current
  }

  isPlaying(): boolean { return this.#state === State.Playing }
  isPaused(): boolean { return this.#state === State.Paused }
  isConnected(): boolean { return this.#voice?.connected ?? false }

  getIdleTime(): number {
    return Date.now() - this.#lastActive
  }

  toState(): PlayerState {
    return {
      guildId: this.guildId,
      track: this.track ?? undefined,
      volume: this.#volume,
      paused: this.#state === State.Paused,
      position: this.position,
      connected: this.#voice?.connected ?? false,
      ping: this.#voice?.ping ?? 0,
    }
  }

  toSnapshot() {
    return {
      guildId: this.guildId,
      track: this.track,
      queue: this.#queue.toJSON(),
      position: this.position,
      volume: this.#volume,
      filters: this.#filters,
      paused: this.#state === State.Paused,
      loopMode: this.#loopMode,
      timestamp: Date.now(),
    }
  }

  fromSnapshot(snapshot: ReturnType<Player['toSnapshot']>) {
    this.#volume = snapshot.volume
    this.#filters = snapshot.filters
    this.#loopMode = snapshot.loopMode ?? 'none'
    this.#queue.fromJSON(snapshot.queue)
    if (snapshot.track) {
      this.#queue.setCurrent(snapshot.track)
    }
    if (snapshot.paused) {
      this.#state = State.Paused
    }
    this.#position = snapshot.position
  }
}
