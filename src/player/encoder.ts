import type { Track, TrackInfo } from '../types/index.js'

export function encodeTrack(track: Track): string {
  const data = JSON.stringify({
    v: 2,
    i: track.info.identifier,
    t: track.info.title,
    a: track.info.author,
    d: track.info.duration,
    u: track.info.uri,
    s: track.source,
  })
  return Buffer.from(data).toString('base64')
}

export function decodeTrack(encoded: string): Track | null {
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64').toString())
    return {
      encoded,
      info: {
        identifier: data.i ?? '',
        title: data.t ?? 'Unknown',
        author: data.a ?? 'Unknown',
        duration: data.d ?? 0,
        uri: data.u ?? '',
        artworkUrl: '',
        sourceName: data.s ?? 'unknown',
        isStream: false,
        position: 0,
      },
      source: data.s ?? 'unknown',
    }
  } catch {
    return null
  }
}

export function decodeTracks(encoded: string[]): Track[] {
  return encoded.map(e => decodeTrack(e)).filter((t): t is Track => t !== null)
}
