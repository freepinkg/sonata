import type { IncomingMessage, ServerResponse } from 'node:http'

export interface DashboardConfig {
  title?: string
  theme?: 'light' | 'dark' | 'auto'
  refreshInterval?: number
  showTrackHistory?: boolean
  showPlayerControls?: boolean
  brandColor?: string
  customCss?: string
  logoUrl?: string
  footerText?: string
}

export function dashboardHandler(
  stats: () => { players: number; playing: number; uptime: number; sessions: number; memory: string; sources: string[] },
  cfg: DashboardConfig = {}
) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    const s = stats()
    const title = cfg.title ?? 'Sonata'
    const brandColor = cfg.brandColor ?? '#e94560'
    const bgColor = cfg.theme === 'light' ? '#f5f5f5' : '#1a1a2e'
    const cardBg = cfg.theme === 'light' ? '#fff' : '#16213e'
    const textColor = cfg.theme === 'light' ? '#333' : '#eee'
    const footerText = cfg.footerText ?? 'Sonata Audio Server'
    const customStyle = cfg.customCss ? `<style>${cfg.customCss}</style>` : ''
    const logo = cfg.logoUrl ? `<img src="${cfg.logoUrl}" style="max-height:48px;margin-bottom:.5rem">` : ''
    const refreshMeta = cfg.refreshInterval ? `<meta http-equiv="refresh" content="${Math.ceil(cfg.refreshInterval / 1000)}">` : ''

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refreshMeta}
<title>${title} Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${bgColor};color:${textColor};display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:${cardBg};border-radius:16px;padding:2rem;max-width:600px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.4)}
h1{color:${brandColor};font-size:1.8rem;margin-bottom:.5rem}
.sub{color:#888;margin-bottom:1.5rem;font-size:.9rem}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.stat{background:#0f3460;border-radius:12px;padding:1rem;text-align:center}
.stat .num{font-size:2rem;font-weight:700;color:${brandColor}}
.stat .lbl{font-size:.8rem;color:#aaa;margin-top:.25rem}
.bar{margin-top:1.5rem;background:#0f3460;border-radius:8px;overflow:hidden;height:6px}
.bar-fill{background:${brandColor};height:100%;transition:width 1s;border-radius:8px}
.sources{margin-top:1rem;display:flex;flex-wrap:wrap;gap:.3rem}
.sources span{background:#0f3460;padding:.2rem .6rem;border-radius:4px;font-size:.75rem;color:#aaa}
.footer{margin-top:1.5rem;text-align:center;font-size:.75rem;color:#555}
</style>${customStyle}</head><body>
<div class="card">
${logo}<h1>${title}</h1>
<div class="sub">Lavalink-compatible audio server</div>
<div class="grid">
<div class="stat"><div class="num">${s.players}</div><div class="lbl">Players</div></div>
<div class="stat"><div class="num">${s.playing}</div><div class="lbl">Playing</div></div>
<div class="stat"><div class="num">${Math.floor(s.uptime / 60)}m</div><div class="lbl">Uptime</div></div>
<div class="stat"><div class="num">${s.sessions}</div><div class="lbl">Sessions</div></div>
</div>
<div class="bar"><div class="bar-fill" style="width:${s.players ? Math.min(100, s.players * 10) : 0}%"></div></div>
<div class="sources">${s.sources.map(src => `<span>${src}</span>`).join('')}</div>
<div class="footer">Memory: ${s.memory} &middot; ${footerText}</div>
</div></body></html>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(html)
  }
}
