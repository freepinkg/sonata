export interface YouTubeFormat {
  itag: number
  url?: string
  cipher?: string
  signatureCipher?: string
  mimeType: string
  bitrate?: number
  contentLength?: string
  lastModified?: string
}

export function extractStreamUrl(format: YouTubeFormat): string | null {
  if (format.url) return format.url

  const cipherText = format.signatureCipher ?? format.cipher
  if (!cipherText) return null

  const params = new URLSearchParams(cipherText)
  const url = params.get('url')
  const sp = params.get('sp') ?? 'signature'
  const sig = params.get('s')

  if (!url) return null

  // If there's a signature, append it
  if (sig) {
    const decodedSig = decodeSignature(sig)
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}${sp}=${decodedSig}`
  }

  return url
}

export function selectBestAudioFormat(formats: YouTubeFormat[]): YouTubeFormat | null {
  if (!formats || formats.length === 0) return null

  // Filter audio-only formats (opus, mp4a)
  const audioFormats = formats.filter(f => {
    const mime = f.mimeType ?? ''
    return mime.includes('audio') &&
      (mime.includes('opus') || mime.includes('mp4a') || mime.includes('mp3'))
  })

  if (audioFormats.length === 0) return null

  // Sort by bitrate descending, prefer opus
  audioFormats.sort((a, b) => {
    const aOpus = a.mimeType.includes('opus') ? 100 : 0
    const bOpus = b.mimeType.includes('opus') ? 100 : 0
    return (bOpus + (b.bitrate ?? 0)) - (aOpus + (a.bitrate ?? 0))
  })

  return audioFormats[0]
}

function decodeSignature(sig: string): string {
  // Simple approach: reverse + some transformations
  // Real implementations need to mimic the JS from YouTube's player.js
  return sig.split('').reverse().join('')
}

export function getYouTubeStreamUrl(videoId: string, format: YouTubeFormat): string | null {
  const url = extractStreamUrl(format)
  if (!url) return null

  // Add range and other required params
  const urlObj = new URL(url)
  urlObj.searchParams.set('ratebypass', 'yes')
  return urlObj.toString()
}
