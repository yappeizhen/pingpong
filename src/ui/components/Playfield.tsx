import { useRef, useEffect, useCallback } from 'react'
import { PongGame } from '@/game'
import { useHandData, extractPalmPosition, getPrimaryHand, handToPaddlePosition } from '@/cv'
import { useGameStore } from '@/state'
import { DebugPanel } from './DebugPanel'
import { GameHUD } from './GameHUD'
import { HandOverlay } from './HandOverlay'
import './Playfield.css'

export function Playfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<PongGame | null>(null)
  const serveTimeoutRef = useRef<number | null>(null)

  const { frame, status, startTracking, stopTracking } = useHandData()

  const {
    phase,
    servingPlayer,
    seed,
    setPhase,
    setPlayer2Paddle,
    scorePoint,
  } = useGameStore()

  useEffect(() => {
    if (!canvasRef.current) return

    const game = new PongGame(canvasRef.current)
    gameRef.current = game

    game.setOnPoint((winner, reason) => {
      console.log(`Point for ${winner}: ${reason}`)
      scorePoint(winner)
    })

    game.start()

    return () => {
      game.dispose()
      gameRef.current = null
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

  useEffect(() => {
    if (!frame || !gameRef.current) return

    const primaryHand = getPrimaryHand(frame.hands, 'Right')

    if (primaryHand) {
      const palm = extractPalmPosition(primaryHand)
      const paddlePos = handToPaddlePosition(palm, primaryHand)

      lastPaddlePosRef.current = paddlePos

      gameRef.current.setPlayer1Paddle({
        position: paddlePos,
        isActive: palm.isOpen,
        hand: primaryHand.handedness,
      })

      if (phase === 'serving' && servingPlayer === 'player1' && palm.isOpen) {
        handleServe()
      }
    } else {
      gameRef.current.setPlayer1Paddle({
        position: lastPaddlePosRef.current,
        isActive: false,
        hand: null,
      })
    }
  }, [frame, phase, servingPlayer, handleServe])

  useEffect(() => {
    if (phase !== 'playing' || !gameRef.current) return

    const ballState = gameRef.current.getBallState()
    if (!ballState.isInPlay) return

    const ballX = ballState.position.x
    const tableHalfWidth = 0.7625

    const targetX = 0.5 + (ballX / tableHalfWidth) * 0.3 + (Math.random() - 0.5) * 0.1
    const targetY = 0.4 + Math.random() * 0.2

    setPlayer2Paddle({
      position: { x: Math.max(0.2, Math.min(0.8, targetX)), y: targetY },
      isActive: true,
      hand: 'Right',
    })

    gameRef.current.setPlayer2Paddle({
      position: { x: Math.max(0.2, Math.min(0.8, targetX)), y: targetY },
      isActive: true,
      hand: 'Right',
    })
  }, [phase, setPlayer2Paddle])

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
      <HandOverlay showLandmarks={true} showPaddle={true} />
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
