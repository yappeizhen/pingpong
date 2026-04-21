import type {
  GameSyncMessage,
  PaddleSyncMessage,
  BallSyncMessage,
  ServeSyncMessage,
  ServeRequestSyncMessage,
  PointSyncMessage,
  GameStartSyncMessage,
  GameEndSyncMessage,
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
    this.transientChannel?.close()
    this.reliableChannel?.close()
    this.transientChannel = null
    this.reliableChannel = null
    this.messageHandlers.clear()
  }
}

export const gameSyncService = new GameSyncService()
