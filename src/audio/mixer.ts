import type { FilterOptions, Band } from '../types/index.js'

export interface ProcessedFilters {
  volume: number
  equalizer: number[]
  timescale: { speed: number; pitch: number; rate: number } | null
  tremolo: { frequency: number; depth: number } | null
  vibrato: { frequency: number; depth: number } | null
  rotation: { rotationHz: number } | null
  distortion: { [key: string]: number } | null
  channelMix: { [key: string]: number } | null
  lowPass: { smoothing: number } | null
  karaoke: { [key: string]: number } | null
}

export class AudioMixer {
  #filters: FilterOptions = {}
  #bands: Band[] = Array.from({ length: 15 }, (_, i) => ({ band: i, gain: 0 }))
  #volume = 1.0

  setVolume(v: number) { this.#volume = Math.max(0, Math.min(1, v / 100)) }
  get volume() { return Math.round(this.#volume * 100) }

  setFilters(f: FilterOptions) {
    this.#filters = { ...f }
    if (f.equalizer) this.setEqualizer(f.equalizer)
    if (f.volume !== undefined) this.setVolume(f.volume)
  }

  setEqualizer(bands: Band[]) {
    for (const b of bands) {
      if (b.band >= 0 && b.band < 15) this.#bands[b.band] = b
    }
  }

  resetEqualizer() {
    this.#bands = Array.from({ length: 15 }, (_, i) => ({ band: i, gain: 0 }))
  }

  process(): ProcessedFilters {
    return {
      volume: this.#volume,
      equalizer: this.#bands.map(b => b.gain),
      timescale: this.#filters.timescale as ProcessedFilters['timescale'] ?? null,
      tremolo: this.#filters.tremolo as ProcessedFilters['tremolo'] ?? null,
      vibrato: this.#filters.vibrato as ProcessedFilters['vibrato'] ?? null,
      rotation: this.#filters.rotation as ProcessedFilters['rotation'] ?? null,
      distortion: this.#filters.distortion as ProcessedFilters['distortion'] ?? null,
      channelMix: this.#filters.channelMix as ProcessedFilters['channelMix'] ?? null,
      lowPass: this.#filters.lowPass as ProcessedFilters['lowPass'] ?? null,
      karaoke: this.#filters.karaoke as ProcessedFilters['karaoke'] ?? null,
    }
  }

  get filters(): FilterOptions {
    return {
      ...this.#filters,
      equalizer: [...this.#bands],
      volume: this.#volume * 100,
    }
  }
}
