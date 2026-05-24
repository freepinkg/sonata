declare module '@performanc/voice' {
  interface VoiceConnectionOptions {
    guildId: string
    userId: string
    channelId: string
    encryption: string | null
  }

  interface Connection {
    guildId: string
    userId: string
    channelId: string
    encryption: string | null
    state: { status: string; reason: string | null; code: number | null; closeReason: string | null }
    playerState: { status: string; reason: string | null }
    ping: number
    statistics: { packetsSent: number; packetsLost: number; packetsExpected: number }
    udpInfo: { ssrc: number; ip: string; port: number; secretKey: Buffer | null } | null

    connect(cb?: () => void, reconnection?: boolean): void
    voiceStateUpdate(obj: { session_id?: string; sessionId?: string }): void
    voiceServerUpdate(obj: { token: string; endpoint: string; channel_id?: string; channelId?: string }): void
    play(audioStream: import('node:stream').Readable): void
    stop(reason?: string): void
    pause(reason?: string): void
    unpause(reason?: string): void
    sendAudioChunk(chunk: Buffer): void
    destroy(): void
    on(event: string | symbol, listener: (...args: any[]) => void): this
    removeAllListeners(event?: string | symbol): this
  }

  interface VoiceModule {
    joinVoiceChannel(options: VoiceConnectionOptions): Connection
    getSpeakStream(ssrc: number, guildId: string): import('node:stream').Readable | null
  }

  const voiceModule: VoiceModule
  export default voiceModule
}
