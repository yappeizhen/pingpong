import { useRef, useEffect, useCallback } from 'react'
import { PongGame } from '@/game'
import { AIController } from '@/game/AIController'
import { useHandData, extractPalmPosition, getPrimaryHand, handToPaddlePosition, SwipeDetector } from '@/cv'
import { useGameStore } from '@/state'
import { DebugPanel } from './DebugPanel'
import { GameHUD } from './GameHUD'
import { HandOverlay } from './HandOverlay'
import './Playfield.css'

export function Playfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<PongGame | null>(null)
  const aiRef = useRef<AIController | null>(null)
  const swipeDetectorRef = useRef<SwipeDetector | null>(null)
  const serveTimeoutRef = useRef<number | null>(null)
  const lastAiUpdateRef = useRef<number>(0)

  const { frame, status, startTracking, stopTracking } = useHandData()

  const {
    phase,
    servingPlayer,
    seed,
    setPhase,
    scorePoint,
  } = useGameStore()

  useEffect(() => {
    if (!canvasRef.current) return

    const game = new PongGame(canvasRef.current)
    gameRef.current = game
    aiRef.current = new AIController('hard')
    swipeDetectorRef.current = new SwipeDetector()

    game.setOnPoint((winner, reason) => {
      console.log(`Point for ${winner}: ${reason}`)
      scorePoint(winner)
    })

    game.start()

    return () => {
      game.dispose()
      gameRef.current = null
      aiRef.current = null
      swipeDetectorRef.current = null
    }
  }, [scorePoint])

  useEffect(() => {
    console.log('[Playfield] Camera effect - phase:', phase, 'status:', status, 'videoRef:', !!videoRef.current)
    if (phase === 'waiting-for-camera' && status === 'idle') {
      if (videoRef.current) {
        console.log('[Playfield] Starting hand tracking...')
        startTracking(videoRef.current).catch((err) => {
          console.error('[Playfield] Failed to start tracking:', err)
        })
      } else {
        console.warn('[Playfield] videoRef is null!')
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
      const timer = setTimeout(() => {
        setPhase('countdown')
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [phase, setPhase])

  useEffect(() => {
    if (phase === 'countdown') {
      const timer = setTimeout(() => {
        setPhase('serving')
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [phase, setPhase])

  const handleServe = useCallback(() => {
    if (phase !== 'serving' || servingPlayer !== 'player1') return
    if (serveTimeoutRef.current) return

    gameRef.current?.serve('player1', seed)
    setPhase('playing')

    serveTimeoutRef.current = window.setTimeout(() => {
      serveTimeoutRef.current = null
    }, 500)
  }, [phase, servingPlayer, seed, setPhase])

  useEffect(() => {
    if (phase === 'serving' && servingPlayer === 'player2') {
      const timer = setTimeout(() => {
        gameRef.current?.serve('player2', seed + 1)
        setPhase('playing')
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [phase, servingPlayer, seed, setPhase])

  useEffect(() => {
    if (phase === 'point-scored') {
      gameRef.current?.reset()
      const timer = setTimeout(() => {
        setPhase('serving')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [phase, setPhase])

  const lastPaddlePosRef = useRef({ x: 0.5, y: 0.5 })
  const lastActiveTimeRef = useRef<number>(0)
  const lastSwipeRef = useRef({ velocity: { x: 0, y: 0 }, isSwinging: false, speed: 0 })
  const ACTIVE_GRACE_PERIOD = 300 // Keep paddle active for 300ms after losing tracking

  useEffect(() => {
    if (!frame || !gameRef.current || !swipeDetectorRef.current) return

    const primaryHand = getPrimaryHand(frame.hands, 'Right')
    const now = performance.now()

    if (primaryHand) {
      const palm = extractPalmPosition(primaryHand)
      const paddlePos = handToPaddlePosition(palm, primaryHand)
      const swipe = swipeDetectorRef.current.update(palm.isOpen ? palm : null)

      lastPaddlePosRef.current = paddlePos
      
      if (palm.isOpen) {
        lastActiveTimeRef.current = now
        lastSwipeRef.current = swipe
      }

      gameRef.current.setPlayer1Paddle({
        position: paddlePos,
        velocity: swipe.velocity,
        isActive: palm.isOpen,
        isSwinging: swipe.isSwinging,
        swipeSpeed: swipe.speed,
        hand: primaryHand.handedness,
      })

      // Serve when palm is open and swinging
      if (phase === 'serving' && servingPlayer === 'player1' && palm.isOpen && swipe.isSwinging) {
        handleServe()
      }
    } else {
      swipeDetectorRef.current.update(null)
      
      // Grace period: keep paddle active briefly after losing tracking
      const timeSinceActive = now - lastActiveTimeRef.current
      const inGracePeriod = timeSinceActive < ACTIVE_GRACE_PERIOD
      
      gameRef.current.setPlayer1Paddle({
        position: lastPaddlePosRef.current,
        velocity: inGracePeriod ? lastSwipeRef.current.velocity : { x: 0, y: 0 },
        isActive: inGracePeriod,
        isSwinging: inGracePeriod && lastSwipeRef.current.isSwinging,
        swipeSpeed: inGracePeriod ? lastSwipeRef.current.speed : 0,
        hand: null,
      })
    }
  }, [frame, phase, servingPlayer, handleServe])

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

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [phase])

  useEffect(() => {
    return () => {
      stopTracking()
      if (serveTimeoutRef.current) {
        clearTimeout(serveTimeoutRef.current)
      }
    }
  }, [stopTracking])

  return (
    <div className="playfield">
      <video ref={videoRef} className="webcam-feed" playsInline muted />
      <canvas ref={canvasRef} className="game-canvas" />
      <HandOverlay paddleSize={0.035} showDebug={false} />
      <GameHUD />
      <DebugPanel />

      {phase === 'countdown' && <CountdownOverlay />}
      {phase === 'point-scored' && <PointScoredOverlay />}
      {phase === 'game-over' && <GameOverOverlay />}

      {status === 'initializing' && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Initializing camera...</p>
        </div>
      )}

      {status === 'permission-denied' && (
        <div className="error-overlay">
          <p>Camera access denied</p>
          <p className="error-hint">Please allow camera access to play</p>
        </div>
      )}
    </div>
  )
}

function CountdownOverlay() {
  const [count, setCount] = useState(3)

  useEffect(() => {
    if (count > 0) {
      const timer = setTimeout(() => setCount(count - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [count])

  return (
    <div className="countdown-overlay">
      <span className="countdown-number">{count > 0 ? count : 'GO!'}</span>
    </div>
  )
}

function PointScoredOverlay() {
  const { player1, player2 } = useGameStore()
  const lastScorer = player1.score > player2.score ? player1 : player2

  return (
    <div className="point-overlay">
      <span className="point-text">Point!</span>
      <span className="point-scorer">{lastScorer.name}</span>
    </div>
  )
}

function GameOverOverlay() {
  const { player1, player2, resetGame } = useGameStore()
  const winner = player1.score > player2.score ? player1 : player2

  return (
    <div className="gameover-overlay">
      <h2 className="gameover-title">Game Over</h2>
      <p className="gameover-winner">{winner.name} wins!</p>
      <p className="gameover-score">
        {player1.score} - {player2.score}
      </p>
      <button className="gameover-button" onClick={resetGame}>
        Play Again
      </button>
    </div>
  )
}

import { useState } from 'react'
