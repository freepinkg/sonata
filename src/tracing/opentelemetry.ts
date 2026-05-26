export interface OpenTelemetryConfig {
  enabled: boolean
  endpoint?: string
  serviceName?: string
  samplingRate?: number
  headers?: Record<string, string>
}

export async function initOpenTelemetry(cfg: OpenTelemetryConfig, logger: { info: Function; warn: Function }): Promise<void> {
  if (!cfg.enabled || !cfg.endpoint) return
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node')
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node')
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
    const { Resource } = await import('@opentelemetry/resources')
    const { SemanticResourceAttributes } = await import('@opentelemetry/semantic-conventions')

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: cfg.serviceName ?? 'sonata',
      }),
      traceExporter: new OTLPTraceExporter({
        url: cfg.endpoint,
        headers: cfg.headers,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    })
    sdk.start()
    logger.info('OpenTelemetry', `Initialized (endpoint: ${cfg.endpoint})`)
  } catch (err: any) {
    logger.warn('OpenTelemetry', `Failed to init: ${err.message}`)
  }
}
