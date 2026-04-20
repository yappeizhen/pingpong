import type { PaddleState, BallState, Player } from '@/types/game'

export type RoomState = 'waiting' | 'countdown' | 'playing' | 'finished'

export interface RoomPlayer {
  id: string
  name: string
  score: number
  connected: boolean
  lastActivity: number
  isHost: boolean
}

export interface Room {
  id: string
  code: string
  state: RoomState
  hostId: string
  seed: number
  createdAt: number
  startedAt?: number
  endedAt?: number
  winnerId?: string | null
  players: Record<string, RoomPlayer>
}

export interface RoomData {
  code: string
  state: RoomState
  hostId: string
  seed: number
  createdAt: number
  startedAt?: number
  endedAt?: number
  winnerId?: string | null
  players: Record<string, RoomPlayer>
}

export type SyncMessageType =
  | 'paddle'
  | 'ball'
  | 'serve'
  | 'point'
  | 'ready'
  | 'countdown'
  | 'game-start'
  | 'game-end'

export interface PaddleSyncMessage {
  type: 'paddle'
  playerId: string
  paddle: PaddleState
  timestamp: number
}

export interface BallSyncMessage {
  type: 'ball'
  ball: BallState
  timestamp: number
}

export interface ServeSyncMessage {
  type: 'serve'
  player: Player
  seed: number
  timestamp: number
}

export interface PointSyncMessage {
  type: 'point'
  winner: Player
  reason: string
  score: { player1: number; player2: number }
  timestamp: number
}

export interface ReadySyncMessage {
  type: 'ready'
  playerId: string
  timestamp: number
}

export interface CountdownSyncMessage {
  type: 'countdown'
  count: number
  timestamp: number
}

export interface GameStartSyncMessage {
  type: 'game-start'
  seed: number
  servingPlayer: Player
  timestamp: number
}

export interface GameEndSyncMessage {
  type: 'game-end'
  winnerId: string
  finalScore: { player1: number; player2: number }
  timestamp: number
}

export interface ServeRequestSyncMessage {
  type: 'serve-request'
  timestamp: number
}

export type GameSyncMessage =
  | PaddleSyncMessage
  | BallSyncMessage
  | ServeSyncMessage
  | ServeRequestSyncMessage
  | PointSyncMessage
  | ReadySyncMessage
  | CountdownSyncMessage
  | GameStartSyncMessage
  | GameEndSyncMessage

export interface WebRTCConnection {
  peerConnection: RTCPeerConnection
  dataChannel: RTCDataChannel | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  unsubscribes: Array<() => void>
}

export interface MultiplayerState {
  roomId: string | null
  roomCode: string | null
  room: Room | null
  roomState: RoomState
  isHost: boolean
  isConnected: boolean
  localPlayerId: string | null
  opponent: RoomPlayer | null
  opponentPaddle: PaddleState | null
  remoteBallState: BallState | null
  remoteStream: MediaStream | null
  dataChannel: RTCDataChannel | null
  connectionError: string | null
}
