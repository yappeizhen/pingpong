import { useRef, useEffect, useCallback, useState } from 'react'
import { PongGame } from '@/game'
import { useHandData } from '@/cv'
import { useHandController, type HandControllerState } from '@/hooks'
import { useMultiplayerRoom, getPlayerId, useWebRTC } from '@/multiplayer'
import { gameSyncService } from '@/multiplayer/gameSyncService'
import type { GameSyncMessage } from '@/multiplayer/types'
import { HandOverlay } from './HandOverlay'
import { GameHUD } from './GameHUD'
import { useGameStore } from '@/state'
import {
  CountdownOverlay,
  PointScoredOverlay,
  GameOverOverlay,
} from './GameOverlays'
import { WaitingRoom } from './WaitingRoom'
import './MultiplayerPlayfield.css'

interface MultiplayerPlayfieldProps {
  onExit: () => void
}

const REMOTE_PADDLE_BASE_COMP_MS = 70
const REMOTE_PADDLE_MIN_COMP_MS = 16
const REMOTE_PADDLE_MAX_COMP_MS = 140
const REMOTE_PADDLE_MAX_LEAD = 0.18

export function MultiplayerPlayfield({ onExit }: MultiplayerPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<PongGame | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const phaseRef = useRef<string>('idle')
  const servingPlayerRef = useRef<'player1' | 'player2'>('player1')
  const scoreRef = useRef({ player1: 0, player2: 0 })
  const lastBallSeqRef = useRef(0)

  // Get videoRef callback from hand tracker (like frootninja)
  const { videoRef, status: handTrackerStatus } = useHandData()
  
  const {
    roomId,
    roomState,
    isHost,
    opponent,
    setRemoteStream,
    setDataChannel,
    setConnectionError,
    leaveRoom,
  } = useMultiplayerRoom()

  const {
    phase,
    player1,
    player2,
    servingPlayer,
    lastScorer,
    setPhase,
    setServingPlayer,
    scorePoint,
    resetGame,
  } = useGameStore()

  // Keep refs in sync for use in callbacks
  phaseRef.current = phase
  servingPlayerRef.current = servingPlayer
  scoreRef.current = { player1: player1.score, player2: player2.score }

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [showCountdown, setShowCountdown] = useState(false)
  const playerId = getPlayerId()

  const resetGuestBallSync = useCallback(() => {
    lastBallSeqRef.current = 0
    gameRef.current?.clearRemoteSync()
  }, [])

  const clamp01 = useCallback((value: number) => {
    return Math.min(1, Math.max(0, value))
  }, [])

  const compensateRemotePaddleLatency = useCallback(
    (
      paddle: {
        position: { x: number; y: number }
        velocity: { x: number; y: number }
        isActive: boolean
        isSwinging: boolean
        swipeSpeed: number
        hand: HandControllerState['hand']
      },
      messageTimestamp: number
    ) => {
      const apparentAgeMs = Date.now() - messageTimestamp
      const compensationMs = Math.min(
        REMOTE_PADDLE_MAX_COMP_MS,
        Math.max(
          REMOTE_PADDLE_MIN_COMP_MS,
          Number.isFinite(apparentAgeMs) ? apparentAgeMs : REMOTE_PADDLE_BASE_COMP_MS
        )
      )
      const dt = compensationMs / 1000
      const leadX = Math.max(-REMOTE_PADDLE_MAX_LEAD, Math.min(REMOTE_PADDLE_MAX_LEAD, paddle.velocity.x * dt))
      const leadY = Math.max(-REMOTE_PADDLE_MAX_LEAD, Math.min(REMOTE_PADDLE_MAX_LEAD, paddle.velocity.y * dt))

      return {
        ...paddle,
        position: {
          x: clamp01(paddle.position.x + leadX),
          y: clamp01(paddle.position.y + leadY),
        },
      }
    },
    [clamp01]
  )

  // Handle data channel from WebRTC
  const handleDataChannel = useCallback((channel: RTCDataChannel) => {
    console.log('[MultiplayerPlayfield] Data channel ready')
    setDataChannel(channel)
    gameSyncService.setDataChannel(channel, isHost)
  }, [setDataChannel, isHost])

  // WebRTC hook - enable when we have a local stream
  const { remoteStream, connectionState } = useWebRTC({
    roomId,
    isHost,
    localStream,
    enabled: !!localStream && !!roomId,
    onDataChannel: handleDataChannel,
  })

  // Attach remote stream to video element
  useEffect(() => {
    if (!remoteVideoRef.current || !remoteStream) return
    
    remoteVideoRef.current.srcObject = remoteStream
    remoteVideoRef.current.play().catch(() => {})
    setRemoteStream(remoteStream)
  }, [remoteStream, setRemoteStream])

  // Handle connection errors
  useEffect(() => {
    if (connectionState === 'failed') {
      setConnectionError('Connection failed')
    }
    if (handTrackerStatus === 'permission-denied') {
      setConnectionError('Camera permission denied')
    } else if (handTrackerStatus === 'error') {
      setConnectionError('Camera error')
    }
  }, [connectionState, handTrackerStatus, setConnectionError])

  // Poll video element for stream (like frootninja)
  useEffect(() => {
    console.log('[MultiplayerPlayfield] Stream polling effect - localStream:', !!localStream, 'videoElement:', !!videoElement)
    
    if (localStream) {
      console.log('[MultiplayerPlayfield] Already have localStream, skipping poll')
      return
    }
    if (!videoElement) {
      console.log('[MultiplayerPlayfield] No videoElement yet, skipping poll')
      return
    }

    let attempts = 0
    const maxAttempts = 50

    const checkStream = () => {
      const srcObject = videoElement.srcObject
      console.log('[MultiplayerPlayfield] Checking stream, attempt:', attempts, 'srcObject:', !!srcObject, 'isMediaStream:', srcObject instanceof MediaStream)
      if (srcObject instanceof MediaStream) {
        console.log('[MultiplayerPlayfield] Captured local stream from video element, tracks:', srcObject.getTracks().length)
        setLocalStream(srcObject)
        localStreamRef.current = srcObject
        return true
      }
      return false
    }

    if (checkStream()) return

    const timer = window.setInterval(() => {
      if (checkStream()) {
        clearInterval(timer)
      } else if (++attempts >= maxAttempts) {
        console.warn('[MultiplayerPlayfield] Failed to capture local stream after', maxAttempts, 'attempts')
        clearInterval(timer)
      }
    }, 300)

    return () => {
      console.log('[MultiplayerPlayfield] Stream polling cleanup')
      clearInterval(timer)
    }
  }, [localStream, videoElement])

  // Combined video ref handler (like frootninja's handleVideoRef)
  const handleVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      console.log('[MultiplayerPlayfield] handleVideoRef called with node:', !!node)
      if (node) {
        setVideoElement(node)
        
        // Listen for play event to capture stream
        node.addEventListener('play', () => {
          console.log('[MultiplayerPlayfield] Video play event fired, srcObject:', !!node.srcObject)
          if (node.srcObject instanceof MediaStream) {
            console.log('[MultiplayerPlayfield] Captured stream on play event, tracks:', (node.srcObject as MediaStream).getTracks().length)
            setLocalStream(node.srcObject)
            localStreamRef.current = node.srcObject
          }
        })
      } else {
        console.log('[MultiplayerPlayfield] handleVideoRef called with null - unmounting?')
        setVideoElement(null)
      }
      // Call the hand tracker's videoRef to start tracking
      console.log('[MultiplayerPlayfield] Calling hand tracker videoRef')
      videoRef(node)
    },
    [videoRef]
  )

  const handlePaddleUpdate = useCallback(
    (state: HandControllerState) => {
      if (!gameRef.current) return

      const paddleState = {
        position: state.position,
        velocity: state.velocity,
        isActive: state.isActive,
        isSwinging: state.isSwinging,
        swipeSpeed: state.swipeSpeed,
        hand: state.hand,
      }

      // Host is player1, Guest is player2
      if (isHost) {
        gameRef.current.setPlayer1Paddle(paddleState)
      } else {
        gameRef.current.setPlayer2Paddle(paddleState)
      }
      gameSyncService.sendPaddle(playerId, paddleState)
    },
    [playerId, isHost]
  )

  useHandController({
    preferredHand: 'Right',
    onStateChange: handlePaddleUpdate,
  })

  // Initialize game
  useEffect(() => {
    if (!canvasRef.current) return

    const game = new PongGame(canvasRef.current)
    gameRef.current = game

    game.setGuestMode(!isHost)

    // Only host detects and reports points
    // Guest receives points via sync messages from host
    if (isHost) {
      game.setOnPoint((winner, reason) => {
        const currentPhase = phaseRef.current
        if (currentPhase === 'point-scored') {
          return
        }

        scorePoint(winner)

        const currentScore = scoreRef.current
        gameSyncService.sendPoint(winner, reason, {
          player1: winner === 'player1' ? currentScore.player1 + 1 : currentScore.player1,
          player2: winner === 'player2' ? currentScore.player2 + 1 : currentScore.player2,
        })
      })
    }

    game.start()

    // Host sends ball state at regular intervals (not just on paddle movement)
    let ballSyncInterval: ReturnType<typeof setInterval> | null = null
    if (isHost) {
      ballSyncInterval = setInterval(() => {
        if (gameRef.current && gameSyncService.isConnected()) {
          const ballState = gameRef.current.getBallState()
          if (ballState.isInPlay) {
            gameSyncService.sendBall(ballState)
          }
        }
      }, 50) // 20 times per second
    }

    return () => {
      if (ballSyncInterval) {
        clearInterval(ballSyncInterval)
      }
      game.dispose()
      gameRef.current = null
    }
  }, [scorePoint, isHost])

  // Cleanup on unmount - DON'T stop the stream, it's owned by HandTrackerProvider
  useEffect(() => {
    console.log('[MultiplayerPlayfield] Cleanup effect mounted')
    return () => {
      console.log('[MultiplayerPlayfield] Cleanup effect running')
      // Don't stop the stream - it's managed by HandTrackerProvider
      // Just clear our reference
      localStreamRef.current = null
      gameSyncService.close()
    }
  }, [])

  // Handle game sync messages
  useEffect(() => {
    const unsubscribe = gameSyncService.onMessage((message: GameSyncMessage) => {
      switch (message.type) {
        case 'paddle':
          if (message.playerId !== playerId && gameRef.current) {
            // Host receives guest's paddle → set player2 (far side)
            // Guest receives host's paddle → set player1 (near side)
            const paddleData = {
              position: message.paddle.position,
              velocity: message.paddle.velocity,
              isActive: message.paddle.isActive,
              isSwinging: message.paddle.isSwinging,
              swipeSpeed: message.paddle.swipeSpeed,
              hand: message.paddle.hand,
            }
            if (isHost) {
              // Host-side latency compensation for guest paddle improves collision fairness.
              gameRef.current.setPlayer2Paddle(
                compensateRemotePaddleLatency(paddleData, message.timestamp)
              )
            } else {
              gameRef.current.setPlayer1Paddle(paddleData)
            }
          }
          break

        case 'ball':
          if (!isHost && gameRef.current) {
            if (message.seq <= lastBallSeqRef.current) {
              break
            }
            lastBallSeqRef.current = message.seq
            gameRef.current.setRemoteBallState(message.ball, performance.now())
          }
          break

        case 'serve':
          console.log('[MultiplayerPlayfield] Received serve message, player:', message.player, 'seed:', message.seed)
          if (gameRef.current) {
            if (!isHost) {
              resetGuestBallSync()
            }
            gameRef.current.serve(message.player, message.seed)
            setServingPlayer(message.player)
            setPhase('playing')
          } else {
            console.warn('[MultiplayerPlayfield] Cannot apply serve: gameRef is null!')
          }
          break

        case 'serve-request':
          // Guest requested a serve - host executes it
          console.log('[MultiplayerPlayfield] Received serve request from guest, phase:', phaseRef.current, 'servingPlayer:', servingPlayerRef.current)
          if (isHost && gameRef.current && phaseRef.current === 'serving') {
            const serveSeed = Date.now()
            console.log('[MultiplayerPlayfield] Host executing serve for guest, player:', servingPlayerRef.current)
            gameRef.current.serve(servingPlayerRef.current, serveSeed)
            gameSyncService.sendServe(servingPlayerRef.current, serveSeed)
            setPhase('playing')
          }
          break

        case 'point':
          if (!isHost && message.score) {
            // Guest receives authoritative score from host
            console.log('[MultiplayerPlayfield] Received point from host:', message.winner, message.score)
            const { setScore } = useGameStore.getState()
            setScore(message.score.player1, message.score.player2, message.winner)
            
            // Reset ball for guest
            if (gameRef.current) {
              resetGuestBallSync()
              gameRef.current.reset()
            }
          }
          break

        case 'game-start':
          // Sync serving player from host
          if (message.servingPlayer) {
            setServingPlayer(message.servingPlayer)
          }
          if (!isHost) {
            resetGuestBallSync()
          }
          setPhase('serving')
          break

        case 'game-end':
          setPhase('game-over')
          break
      }
    })

    return unsubscribe
  }, [isHost, playerId, scorePoint, setPhase, setServingPlayer, resetGuestBallSync, compensateRemotePaddleLatency])

  // Show countdown when room state changes to countdown
  useEffect(() => {
    if (roomState === 'countdown') {
      console.log('[MultiplayerPlayfield] Room state changed to countdown, showing countdown overlay')
      setShowCountdown(true)
    }
  }, [roomState])

  // Start serving when room state changes to playing (only on initial transition)
  useEffect(() => {
    if (roomState === 'playing' && phase !== 'playing' && phase !== 'serving' && phase !== 'point-scored' && phase !== 'game-over') {
      console.log('[MultiplayerPlayfield] Room state changed to playing, starting serve')
      setPhase('serving')
    }
  }, [roomState, phase, setPhase])

  // Ensure videos keep playing after state transitions
  useEffect(() => {
    if (roomState === 'countdown' || roomState === 'playing') {
      // Re-attach streams and ensure videos are playing
      const localVideo = videoElement
      const remoteVideo = remoteVideoRef.current

      if (localVideo && localStreamRef.current) {
        if (localVideo.srcObject !== localStreamRef.current) {
          console.log('[MultiplayerPlayfield] Re-attaching local stream after state change')
          localVideo.srcObject = localStreamRef.current
        }
        localVideo.play().catch(() => {})
      }

      if (remoteVideo && remoteStream) {
        if (remoteVideo.srcObject !== remoteStream) {
          console.log('[MultiplayerPlayfield] Re-attaching remote stream after state change')
          remoteVideo.srcObject = remoteStream
        }
        remoteVideo.play().catch(() => {})
      }
    }
  }, [roomState, videoElement, remoteStream])

  // Execute the actual serve (host only, called automatically)
  const doServe = useCallback(() => {
    if (!gameRef.current || !isHost) return
    
    const serveSeed = Date.now()
    gameRef.current.serve(servingPlayerRef.current, serveSeed)
    gameSyncService.sendServe(servingPlayerRef.current, serveSeed)
    setPhase('playing')
  }, [isHost, setPhase])

  // Auto-serve when phase changes to 'serving'
  useEffect(() => {
    if (phase !== 'serving') return

    // Delay before auto-serve so players can see "Get ready!" message
    const timer = setTimeout(() => {
      if (isHost) {
        // Host always executes the serve
        doServe()
      } else {
        // Guest sends serve request to host
        gameSyncService.sendServeRequest()
      }
    }, 2000) // 2 second delay for players to prepare

    return () => clearTimeout(timer)
  }, [phase, isHost, doServe])

  // After point scored, reset and transition to serving phase
  useEffect(() => {
    if (phase === 'point-scored') {
      if (!isHost) {
        resetGuestBallSync()
      }
      gameRef.current?.reset()
      const timer = setTimeout(() => {
        setPhase('serving')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [phase, setPhase, isHost, resetGuestBallSync])

  const handleCountdownComplete = useCallback(() => {
    setShowCountdown(false)
    setPhase('serving')
  }, [setPhase])

  const handleExit = useCallback(async () => {
    await leaveRoom()
    onExit()
  }, [leaveRoom, onExit])

  const handlePlayAgain = useCallback(() => {
    resetGame()
    setShowCountdown(true)
  }, [resetGame])

  const isYourPoint =
    (lastScorer === 'player1' && isHost) ||
    (lastScorer === 'player2' && !isHost)
  const scorerName = isYourPoint ? 'You' : (opponent?.name || 'Opponent')

  const isYourWin =
    (player1.score > player2.score && isHost) ||
    (player2.score > player1.score && !isHost)

  const gameOverScore = isHost
    ? { player1: player1.score, player2: player2.score }
    : { player1: player2.score, player2: player1.score }

  // Show waiting room with video preview - keep both video elements mounted for WebRTC
  const isWaiting = roomState === 'waiting'

  return (
    <div className={`multiplayer-playfield ${isWaiting ? 'multiplayer-playfield--waiting' : ''}`}>
      {/* Game area - shows WaitingRoom content during waiting, game during play */}
      <div className="game-area">
        <canvas ref={canvasRef} className="game-canvas" />
        
        {!isWaiting && (
          <>
            <HandOverlay paddleSize={0.035} paddleColor={isHost ? "#ffdd00" : "#f44336"} showDebug={false} />
            <GameHUD isMultiplayer={true} isHost={isHost} hideMenuButton={true} opponentName={opponent?.name} />
          </>
        )}

        {/* Waiting room content - rendered inside game area */}
        {isWaiting && (
          <WaitingRoom onBack={handleExit} isVideoConnected={connectionState === 'connected'} />
        )}

        {showCountdown && (
          <CountdownOverlay onComplete={handleCountdownComplete} />
        )}

        {phase === 'point-scored' && (
          <PointScoredOverlay scorerName={scorerName} />
        )}

        {phase === 'game-over' && (
          <GameOverOverlay
            score={gameOverScore}
            player1Name="You"
            player2Name={opponent?.name || 'Opponent'}
            onPlayAgain={handlePlayAgain}
            onExit={handleExit}
            isVictory={isYourWin}
          />
        )}
      </div>

      {/* Hidden video element for hand tracking - always mounted */}
      <video
        ref={handleVideoRef}
        className="hidden-tracking-video"
        playsInline
        muted
        autoPlay
      />

      {/* Hidden video for WebRTC remote stream - always mounted */}
      <video
        ref={remoteVideoRef}
        className="hidden-tracking-video"
        playsInline
        muted
        autoPlay
      />

      {/* Floating opponent video - shown during both waiting and gameplay */}
      <div className={`floating-opponent-video ${isWaiting ? 'floating-opponent-video--waiting' : ''}`}>
        <video
          className="video-feed"
          playsInline
          muted
          autoPlay
          ref={(el) => {
            if (el && remoteStream && el.srcObject !== remoteStream) {
              el.srcObject = remoteStream
              el.play().catch(() => {})
            }
          }}
        />
        <div className="video-label">{opponent?.name || 'Opponent'}</div>
        {!remoteStream && (
          <div className="video-overlay">
            <span>{opponent ? 'Connecting...' : 'Waiting for opponent...'}</span>
          </div>
        )}
      </div>

      {/* Background video (your camera) - shown during both waiting and gameplay */}
      <div className={`background-video ${isWaiting ? 'background-video--waiting' : ''}`}>
        <video
          playsInline
          muted
          autoPlay
          ref={(el) => {
            if (el && localStream && el.srcObject !== localStream) {
              el.srcObject = localStream
              el.play().catch(() => {})
            }
          }}
        />
      </div>

      <button className="exit-btn" onClick={handleExit} title="Leave game">
        ✕
      </button>
    </div>
  )
}
