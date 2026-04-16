import type {
  GameSyncMessage,
  PaddleSyncMessage,
  BallSyncMessage,
  ServeSyncMessage,
  PointSyncMessage,
  GameStartSyncMessage,
  GameEndSyncMessage,
} from './types'
import type { PaddleState, BallState, Player } from '@/types/game'

export type MessageHandler = (message: GameSyncMessage) => void

export class GameSyncService {
  private dataChannel: RTCDataChannel | null = null
  private messageHandlers: Set<MessageHandler> = new Set()
  private isHost: boolean = false

  setDataChannel(channel: RTCDataChannel, isHost: boolean) {
    this.dataChannel = channel
    this.isHost = isHost

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as GameSyncMessage
        this.messageHandlers.forEach((handler) => handler(message))
      } catch (error) {
        console.error('[GameSync] Failed to parse message:', error)
      }
    }

    channel.onerror = (error) => {
      console.error('[GameSync] Data channel error:', error)
    }

    channel.onclose = () => {
      console.log('[GameSync] Data channel closed')
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  private send(message: GameSyncMessage) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return
    }

    try {
      this.dataChannel.send(JSON.stringify(message))
    } catch (error) {
      console.error('[GameSync] Failed to send message:', error)
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
    if (!this.isHost) return

    const message: BallSyncMessage = {
      type: 'ball',
      ball,
      timestamp: Date.now(),
    }
    this.send(message)
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
    return this.dataChannel?.readyState === 'open'
  }

  close() {
    if (this.dataChannel) {
      this.dataChannel.close()
      this.dataChannel = null
    }
    this.messageHandlers.clear()
  }
}

export const gameSyncService = new GameSyncService()
