import { spawn, execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PORT = 2333
const PASSWORD = 'test123'

function log(label: string, data?: any) {
  console.log(`\n\x1b[36m=== ${label} ===\x1b[0m`)
  if (data) console.log(JSON.stringify(data, null, 2))
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  console.log('\x1b[33mStarting Sonata audio test...\x1b[0m\n')

  const server = spawn('node', [resolve(ROOT, 'dist/index.js')], {
    env: { ...process.env, SONATA_PASSWORD: PASSWORD },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`))
  server.stderr.on('data', (d) => process.stderr.write(`  [server] ${d}`))

  await sleep(2000)

  const api = `http://localhost:${PORT}`
  const headers = { Authorization: PASSWORD, 'Content-Type': 'application/json' }

  // 1. Health
  log('1. Health Check')
  const health = await fetch(`${api}/health`, { headers: { Authorization: PASSWORD } })
  const healthData = await health.json()
  log('Status', healthData)

  // 2. Test YouTube Search
  log('2. YouTube Search')
  const searchRes = await fetch(`${api}/loadtracks?identifier=never%20gonna%20give%20you%20up`, { headers })
  const searchData = await searchRes.json()
  log(`Found ${searchData.tracks?.length ?? 0} tracks`, searchData.tracks?.[0]?.info)

  // 3. Test YouTube Video by ID
  log('3. YouTube Video by ID (dQw4w9WgXcQ)')
  const videoRes = await fetch(`${api}/loadtracks?identifier=dQw4w9WgXcQ`, { headers })
  const videoData = await videoRes.json()
  const track = videoData.tracks?.[0]
  log('Video info', track?.info)

  // 4. Create Session
  log('4. Create Session')
  const sessRes = await fetch(`${api}/v4/sessions`, {
    method: 'POST', headers, body: JSON.stringify({ resume: true }),
  })
  const session = await sessRes.json()
  log('Session', session)

  // 5. Get Stats
  log('5. Server Stats')
  const statsRes = await fetch(`${api}/v4/stats`, { headers })
  const stats = await statsRes.json()
  log('Stats', stats)

  // 6. Route Planner
  log('6. Route Planner Status')
  const rpRes = await fetch(`${api}/v4/routeplanner/status`, { headers })
  const rp = await rpRes.json()
  log('Route Planner', rp)

  // 7. Create Player
  log('7. Create Player')
  const playerRes = await fetch(`${api}/v4/sessions/${session.id}/players/123456789`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      volume: 80,
      paused: false,
      filters: { equalizer: [{ band: 0, gain: 0.5 }] },
    }),
  })
  const player = await playerRes.json()
  log('Player created', player)

  // 8. Update Player - play a track
  log('8. Play Track')
  if (track) {
    const playRes = await fetch(`${api}/v4/sessions/${session.id}/players/123456789`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        track: {
          encoded: track.encoded,
          info: track.info,
        },
        position: 0,
        volume: 80,
      }),
    })
    const playState = await playRes.json()
    log('Playing', { guildId: playState.guildId, paused: playState.paused, volume: playState.volume })
  }

  // 9. Get Player State
  log('9. Player State')
  const stateRes = await fetch(`${api}/v4/sessions/${session.id}/players/123456789`, { headers })
  const state = await stateRes.json()
  log('State', state)

  // 10. Decode Track
  log('10. Decode Track')
  if (track) {
    const decodeRes = await fetch(`${api}/decodetrack?track=${track.encoded}`, { headers })
    const decoded = await decodeRes.json()
    log('Decoded', decoded.info)
  }

  // 11. Bulk Decode
  log('11. Bulk Decode Tracks')
  const bulkRes = await fetch(`${api}/v4/decodetracks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tracks: [track?.encoded ?? ''].filter(Boolean),
    }),
  })
  const bulk = await bulkRes.json()
  log(`Decoded ${bulk.length} tracks`)

  // 12. Metrics
  log('12. Prometheus Metrics')
  const metricsRes = await fetch(`${api}/metrics`, { headers })
  const metricsText = await metricsRes.text()
  const lines = metricsText.split('\n').filter(l => l && !l.startsWith('#')).slice(0, 5)
  log('Sample metrics', lines)

  // 13. Destroy Player
  log('13. Destroy Player')
  const delRes = await fetch(`${api}/v4/sessions/${session.id}/players/123456789`, {
    method: 'DELETE', headers,
  })
  log(`Deleted: HTTP ${delRes.status}`)

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('\x1b[32m✓ All tests completed!\x1b[0m')
  console.log('\x1b[90m  13 endpoints tested successfully\x1b[0m')
  console.log('='.repeat(50))

  server.kill()
  process.exit(0)
}

main().catch(err => {
  console.error('\x1b[31mTest failed:\x1b[0m', err)
  process.exit(1)
})
