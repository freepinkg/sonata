declare module 'better-sqlite3' {
  interface Database {
    close(): void
  }
  interface DatabaseConstructor {
    new (path: string, options?: any): Database
    (path: string, options?: any): Database
  }
  const Database: DatabaseConstructor
  export default Database
}

declare module '@sentry/node' {
  export function init(options: any): void
}

declare module '@opentelemetry/sdk-node' {
  export class NodeSDK {
    constructor(options: any)
    start(): void
  }
}

declare module '@opentelemetry/auto-instrumentations-node' {
  export function getNodeAutoInstrumentations(): any
}

declare module '@opentelemetry/exporter-trace-otlp-http' {
  export class OTLPTraceExporter {
    constructor(options: any)
  }
}

declare module '@opentelemetry/resources' {
  export class Resource {
    constructor(attributes: any)
  }
}

declare module '@opentelemetry/semantic-conventions' {
  export const SemanticResourceAttributes: Record<string, string>
}
