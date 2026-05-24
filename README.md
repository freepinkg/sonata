# Sonata

High-performance Lavalink-compatible audio server for Discord bots. Written in TypeScript with native audio source resolvers.

## Features

- **Lavalink v4 + v3 API** — drop-in replacement, works with lavalink.js, lavasnek, etc.
- **Native audio resolvers** — YouTube (InnerTube API), SoundCloud, Spotify (via mirroring)
- **No yt-dlp** — direct API integrations like the official Lavalink
- **WebSocket events** — real-time track start/end, player updates, session resume
- **Player management** — play, pause, seek, volume, equalizer, filters
- **Queue system** — shuffle, loop (track/queue), remove, clear, history
- **Discord Gateway** — voice state updates, auto-reconnect
- **Route planner** — load balancing across IP blocks
- **Plugin system** — extend with custom audio sources
- **Prometheus metrics** — `/metrics` endpoint
- **Rate limiting** — per-token/IP
- **Structured logging** — text or JSON
- **Single process** — zero runtime deps (no JVM)
- **Docker** — multi-stage, 3 layers, 150MB

## Quick Start

```bash
# Install
npm install

# Build
npm run build

# Run
node dist/index.js

# Or with config
node dist/index.js sonata.json
```

### Docker

```bash
docker build -t sonata .
docker run -p 2333:2333 sonata
```

## Configuration

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 2333,
    "password": "youshallnotpass"
  },
  "logging": {
    "level": "info",
    "format": "text"
  },
  "sources": {
    "youtube": true,
    "soundcloud": true,
    "spotify": false
  },
  "lavalink": {
    "version": 4
  }
}
```

Environment variables: `SONATA_HOST`, `SONATA_PORT`, `SONATA_PASSWORD`, `SONATA_LOG_LEVEL`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`.

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
├── config/       # JSON config + env overrides
├── server/       # HTTP + WebSocket (Node built-in + ws)
├── lavalink/     # REST API v4/v3 + WS event system
├── player/       # Player, queue, voice connection
├── discord/      # Gateway + UDP voice
├── resolving/    # Audio source resolvers
│   ├── youtube/  # InnerTube API (WEB, MUSIC, ANDROID, IOS, TV)
│   ├── soundcloud/ # SoundCloud API
│   └── spotify/  # Spotify API + mirroring
├── audio/        # Mixer, filters (equalizer, timescale, etc.)
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
| Spotify | Web API + mirroring (YouTube) | `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` |

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
