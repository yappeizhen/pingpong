import type {
  GameSyncMessage,
  PaddleSyncMessage,
  BallSyncMessage,
  ServeSyncMessage,
  ServeRequestSyncMessage,
  PointSyncMessage,
  GameStartSyncMessage,
  GameEndSyncMessage,
  TimeSyncPingMessage,
  TimeSyncPongMessage,
} from './types'
import type { PaddleState, BallState, Player } from '@/types/game'

export type MessageHandler = (message: GameSyncMessage) => void

export class GameSyncService {
  private transientChannel: RTCDataChannel | null = null
  private reliableChannel: RTCDataChannel | null = null
  private messageHandlers: Set<MessageHandler> = new Set()
  private isHost: boolean = false
  private ballSequence = 0
  private readonly transientBackpressureLimit = 128 * 1024
  private timeSyncTimer: ReturnType<typeof setInterval> | null = null
  private pendingPings = new Map<string, number>()
  private remoteClockOffsetMs = 0
  private estimatedRttMs = 0
  private hasTimeSync = false

  setDataChannel(channel: RTCDataChannel, isHost: boolean) {
    this.setDataChannels({ transient: channel }, isHost)
  }

  setDataChannels(
    channels: { transient?: RTCDataChannel; reliable?: RTCDataChannel },
    isHost: boolean
  ) {
    this.isHost = isHost
    this.ballSequence = 0

    if (channels.transient) {
      this.transientChannel = channels.transient
      this.bindChannel(this.transientChannel, 'transient')
    }
    if (channels.reliable) {
      this.reliableChannel = channels.reliable
      this.bindChannel(this.reliableChannel, 'reliable')
    }
  }

  attachDataChannel(channel: RTCDataChannel, isHost: boolean) {
    this.isHost = isHost

    const isReliableChannel = channel.label === 'gameSyncReliable'
    if (isReliableChannel) {
      this.reliableChannel = channel
      this.bindChannel(channel, 'reliable')
    } else {
      this.transientChannel = channel
      this.bindChannel(channel, 'transient')
    }
  }

