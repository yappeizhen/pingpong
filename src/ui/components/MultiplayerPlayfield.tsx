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

export function MultiplayerPlayfield({ onExit }: MultiplayerPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<PongGame | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const phaseRef = useRef<string>('idle')
  const servingPlayerRef = useRef<'player1' | 'player2'>('player1')
  const scoreRef = useRef({ player1: 0, player2: 0 })

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

      if (isHost && phase === 'playing') {
        const ballState = gameRef.current.getBallState()
        gameSyncService.sendBall(ballState)
      }
    },
    [playerId, isHost, phase]
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

    // Both players detect points locally for responsive feedback
    // Host sends authoritative score sync, guest reconciles when message arrives
    game.setOnPoint((winner, reason) => {
      // Only increment score locally if we haven't already processed this point
      const currentPhase = phaseRef.current
      if (currentPhase === 'point-scored') {
        // Already processing a point, ignore duplicate detection
        return
      }

      scorePoint(winner)

      // Only host sends the authoritative point message
      if (isHost) {
        const currentScore = scoreRef.current
        gameSyncService.sendPoint(winner, reason, {
          player1: winner === 'player1' ? currentScore.player1 + 1 : currentScore.player1,
          player2: winner === 'player2' ? currentScore.player2 + 1 : currentScore.player2,
        })
      }
    })

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
              gameRef.current.setPlayer2Paddle(paddleData)
            } else {
              gameRef.current.setPlayer1Paddle(paddleData)
            }
          }
          break

        case 'ball':
          if (!isHost && gameRef.current) {
            gameRef.current.setRemoteBallState(message.ball)
          }
          break

        case 'serve':
          console.log('[MultiplayerPlayfield] Received serve message, player:', message.player, 'seed:', message.seed)
          if (gameRef.current) {
            gameRef.current.serve(message.player, message.seed)
            // Sync serving player state and phase
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
            // Guest reconciles with host's authoritative score
            // This corrects any desync from local detection
            const currentState = useGameStore.getState()
            if (currentState.player1.score !== message.score.player1 ||
                currentState.player2.score !== message.score.player2) {
              console.log('[MultiplayerPlayfield] Reconciling score with host:', message.score)
              const { setScore } = useGameStore.getState()
              setScore(message.score.player1, message.score.player2, message.winner)
            }
          }
          break

        case 'game-start':
          // Sync serving player from host
          if (message.servingPlayer) {
            setServingPlayer(message.servingPlayer)
          }
          setPhase('serving')
          break

        case 'game-end':
          setPhase('game-over')
          break
      }
    })

    return unsubscribe
  }, [isHost, playerId, scorePoint, setPhase, setServingPlayer])

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
      gameRef.current?.reset()
      const timer = setTimeout(() => {
        setPhase('serving')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [phase, setPhase])

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

  // Show waiting room with video preview - keep both video elements mounted for WebRTC
  const isWaiting = roomState === 'waiting'

  return (
    <div className={`multiplayer-playfield ${isWaiting ? 'multiplayer-playfield--waiting' : ''}`}>
      {/* Game area - shows WaitingRoom content during waiting, game during play */}
      <div className="game-area">
        <canvas ref={canvasRef} className="game-canvas" />
        
        {!isWaiting && (
          <>
            <HandOverlay paddleSize={0.035} paddleColor="#ffdd00" showDebug={false} />
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
            score={{ player1: player1.score, player2: player2.score }}
            player1Name={isHost ? 'You' : (opponent?.name || 'Opponent')}
            player2Name={isHost ? (opponent?.name || 'Opponent') : 'You'}
            onPlayAgain={handlePlayAgain}
            onExit={handleExit}
            isVictory={isYourWin}
          />
        )}
      </div>

      {/* Video sidebar - for waiting room only */}
      <div className="video-sidebar">
        <div className="video-container opponent-video">
          <video
            ref={remoteVideoRef}
            className="video-feed"
            playsInline
            muted
            autoPlay
          />
          <div className="video-label">
            {opponent?.name || 'Opponent'}
          </div>
          {!remoteStream && (
            <div className="video-overlay">
              <span>{opponent ? 'Connecting...' : 'Waiting...'}</span>
            </div>
          )}
        </div>

        <div className="video-container local-video">
          <video
            ref={handleVideoRef}
            className="video-feed"
            playsInline
            muted
            autoPlay
          />
          <div className="video-label">You</div>
        </div>

        {/* Connection status in sidebar */}
        <div className="sidebar-status">
          <span className={`status-dot status-dot--${
            handTrackerStatus === 'permission-denied' ? 'failed' 
            : !localStream ? 'initializing' 
            : connectionState
          }`} />
          <span className="status-text">
            {handTrackerStatus === 'initializing'
              ? 'Loading camera...'
              : handTrackerStatus === 'permission-denied'
                ? 'Camera denied'
                : !localStream 
                  ? 'Starting camera...'
                  : connectionState === 'connected' 
                    ? 'Connected' 
                    : connectionState === 'connecting' 
                      ? 'Connecting...'
                      : opponent 
                        ? 'Waiting for video...'
                        : 'Ready'}
          </span>
        </div>
      </div>

      {/* Floating opponent video - for gameplay (uses same stream as sidebar) */}
      <div className="floating-opponent-video">
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
            <span>Connecting...</span>
          </div>
        )}
      </div>

      {/* Background video (your camera - subtle ambient) */}
      <div className="background-video">
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
