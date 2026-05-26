export interface EQBand {
  band: number
  gain: number
}

export interface EQPreset {
  name: string
  label: string
  description: string
  bands: EQBand[]
}

export const EQ_PRESETS: Record<string, EQPreset> = {
  flat: {
    name: 'flat',
    label: 'Flat',
    description: 'No equalization',
    bands: [],
  },
  bassBoost: {
    name: 'bassBoost',
    label: 'Bass Boost',
    description: 'Enhanced low frequencies',
    bands: [
      { band: 0, gain: 0.25 }, { band: 1, gain: 0.2 },
      { band: 2, gain: 0.15 }, { band: 3, gain: 0.1 },
    ],
  },
  bassReducer: {
    name: 'bassReducer',
    label: 'Bass Reducer',
    description: 'Reduced low frequencies',
    bands: [
      { band: 0, gain: -0.2 }, { band: 1, gain: -0.15 },
      { band: 2, gain: -0.1 }, { band: 3, gain: -0.05 },
    ],
  },
  vocal: {
    name: 'vocal',
    label: 'Vocal Boost',
    description: 'Enhanced vocals and midrange',
    bands: [
      { band: 3, gain: -0.1 }, { band: 4, gain: 0.05 },
      { band: 5, gain: 0.1 }, { band: 6, gain: 0.15 },
      { band: 7, gain: 0.2 }, { band: 8, gain: 0.1 },
    ],
  },
  electronic: {
    name: 'electronic',
    label: 'Electronic',
    description: 'Emphasized highs for electronic music',
    bands: [
      { band: 0, gain: 0.15 }, { band: 1, gain: 0.1 },
      { band: 6, gain: 0.1 }, { band: 7, gain: 0.15 },
      { band: 8, gain: 0.2 }, { band: 9, gain: 0.15 },
    ],
  },
  classical: {
    name: 'classical',
    label: 'Classical',
    description: 'Wide soundstage for classical music',
    bands: [
      { band: 0, gain: 0.1 }, { band: 1, gain: 0.05 },
      { band: 2, gain: 0.05 }, { band: 7, gain: 0.05 },
      { band: 8, gain: 0.1 }, { band: 9, gain: 0.1 },
      { band: 10, gain: 0.05 },
    ],
  },
  jazz: {
    name: 'jazz',
    label: 'Jazz',
    description: 'Warm sound for jazz',
    bands: [
      { band: 0, gain: 0.1 }, { band: 1, gain: 0.1 },
      { band: 2, gain: 0.05 }, { band: 3, gain: 0.05 },
      { band: 7, gain: 0.05 }, { band: 8, gain: 0.1 },
    ],
  },
  trebleBoost: {
    name: 'trebleBoost',
    label: 'Treble Boost',
    description: 'Enhanced high frequencies',
    bands: [
      { band: 8, gain: 0.1 }, { band: 9, gain: 0.15 },
      { band: 10, gain: 0.2 }, { band: 11, gain: 0.15 },
      { band: 12, gain: 0.1 }, { band: 13, gain: 0.05 },
    ],
  },
  night: {
    name: 'night',
    label: 'Night Mode',
    description: 'Reduced dynamic range for low-volume listening',
    bands: [
      { band: 0, gain: -0.1 }, { band: 1, gain: -0.05 },
      { band: 10, gain: -0.1 }, { band: 11, gain: -0.15 },
    ],
  },
  custom: {
    name: 'custom',
    label: 'Custom',
    description: 'User-defined equalizer',
    bands: [],
  },
}

export function getPreset(name: string): EQPreset | undefined {
  return EQ_PRESETS[name]
}

export function listPresets(): { name: string; label: string; description: string }[] {
  return Object.values(EQ_PRESETS).map(({ name, label, description }) => ({ name, label, description }))
}