  private bindChannel(channel: RTCDataChannel, channelType: 'transient' | 'reliable') {
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as GameSyncMessage
        if (this.handleInternalTimeSyncMessage(message)) {
          return
        }
        this.messageHandlers.forEach((handler) => handler(message))
      } catch {
        // Ignore parse errors
      }
    }

    channel.onclose = () => {
      if (channelType === 'transient' && this.transientChannel === channel) {
        this.transientChannel = null
      }
      if (channelType === 'reliable' && this.reliableChannel === channel) {
        this.reliableChannel = null
      }
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  private isTransientMessage(message: GameSyncMessage): boolean {
    return message.type === 'ball' || message.type === 'paddle'
  }

  private handleInternalTimeSyncMessage(message: GameSyncMessage): boolean {
    if (message.type === 'timesync-ping') {
      const t1 = Date.now()
      const pong: TimeSyncPongMessage = {
        type: 'timesync-pong',
        pingId: message.pingId,
        t0: message.t0,
        t1,
        t2: Date.now(),
        timestamp: Date.now(),
      }
      this.send(pong)
      return true
    }

    if (message.type === 'timesync-pong') {
      if (!this.pendingPings.has(message.pingId)) {
        return true
      }
      this.pendingPings.delete(message.pingId)

      const t3 = Date.now()
      const rtt = Math.max(0, t3 - message.t0)
      const offset = ((message.t1 - message.t0) + (message.t2 - t3)) / 2

      this.estimatedRttMs = this.hasTimeSync
        ? this.lerp(this.estimatedRttMs, rtt, 0.2)
        : rtt
      this.remoteClockOffsetMs = this.hasTimeSync
        ? this.lerp(this.remoteClockOffsetMs, offset, 0.2)
        : offset
      this.hasTimeSync = true
      return true
    }

    return false
  }

  private lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t
  }

  private getOpenChannel(channel: RTCDataChannel | null): RTCDataChannel | null {
    return channel?.readyState === 'open' ? channel : null
  }

  private selectChannel(message: GameSyncMessage): RTCDataChannel | null {
    const transient = this.getOpenChannel(this.transientChannel)
    const reliable = this.getOpenChannel(this.reliableChannel)

    if (this.isTransientMessage(message)) {
      return transient ?? reliable
    }
    return reliable ?? transient
  }

  private send(message: GameSyncMessage): boolean {
    const channel = this.selectChannel(message)
    if (!channel) {
      return false
    }

    if (
      this.isTransientMessage(message) &&
      channel === this.transientChannel &&
      channel.bufferedAmount > this.transientBackpressureLimit
    ) {
      return false
    }

    try {
      channel.send(JSON.stringify(message))
      return true
    } catch {
      // Ignore send errors
      return false
    }
  }

  sendPaddle(playerId: string, paddle: PaddleState) {
    const message: PaddleSyncMessage = {
      type: 'paddle',
      playerId,
      paddle,
      timestamp: Date.now(),
    }
    this.send(message)
  }

  sendBall(ball: BallState) {
    if (!this.isHost) return false

    const message: BallSyncMessage = {
      type: 'ball',
      ball,
      seq: ++this.ballSequence,
      timestamp: Date.now(),
    }
    return this.send(message)
  }

  sendTimeSyncPing() {
    const t0 = Date.now()
    const pingId = `${t0}-${Math.random().toString(36).slice(2, 10)}`
    const message: TimeSyncPingMessage = {
      type: 'timesync-ping',
      pingId,
      t0,
      timestamp: t0,
    }
    if (this.send(message)) {
      this.pendingPings.set(pingId, t0)
    }
  }

  startTimeSync(intervalMs = 2000) {
    if (this.timeSyncTimer) {
      clearInterval(this.timeSyncTimer)
      this.timeSyncTimer = null
    }
    this.sendTimeSyncPing()
    this.timeSyncTimer = setInterval(() => {
      this.sendTimeSyncPing()
    }, intervalMs)
  }

  stopTimeSync() {
    if (this.timeSyncTimer) {
      clearInterval(this.timeSyncTimer)
      this.timeSyncTimer = null
    }
    this.pendingPings.clear()
  }

  getRemoteMessageAgeMs(remoteTimestamp: number, receivedAtLocalMs = Date.now()): number {
    if (!Number.isFinite(remoteTimestamp)) {
      return 0
    }
    const adjustedRemoteLocalMs = this.hasTimeSync
      ? remoteTimestamp - this.remoteClockOffsetMs
      : remoteTimestamp
    return Math.max(0, receivedAtLocalMs - adjustedRemoteLocalMs)
  }

  getTimeSyncStats() {
    return {
      hasSync: this.hasTimeSync,
      clockOffsetMs: this.remoteClockOffsetMs,
      rttMs: this.estimatedRttMs,
    }
  }

  sendServe(player: Player, seed: number) {
    const message: ServeSyncMessage = {
      type: 'serve',
      player,
      seed,
      timestamp: Date.now(),
    }
    this.send(message)
  }

  sendServeRequest() {
    const message: ServeRequestSyncMessage = {
      type: 'serve-request',
      timestamp: Date.now(),
    }
    this.send(message)
  }

  sendPoint(winner: Player, reason: string, score: { player1: number; player2: number }) {
    const message: PointSyncMessage = {
      type: 'point',
      winner,
      reason,
      score,
      timestamp: Date.now(),
    }
    this.send(message)
  }

  sendGameStart(seed: number, servingPlayer: Player) {
    const message: GameStartSyncMessage = {
      type: 'game-start',
      seed,
      servingPlayer,
      timestamp: Date.now(),
    }
    this.send(message)
  }

  sendGameEnd(winnerId: string, finalScore: { player1: number; player2: number }) {
    const message: GameEndSyncMessage = {
      type: 'game-end',
      winnerId,
      finalScore,
      timestamp: Date.now(),
    }
    this.send(message)
  }

  isConnected(): boolean {
    return this.getOpenChannel(this.transientChannel) !== null ||
      this.getOpenChannel(this.reliableChannel) !== null
  }

  close() {
    this.stopTimeSync()
    this.transientChannel?.close()
    this.reliableChannel?.close()
    this.transientChannel = null
    this.reliableChannel = null
    this.hasTimeSync = false
    this.remoteClockOffsetMs = 0
    this.estimatedRttMs = 0
    this.messageHandlers.clear()
  }
}

export const gameSyncService = new GameSyncService()
