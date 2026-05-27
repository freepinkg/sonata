#!/usr/bin/env node
const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
  const { VERSION, BUILD, NAME } = await import('../dist/version.js')
  console.log(`${NAME} v${VERSION} (build ${BUILD})`)
  process.exit(0)
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Sonata — Lavalink-compatible audio server

  Usage:
    sonata [config-path]

  Options:
    -v, --version       Show version
    -h, --help          Show this help
    --build             Clone repo, install deps, and build

  Examples:
    sonata                          Start with default config (./config.js)
    sonata /etc/sonata/config.js    Start with custom config
    sonata --build                  Clone and build from GitHub
`.trim())
  process.exit(0)
}

if (args.includes('--build')) {
  const { execSync } = await import('child_process')
  const { resolve } = await import('path')
  const { readFileSync } = await import('fs')
  const repo = 'https://github.com/sonata-sdk/sonata.git'
  const dir = resolve(process.cwd(), 'sonata')

  console.log(`\n  Cloning ${repo}...`)
  execSync(`git clone ${repo} "${dir}"`, { stdio: 'inherit' })

  console.log('\n  Installing dependencies...')
  execSync('npm install', { cwd: dir, stdio: 'inherit' })

  console.log('\n  Building...')
  execSync('npm run build', { cwd: dir, stdio: 'inherit' })

  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf-8'))
    console.log(`\n  Done — ${pkg.name} v${pkg.version} ready at ${dir}`)
  } catch {
    console.log(`\n  Done — sonata ready at ${dir}`)
  }

  console.log(`  Run: cd sonata && node bin/sonata.js --help`)
  process.exit(0)
}

import('../dist/index.js').catch(() => {
  import('tsx').then(() => import('../src/index.ts'))
})
