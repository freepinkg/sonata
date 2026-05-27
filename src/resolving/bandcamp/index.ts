import type { Track } from '../../types/index.js'
import type { AudioSource } from '../manager.js'
import type { MirroredTrack } from '../spotify/index.js'

const BC_REGEX = /^https?:\/\/(?:.+\.)?bandcamp\.com\//
const BC_PREFIX = /^bc(?:search)?:/i

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

export class BandcampSource implements AudioSource {
  name = 'bandcamp'

  matches(url: string): boolean {
    return BC_REGEX.test(url) || BC_PREFIX.test(url)
  }

  async resolve(query: string): Promise<Track[]> {
    if (BC_PREFIX.test(query)) return this.#search(query.replace(BC_PREFIX, '').trim())
    if (!this.matches(query)) return this.#search(query)
    try {
      const res = await fetch(query, { headers: { 'User-Agent': UA } })
      const html = await res.text()
      const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? 'Unknown'
      const author = html.match(/<meta property="og:site_name" content="([^"]+)"/)?.[1] ?? 'Bandcamp'
      return [this.#mirror(query, title, author)]
    } catch { return [] }
  }

  async resolveTrack(_id: string): Promise<Track | null> { return null }

  async #search(q: string): Promise<Track[]> {
    try {
      const res = await fetch(`https://bandcamp.com/search?q=${encodeURIComponent(q)}&page=1`, {
        headers: { 'User-Agent': UA },
      })
      const html = await res.text()
      const items: MirroredTrack[] = []
      const re = /href="(https:\/\/[^"]+\.bandcamp\.com\/track\/[^"]+)"[^]*?class="heading">([^<]+)<[^]*?class="subheading">([^<]+)</g
      let match
      while ((match = re.exec(html)) !== null && items.length < 10) {
        items.push(this.#mirror(match[1], match[2], match[3].trim()))
      }
      return items
    } catch { return [] }
  }

  #mirror(uri: string, title: string, author: string): MirroredTrack {
    return {
      encoded: Buffer.from(uri).toString('base64url'),
      needsResolve: true,
      resolveQuery: `ytsearch:${title} ${author}`,
      info: { identifier: uri, title, author, duration: 0, uri, artworkUrl: '', sourceName: 'bandcamp', isStream: false, position: 0 },
      source: 'bandcamp',
    }
  }
}
