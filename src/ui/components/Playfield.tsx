import { useRef, useEffect, useCallback } from 'react'
import { PongGame } from '@/game'
import { AIController } from '@/game/AIController'
import { useHandData } from '@/cv'
import { useHandController, type HandControllerState } from '@/hooks'
import { useGameStore } from '@/state'
import { DebugPanel } from './DebugPanel'
import { GameHUD } from './GameHUD'
import { HandOverlay } from './HandOverlay'
import {
  CountdownOverlay,
  PointScoredOverlay,
  GameOverOverlay,
  LoadingOverlay,
  ErrorOverlay,
} from './GameOverlays'
import './Playfield.css'

export function Playfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<PongGame | null>(null)
  const aiRef = useRef<AIController | null>(null)
  const lastAiUpdateRef = useRef<number>(0)

  const { status, startTracking, stopTracking } = useHandData()

  const {
    phase,
    player1,
    player2,
    servingPlayer,
    lastScorer,
    seed,
    setPhase,
    scorePoint,
    resetGame,
  } = useGameStore()

  const handlePaddleUpdate = useCallback(
    (state: HandControllerState) => {
      if (!gameRef.current) return
      gameRef.current.setPlayer1Paddle({
        position: state.position,
        velocity: state.velocity,
        isActive: state.isActive,
        isSwinging: state.isSwinging,
        swipeSpeed: state.swipeSpeed,
        hand: state.hand,
      })
    },
    []
  )

  useHandController({
    preferredHand: 'Right',
    onStateChange: handlePaddleUpdate,
  })

  useEffect(() => {
    if (!canvasRef.current) return

    const game = new PongGame(canvasRef.current)
    gameRef.current = game
    aiRef.current = new AIController()

    game.setOnPoint((winner) => {
      scorePoint(winner)
    })

    game.start()

    return () => {
      game.dispose()
      gameRef.current = null
      aiRef.current = null
    }
  }, [scorePoint])

  useEffect(() => {
    if (phase === 'waiting-for-camera' && status === 'idle') {
      if (videoRef.current) {
        startTracking(videoRef.current).catch((err) => {
          console.error('[Playfield] Failed to start tracking:', err)
        })
      }
    }
  }, [phase, status, startTracking])

  useEffect(() => {
    if (phase === 'waiting-for-camera' && status === 'ready') {
      setPhase('ready')
    }
  }, [phase, status, setPhase])

  useEffect(() => {
    if (phase === 'ready') {
      const timer = setTimeout(() => setPhase('countdown'), 1000)
      return () => clearTimeout(timer)
    }
  }, [phase, setPhase])

  const handleCountdownComplete = useCallback(() => {
    gameRef.current?.serve(servingPlayer, seed)
    setPhase('playing')
  }, [servingPlayer, seed, setPhase])

  useEffect(() => {
    if (phase === 'point-scored') {
      gameRef.current?.reset()
      const timer = setTimeout(() => {
        gameRef.current?.serve(servingPlayer, seed)
        setPhase('playing')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [phase, servingPlayer, seed, setPhase])

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'serving') return
    if (!gameRef.current || !aiRef.current) return

    let animationId: number

    const updateAI = () => {
      if (!gameRef.current || !aiRef.current) return

      const now = performance.now()
      const deltaTime = Math.min((now - lastAiUpdateRef.current) / 1000, 0.1)
      lastAiUpdateRef.current = now

      const ballState = gameRef.current.getBallState()
      const aiPaddle = aiRef.current.update(ballState, deltaTime)

      gameRef.current.setPlayer2Paddle(aiPaddle)

      animationId = requestAnimationFrame(updateAI)
    }

    lastAiUpdateRef.current = performance.now()
    animationId = requestAnimationFrame(updateAI)

    return () => cancelAnimationFrame(animationId)
  }, [phase])

  useEffect(() => {
    return () => {
      stopTracking()
    }
  }, [stopTracking])

  const scorerName = lastScorer === 'player1' ? player1.name : player2.name
  const winnerName = player1.score > player2.score ? player1.name : player2.name

  return (
    <div className="playfield">
      <video ref={videoRef} className="webcam-feed" playsInline muted />
      <canvas ref={canvasRef} className="game-canvas" />
      <HandOverlay paddleSize={0.035} paddleColor="#ffdd00" showDebug={false} />
      <GameHUD />
      <DebugPanel />

      {phase === 'countdown' && <CountdownOverlay onComplete={handleCountdownComplete} />}
      {phase === 'point-scored' && <PointScoredOverlay scorerName={scorerName} />}
      {phase === 'game-over' && (
        <GameOverOverlay
          winnerName={winnerName}
          score={{ player1: player1.score, player2: player2.score }}
          player1Name={player1.name}
          player2Name={player2.name}
          onPlayAgain={resetGame}
          isVictory={player1.score > player2.score}
        />
      )}

      {status === 'initializing' && <LoadingOverlay message="Initializing camera..." />}
      {status === 'permission-denied' && (
        <ErrorOverlay
          message="Camera access denied"
          hint="Please allow camera access to play"
        />
      )}
    </div>
  )
}
