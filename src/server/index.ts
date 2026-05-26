import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createHttp2Server, createSecureServer as createHttp2SecureServer } from 'node:http2'
import { readFileSync } from 'node:fs'
import { brotliCompressSync, gzipSync, deflateSync } from 'node:zlib'
import { WebSocketServer } from '@sonata-sdk/ws/server'
import { createLogger, Logger } from '../utils/logger.js'
import type { HttpMethod } from '../types/index.js'

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, body?: any) => void | Promise<void>

interface RouteEntry {
  method: HttpMethod
  pattern: RegExp
  paramNames: string[]
  handler: Handler
}

interface SSLOpts {
  cert: string
  key: string
  ca?: string
  passphrase?: string
  secureOptions?: number
}

interface SecurityConfig {
  blockMethods?: string[]
  blockPaths?: string[]
  blockSqlInjection?: boolean
  blockXss?: boolean
  enforceContentType?: boolean
  hstsMaxAge?: number
  maxBodyDepth?: number
  requireUserAgent?: boolean
}

const SQLI_PATTERN = /(\b(union|select|insert|update|delete|drop|alter|create|truncate|exec|execute)\b.*\b(from|into|set|where|table|database|values)\b)|('?\s*--\s)|(\bOR\b\s+\d+\s*=\s*\d)|(\bAND\b\s+\d+\s*=\s*\d)/i
const XSS_PATTERN = /<script[\s>]|javascript\s*:|onerror\s*=|onload\s*=|onclick\s*=|onmouseover\s*=|eval\s*\(|alert\s*\(|document\.cookie|window\.location/i

export class Server {
  #routes: RouteEntry[] = []
  #server: any
  #wss = new WebSocketServer({ noServer: true })
  #wsPaths = new Map<string, { wss: WebSocketServer; auth: boolean }>()
  #logger: Logger
  #started = Date.now()
  #requestCount = 0
  #password: string
  #noAuthPaths: Set<string> = new Set()
  #preHandlers: ((req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>)[] = []
  #compression: boolean | string = false
  #security: SecurityConfig = {}
  #customHeaders: Record<string, string> = {}
  #correlationId: boolean = false
  #maxBodySize: number = 0
  #trustProxy: boolean = false
  #trustedIps: Set<string> = new Set()

  constructor(opts: { logger?: Logger; password?: string; ssl?: SSLOpts; compression?: boolean | string; http2?: boolean; security?: SecurityConfig; customHeaders?: Record<string, string>; correlationId?: boolean; maxBodySize?: number; socketTimeout?: number; keepAliveTimeout?: number; trustProxy?: boolean; trustedIps?: string[] }) {
    this.#logger = opts.logger ?? createLogger({ level: 'normal' })
    this.#password = opts.password ?? ''
    this.#compression = opts.compression ?? false
    this.#security = opts.security ?? {}
    this.#customHeaders = opts.customHeaders ?? {}
    this.#correlationId = opts.correlationId ?? false
    this.#maxBodySize = opts.maxBodySize ?? 0
    this.#trustProxy = opts.trustProxy ?? false
    this.#trustedIps = new Set(opts.trustedIps ?? [])

    if (opts.http2) {
      if (opts.ssl?.key && opts.ssl?.cert) {
        const sslOpts: any = {
          key: readFileSync(opts.ssl.key),
          cert: readFileSync(opts.ssl.cert),
          allowHTTP1: true,
        }
        if (opts.ssl.ca) sslOpts.ca = readFileSync(opts.ssl.ca)
        if (opts.ssl.passphrase) sslOpts.passphrase = opts.ssl.passphrase
        if (opts.ssl.secureOptions) sslOpts.secureOptions = opts.ssl.secureOptions
        this.#server = createHttp2SecureServer(sslOpts)
      } else {
        this.#server = createHttp2Server({ allowHTTP1: true } as any)
      }
    } else if (opts.ssl?.key && opts.ssl?.cert) {
      const sslOpts: any = {
        key: readFileSync(opts.ssl.key),
        cert: readFileSync(opts.ssl.cert),
      }
      if (opts.ssl.ca) sslOpts.ca = readFileSync(opts.ssl.ca)
      if (opts.ssl.passphrase) sslOpts.passphrase = opts.ssl.passphrase
      if (opts.ssl.secureOptions) sslOpts.secureOptions = opts.ssl.secureOptions

      this.#server = createHttpsServer(sslOpts)
    } else {
      this.#server = createServer()
    }

    this.#server.timeout = opts.socketTimeout ?? 0
    this.#server.keepAliveTimeout = opts.keepAliveTimeout ?? 5000
    this.#server.on('request', (req: IncomingMessage, res: ServerResponse) => this.#handle(req, res))
  }

  noAuth(path: string) { this.#noAuthPaths.add(path) }

  get logger() { return this.#logger }
  get wss() { return this.#wss as unknown as WebSocketServer }

  handle(method: HttpMethod, path: string, handler: Handler) {
    const paramNames: string[] = []
    const regexStr = path.replace(/{(\w+)}/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })
    this.#routes.push({ method, pattern: new RegExp(`^${regexStr}$`), paramNames, handler })
  }

  onPreHandle(fn: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>) {
    this.#preHandlers.push(fn)
  }

  ws(path: string, opts?: { auth?: boolean }): WebSocketServer {
    this.#wsPaths.set(path, { wss: this.#wss, auth: opts?.auth ?? true })
    return this.#wss
  }

  addWS(path: string, opts?: { auth?: boolean }): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true })
    this.#wsPaths.set(path, { wss, auth: opts?.auth ?? false })
    return wss
  }

  listen(port: number, host: string, cb?: () => void) {
    this.#server.on('upgrade', (req: any, socket: any, head: any) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
      const wsCfg = this.#wsPaths.get(url.pathname)
      if (wsCfg) {
        const auth = req.headers['authorization']
        if (wsCfg.auth && this.#password && auth !== this.#password) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }
        wsCfg.wss.handleUpgrade(req, socket, head, (ws: any) => wsCfg.wss.emit('connection', ws, req))
      } else socket.destroy()
    })
    this.#server.listen(port, host, () => {
      this.#logger.info('System', `Server listening on ${host}:${port}`)
      cb?.()
    })
  }

  close() { return new Promise<void>((resolve) => { this.#wss.close(); this.#server.close(() => resolve()) }) }

  stats() { return { uptime: Date.now() - this.#started, requests: this.#requestCount } }

  async #handle(req: IncomingMessage, res: ServerResponse) {
    this.#requestCount++
    const start = Date.now()
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const pathname = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()
    const sec = this.#security

    // Correlation ID
    if (this.#correlationId) {
      const cid = (req.headers['x-request-id'] as string) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      res.setHeader('X-Request-Id', cid);
      (req as any).correlationId = cid
    }

    // Blocked methods
    if (sec.blockMethods?.length && sec.blockMethods.includes(method)) {
      return this.#json(res, 405, { error: 'Method Not Allowed' })
    }

    // Blocked paths
    if (sec.blockPaths?.length) {
      for (const bp of sec.blockPaths) {
        if (pathname.startsWith(bp) || new RegExp(bp).test(pathname)) {
          return this.#json(res, 403, { error: 'Forbidden' })
        }
      }
    }

    // SQL Injection check
    if (sec.blockSqlInjection) {
      if (SQLI_PATTERN.test(pathname) || SQLI_PATTERN.test(req.headers['user-agent'] ?? '') || SQLI_PATTERN.test(req.headers['referer'] ?? '')) {
        return this.#json(res, 403, { error: 'Bad Request' })
      }
    }

    // XSS check
    if (sec.blockXss) {
      const ref = req.headers['referer'] ?? ''
      const ua = req.headers['user-agent'] ?? ''
      if (XSS_PATTERN.test(pathname) || XSS_PATTERN.test(ref) || XSS_PATTERN.test(ua)) {
        return this.#json(res, 403, { error: 'Bad Request' })
      }
    }

    // Content-Type enforcement
    if (sec.enforceContentType && ['POST', 'PUT', 'PATCH'].includes(method)) {
      const ct = req.headers['content-type'] ?? ''
      if (!ct.includes('application/json') && !ct.includes('text/plain') && !ct.includes('x-www-form-urlencoded')) {
        return this.#json(res, 415, { error: 'Unsupported Media Type' })
      }
    }

    // Require User-Agent
    if (sec.requireUserAgent && !req.headers['user-agent']) {
      return this.#json(res, 400, { error: 'User-Agent required' })
    }

    // Response headers
    res.setHeader('Server', 'Sonata/4.0.0')
    res.setHeader('Content-Type', 'application/json')
    if (sec.hstsMaxAge && sec.hstsMaxAge > 0) {
      res.setHeader('Strict-Transport-Security', `max-age=${sec.hstsMaxAge}; includeSubDomains`)
    }
    for (const [k, v] of Object.entries(this.#customHeaders)) {
      res.setHeader(k, v)
    }

    // Pre-handlers
    for (const fn of this.#preHandlers) {
      const handled = await fn(req, res)
      if (handled) return
    }

    // Client IP (trust proxy)
    let clientIp = ''
    if (this.#trustProxy || this.#trustedIps.size > 0) {
      clientIp = this.#trustProxy
        ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? ''
        : req.socket.remoteAddress ?? ''
    }

    // Auth
    if (this.#trustedIps.size > 0 && clientIp && this.#trustedIps.has(clientIp)) {
      // skip auth for trusted IPs
    } else if (this.#password && !this.#noAuthPaths.has(pathname)) {
      const auth = req.headers['authorization']
      if (auth !== this.#password) return this.#json(res, 401, { error: 'Unauthorized' })
    }

    for (const route of this.#routes) {
      if (route.method !== method) continue
      const match = pathname.match(route.pattern)
      if (!match) continue

      const params: Record<string, string> = {}
      for (let i = 0; i < route.paramNames.length; i++) params[route.paramNames[i]] = match[i + 1]

      this.#readBody(req, res, (body) => {
        Promise.resolve(route.handler(req, res, params, body))
          .catch((err) => {
            this.#logger.error('http', `request handler error: ${err.message || err}`)
            this.#json(res, 500, { error: 'Internal Server Error' })
          })
          .finally(() => {
            this.#logger.info('http', `${method} ${pathname} ${res.statusCode} ${Date.now() - start}ms`)
          })
      })
      return
    }

    this.#json(res, 404, { error: 'Not Found' })
  }

  #compress(req: IncomingMessage, body: Buffer): Buffer {
    if (!this.#compression) return body
    const accepted = req.headers['accept-encoding'] ?? ''
    if ((this.#compression === true || this.#compression === 'brotli') && accepted.includes('br')) return brotliCompressSync(body)
    if ((this.#compression === true || this.#compression === 'gzip') && accepted.includes('gzip')) return gzipSync(body)
    if ((this.#compression === true || this.#compression === 'deflate') && accepted.includes('deflate')) return deflateSync(body)
    return body
  }

  #readBody(req: IncomingMessage, res: ServerResponse, cb: (body: any) => void) {
    const ct = req.headers['content-type'] ?? ''
    if (!ct.includes('application/json') && !ct.includes('text/plain') && !ct.includes('x-www-form-urlencoded')) {
      return cb(undefined)
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (this.#maxBodySize > 0 && size > this.#maxBodySize) {
        chunks.length = 0
        req.destroy()
        this.#json(res, 413, { error: 'Payload Too Large' })
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (this.#maxBodySize > 0 && size > this.#maxBodySize) return
      const raw = Buffer.concat(chunks).toString()
      if (!raw) return cb(undefined)
      try { cb(JSON.parse(raw)) }
      catch { cb(raw) }
    })
  }

  #json(res: ServerResponse, status: number, data: unknown) {
    res.statusCode = status
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  }
}
