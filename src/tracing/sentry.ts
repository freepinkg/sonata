export interface SentryConfig {
  enabled: boolean
  dsn?: string
  environment?: string
  tracesSampleRate?: number
  attachStacktrace?: boolean
}

export async function initSentry(cfg: SentryConfig, logger: { info: Function; warn: Function }): Promise<void> {
  if (!cfg.enabled || !cfg.dsn) return
  try {
    const Sentry = await import('@sentry/node')
    Sentry.init({
      dsn: cfg.dsn,
      environment: cfg.environment ?? 'production',
      tracesSampleRate: cfg.tracesSampleRate ?? 0.1,
      attachStacktrace: cfg.attachStacktrace ?? true,
    })
    logger.info('Sentry', `Initialized (env: ${cfg.environment ?? 'production'})`)
  } catch (err: any) {
    logger.warn('Sentry', `Failed to init: ${err.message}`)
  }
}
