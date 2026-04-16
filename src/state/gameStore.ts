import { create } from 'zustand'
import type { GameState, GamePhase, GameMode, Player, BallState, PaddleState } from '@/types'
import { GAME } from '@/game/constants'

interface GameStore extends GameState {
  setPhase: (phase: GamePhase) => void
  setMode: (mode: GameMode) => void
  setBall: (ball: Partial<BallState>) => void
  setPlayer1Paddle: (paddle: Partial<PaddleState>) => void
  setPlayer2Paddle: (paddle: Partial<PaddleState>) => void
  scorePoint: (winner: Player) => void
  setServingPlayer: (player: Player) => void
  incrementRally: () => void
  resetRally: () => void
  setSeed: (seed: number) => void
  resetGame: () => void
  startNewGame: (mode: GameMode) => void
}

const initialPaddle: PaddleState = {
  position: { x: 0.5, y: 0.5 },
  velocity: { x: 0, y: 0 },
  isActive: false,
  isSwinging: false,
  swipeSpeed: 0,
  hand: null,
}

const initialBall: BallState = {
  position: { x: 0, y: 0.96, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  spin: { x: 0, y: 0 },
  lastHitBy: null,
  isInPlay: false,
}

const initialPlayer2 = {
  id: 'player2',
  name: 'AI',
  score: 0,
  paddle: initialPaddle,
  isServing: false,
  connected: true,
}

const getInitialState = (): GameState => ({
  phase: 'idle',
  mode: 'solo',
  ball: initialBall,
  player1: {
    id: 'player1',
    name: 'You',
    score: 0,
    paddle: initialPaddle,
    isServing: true,
    connected: true,
  },
  player2: { ...initialPlayer2 },
  servingPlayer: 'player1',
  rallyCount: 0,
  matchPoint: GAME.POINTS_TO_WIN,
  seed: Date.now(),
})

export const useGameStore = create<GameStore>((set, get) => ({
  ...getInitialState(),

  setPhase: (phase) => set({ phase }),

  setMode: (mode) => set({ mode }),

  setBall: (ball) =>
    set((state) => ({
      ball: { ...state.ball, ...ball },
    })),

  setPlayer1Paddle: (paddle) =>
    set((state) => ({
      player1: {
        ...state.player1,
        paddle: { ...state.player1.paddle, ...paddle },
      },
    })),

  setPlayer2Paddle: (paddle) =>
    set((state) => ({
      player2: {
        ...state.player2,
        paddle: { ...state.player2.paddle, ...paddle },
      },
    })),

  scorePoint: (winner) => {
    const state = get()
    const newScore1 = winner === 'player1' ? state.player1.score + 1 : state.player1.score
    const newScore2 = winner === 'player2' ? state.player2.score + 1 : state.player2.score

    const totalPoints = newScore1 + newScore2
    const serveSwitch = totalPoints % GAME.SERVE_SWITCH_INTERVAL === 0
    const newServer = serveSwitch
      ? state.servingPlayer === 'player1'
        ? 'player2'
        : 'player1'
      : state.servingPlayer

    const gameOver = newScore1 >= GAME.POINTS_TO_WIN || newScore2 >= GAME.POINTS_TO_WIN

    set({
      player1: { ...state.player1, score: newScore1, isServing: newServer === 'player1' },
      player2: { ...state.player2, score: newScore2, isServing: newServer === 'player2' },
      servingPlayer: newServer,
      rallyCount: 0,
      phase: gameOver ? 'game-over' : 'point-scored',
    })
  },

  setServingPlayer: (player) =>
    set((state) => ({
      servingPlayer: player,
      player1: { ...state.player1, isServing: player === 'player1' },
      player2: { ...state.player2, isServing: player === 'player2' },
    })),

  incrementRally: () => set((state) => ({ rallyCount: state.rallyCount + 1 })),

  resetRally: () => set({ rallyCount: 0 }),

  setSeed: (seed) => set({ seed }),

  resetGame: () =>
    set({
      ...getInitialState(),
    }),

  startNewGame: (mode) =>
    set({
      ...getInitialState(),
      mode,
      phase: 'waiting-for-camera',
      player2: {
        ...initialPlayer2,
        name: mode === 'multiplayer' ? 'Opponent' : 'AI',
      },
    }),
}))
