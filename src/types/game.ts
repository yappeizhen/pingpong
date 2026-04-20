import type { Handedness } from './cv'

export type GamePhase =
  | 'idle'
  | 'waiting-for-camera'
  | 'ready'
  | 'countdown'
  | 'serving'
  | 'playing'
  | 'point-scored'
  | 'game-over'

export type GameMode = 'solo' | 'multiplayer'

export type Player = 'player1' | 'player2'

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Vector2 {
  x: number
  y: number
}

export interface BallState {
  position: Vector3
  velocity: Vector3
  spin: Vector2
  lastHitBy: Player | null
  isInPlay: boolean
}

export interface PaddleState {
  position: Vector2
  velocity: Vector2
  isActive: boolean
  isSwinging: boolean
  swipeSpeed: number
  hand: Handedness | null
}

export interface PlayerState {
  id: string
  name: string
  score: number
  paddle: PaddleState
  isServing: boolean
  connected: boolean
}

export interface GameState {
  phase: GamePhase
  mode: GameMode
  ball: BallState
  player1: PlayerState
  player2: PlayerState
  servingPlayer: Player
  lastScorer: Player | null
  rallyCount: number
  matchPoint: number
  seed: number
}

export interface HitEvent {
  player: Player
  position: Vector3
  velocity: Vector3
  timestamp: number
}

export interface PointEvent {
  winner: Player
  reason: 'out-of-bounds' | 'net-fault' | 'double-bounce' | 'miss'
  finalScore: { player1: number; player2: number }
}
