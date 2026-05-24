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
  if (!encoded) return null
  // Try base64 JSON first
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
  } catch {}
  // Try lavaclient v4 binary format
  try {
    const buf = Buffer.from(encoded, 'base64')
    if (buf.length < 5) throw new Error('too short')
    // Read version header: 4 bytes flags (top 2 bits indicate versioning)
    const flags = buf.readInt32BE(0)
    const topBits = (flags & 0xC0000000) >>> 30
    const versioned = (topBits & 1) !== 0
    let pos = 4
    const version = versioned ? buf[pos++] : 1
    // skip to data after header
    const readUTF = () => {
      const len = buf.readUInt16BE(pos); pos += 2
      const s = buf.toString('utf8', pos, pos + len); pos += len
      return s
    }
    const readLong = () => { const v = Number(buf.readBigInt64BE(pos)); pos += 8; return v }
    const readBool = () => { const v = buf[pos] !== 0; pos += 1; return v }
    const title = readUTF()
    const author = readUTF()
    const duration = readLong()
    const identifier = readUTF()
    const isStream = readBool()
    const hasUri = readBool()
    const uri = hasUri ? readUTF() : ''
    const sourceName = readUTF()
    // skip probeInfo for local/http sources
    if (sourceName === 'local' || sourceName === 'http') {
      readUTF()
    }
    // read position
    const position = readLong()
    return {
      encoded,
      info: { identifier, title, author, duration, uri, artworkUrl: '', sourceName, isStream, position: Number(position) },
      source: sourceName,
    }
  } catch (e) {
    console.log(`[Encoder] binary decode failed: ${e}`)
  }
  // Fallback: treat as raw YouTube identifier
  if (/^[a-zA-Z0-9_-]{11}$/.test(encoded)) {
    return {
      encoded,
      info: { identifier: encoded, title: 'Unknown', author: 'Unknown', duration: 0, uri: '', artworkUrl: '', sourceName: 'youtube', isStream: false, position: 0 },
      source: 'youtube',
    }
  }
  return null
}

export function decodeTracks(encoded: string[]): Track[] {
  return encoded.map(e => decodeTrack(e)).filter((t): t is Track => t !== null)
}
