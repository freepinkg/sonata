import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface NativeModule {
  createEncoder(opts?: { sampleRate?: number; channels?: number; frameSize?: number }): any
  createDecoder(opts?: { sampleRate?: number; channels?: number }): any
  createMixer(): any
  opusVersion: string
}

function loadNative(): NativeModule {
  const paths = [
    resolve(__dirname, '../../build/Release/sonata_native.node'),
    resolve(__dirname, '../../build/Debug/sonata_native.node'),
    resolve(__dirname, '../../prebuilds/linux-x64/sonata_native.node'),
  ]

  for (const p of paths) {
    if (existsSync(p)) {
      return createRequire(import.meta.url)(p) as NativeModule
    }
  }

  throw new Error(
    'sonata_native not found. Run: npm run build:native'
  )
}

let native: NativeModule | null = null

export function getNative(): NativeModule {
  if (!native) {
    native = loadNative()
  }
  return native
}

export interface EncoderOptions {
  sampleRate?: number
  channels?: number
  frameSize?: number
}

export interface MixerOptions {
  volume?: number
  rotationHz?: number
  channelMixLtoL?: number
  channelMixLtoR?: number
  channelMixRtoR?: number
  channelMixRtoL?: number
  lowPassCoeff?: number
  sampleRate?: number
  channels?: number
}

export class OpusEncoder {
  private _inner: any

  constructor(opts?: EncoderOptions) {
    this._inner = getNative().createEncoder(opts || {})
  }

  get sampleRate(): number { return this._inner.sampleRate }
  get channels(): number { return this._inner.channels }
  get frameSize(): number { return this._inner.frameSize }
  get destroyed(): boolean { return this._inner.destroyed }

  encode(pcm: Buffer): Buffer {
    return this._inner.encode(pcm)
  }

  destroy() {
    this._inner.destroy()
    this._inner = null
  }
}

export class OpusDecoder {
  private _inner: any

  constructor(opts?: { sampleRate?: number; channels?: number }) {
    this._inner = getNative().createDecoder(opts || {})
  }

  get sampleRate(): number { return this._inner.sampleRate }
  get channels(): number { return this._inner.channels }
  get destroyed(): boolean { return this._inner.destroyed }

  decode(opus: Buffer): Buffer {
    return this._inner.decode(opus)
  }

  destroy() {
    this._inner.destroy()
    this._inner = null
  }
}

export class AudioMixer {
  private _inner: any

  constructor() {
    this._inner = getNative().createMixer()
  }

  get destroyed(): boolean { return this._inner.destroyed }

  apply(pcm: Buffer, opts?: MixerOptions): Buffer {
    return this._inner.apply(pcm, opts || {})
  }

  destroy() {
    this._inner.destroy()
    this._inner = null
  }
}

export const OPUS_VERSION: string = getNative().opusVersion
