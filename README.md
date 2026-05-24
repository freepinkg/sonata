# Sonata

High-performance Lavalink-compatible audio server for Discord bots. Written in TypeScript with native audio source resolvers.

## Features

- **Lavalink v4 + v3 API** — drop-in replacement
- **Native audio resolvers** — YouTube (InnerTube API), SoundCloud, Spotify
- **No yt-dlp** — direct API integrations like the official Lavalink
- **C++ native addon** — OPUS encoder/decoder, audio mixer (volume, rotation, channel mix, low-pass)
- **WebSocket events** — real-time track start/end, player updates, session resume
- **Player management** — play, pause, seek, volume, equalizer, filters
- **Queue system** — shuffle, loop (track/queue), remove, clear, history
- **Discord Gateway** — voice state updates, auto-reconnect
- **Discord Voice** — UDP connection, RTP, xsalsa20_poly1305 encryption
- **Route planner** — load balancing across IP blocks
- **Plugin system** — extend with custom audio sources
- **Prometheus metrics** — `/metrics` endpoint
- **Rate limiting** — configurable per-window
- **Structured logging** — text or JSON, file output supported
- **Docker** — multi-stage with native addon

## Quick Start

```bash
# Install
npm install

# Build
npm run build

# Run (looks for config.js in current dir, or pass path)
node dist/index.js

# With custom config
node dist/index.js /path/to/config.js
```

### Docker

```bash
docker build -t sonata .
docker run -p 2333:2333 sonata
```

## Configuration

Sonata uses a JavaScript config file (`config.js` by default). Copy `config.example.js` and edit:

```bash
cp config.example.js config.js
```

All options are documented in [`config.example.js`](config.example.js) with inline comments. Key sections:

| Section | Purpose |
|---------|---------|
| `server` | Host, port, password, socket timeout |
| `logging` | Level (debug/info/warn/error), format (text/json), file output |
| `sources` | Enable/disable audio sources (youtube, soundcloud, spotify, http, local) |
| `lavalink` | API version (3/4), session resume timeout |
| `voice` | UDP mode, external address, port range |
| `queue` | History size, default volume |
| `metrics` | Prometheus exporter settings |
| `rateLimiting` | Request throttling |
| `plugins` | Plugin paths and configs |
| `clustering` | Multi-node setup |

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/loadtracks?identifier=` | Search/load tracks |
| `GET` | `/decodetrack?track=` | Decode a single track |
| `POST` | `/v4/decodetracks` | Decode multiple tracks |
| `POST` | `/v4/sessions` | Create session |
| `GET` | `/v4/sessions/{id}` | Get session |
| `PATCH` | `/v4/sessions/{id}` | Update session |
| `DELETE` | `/v4/sessions/{id}` | Destroy session |
| `GET` | `/v4/sessions/{id}/players` | List players |
| `GET` | `/v4/sessions/{id}/players/{guildId}` | Get player |
| `PATCH` | `/v4/sessions/{id}/players/{guildId}` | Control playback |
| `DELETE` | `/v4/sessions/{id}/players/{guildId}` | Destroy player |
| `POST` | `/v4/sessions/{id}/players/{guildId}/voice` | Voice update |
| `GET` | `/v4/stats` | Server statistics |
| `GET` | `/v4/routeplanner/status` | Route planner status |
| `POST` | `/v4/routeplanner/free/address` | Free failed address |
| `POST` | `/v4/routeplanner/free/all` | Free all addresses |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/health` | Health check |

### Running without build

```bash
# One-shot (no build needed)
npx tsx src/index.ts

# Watch mode (auto-restart on changes)
npm run dev

# Or with explicit watch
npx tsx watch src/index.ts
```

### Search prefixes

| Prefix | Source | Example |
|--------|--------|---------|
| URL | YouTube | `https://youtube.com/watch?v=dQw4w9WgXcQ` |
| URL | SoundCloud | `https://soundcloud.com/user/track` |
| URL | Spotify | `https://open.spotify.com/track/...` |
| text | YouTube search | `never gonna give you up` |

## Architecture

```
src/
├── config/       # config.js module loader
├── server/       # HTTP + WebSocket (Node built-in + ws)
├── lavalink/     # REST API v4/v3 + WS event system
├── player/       # Player, queue, voice connection
├── discord/      # Gateway + UDP voice
├── resolving/    # Audio source resolvers
│   ├── youtube/  # InnerTube API (WEB, MUSIC, ANDROID, IOS, TV)
│   ├── soundcloud/ # SoundCloud API
│   └── spotify/  # Spotify API + mirroring
├── audio/        # Mixer, filters (equalizer, timescale, etc.)
├── native/       # C++ addon (OPUS encoder/decoder, mixer)
├── plugin/       # Plugin system
├── metrics/      # Prometheus metrics
├── middleware/   # Auth, logging, rate limiting
└── types/        # Shared TypeScript types
```

## Audio sources

| Source | Method | Auth |
|--------|--------|------|
| YouTube | InnerTube API (5 client profiles) | None |
| SoundCloud | Public API + client ID | None |
| Spotify | Web API + mirroring (YouTube) | `clientId` + `clientSecret` in config.js |

## Plugin system

Plugins implement `AudioPlayerManagerConfiguration` to register custom `AudioSourceManager` instances:

```typescript
import { pluginManager } from 'sonata'
import { MySource } from './my-source'

pluginManager.register({
  name: 'my-plugin',
  version: '1.0.0',
  install(ctx) {
    // Register event hooks
    ctx.onTrackStart((guildId, track) => {
      console.log(`Playing ${track.info.title} in ${guildId}`)
    })
  },
})
```

## Development

```bash
# Type check
npm run typecheck

# Test
npm test

# Watch mode
npm run dev

# Build
npm run build
```

## Benchmark

| Metric | Sonata | Lavalink (Java) |
|--------|--------|-----------------|
| Binary size | ~5MB (JS) | ~100MB (JAR + JRE) |
| RAM (idle) | ~15MB | ~300MB |
| RAM (10 players) | ~30MB | ~500MB |
| Startup | ~200ms | ~10s |
| Dependencies | Node.js | JRE 17+ |

## License

MIT
