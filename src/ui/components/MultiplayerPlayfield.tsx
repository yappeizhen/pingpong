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
    seed,
    setPhase,
    scorePoint,
    resetGame,
  } = useGameStore()

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<string>('Getting camera access...')
  const [showCountdown, setShowCountdown] = useState(false)
  const playerId = getPlayerId()

  // Handle data channel from WebRTC
  const handleDataChannel = useCallback((channel: RTCDataChannel) => {
    console.log('[MultiplayerPlayfield] Data channel ready')
    setDataChannel(channel)
    gameSyncService.setDataChannel(channel, isHost)
    setIsConnecting(false)
    setConnectionStatus('Connected!')
    setShowCountdown(true)
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

  // Update connection status based on WebRTC state
  useEffect(() => {
    if (connectionState === 'connecting') {
      setConnectionStatus('Connecting to opponent...')
    } else if (connectionState === 'connected') {
      setConnectionStatus('Connected!')
    } else if (connectionState === 'failed') {
      setConnectionError('Connection failed')
    }
  }, [connectionState, setConnectionError])

  // Update connection status based on hand tracker status
  useEffect(() => {
    if (handTrackerStatus === 'initializing') {
      setConnectionStatus('Initializing camera...')
    } else if (handTrackerStatus === 'ready' && !localStream) {
      setConnectionStatus('Camera ready, waiting for stream...')
    } else if (handTrackerStatus === 'permission-denied') {
      setConnectionError('Camera permission denied')
    } else if (handTrackerStatus === 'error') {
      setConnectionError('Camera error')
    }
  }, [handTrackerStatus, localStream, setConnectionError])

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

      gameRef.current.setPlayer1Paddle(paddleState)
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

    game.setOnPoint((winner, reason) => {
      scorePoint(winner)

      if (isHost) {
        gameSyncService.sendPoint(winner, reason, {
          player1: winner === 'player1' ? player1.score + 1 : player1.score,
          player2: winner === 'player2' ? player2.score + 1 : player2.score,
        })
      }
    })

    game.start()

    return () => {
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
            gameRef.current.setPlayer2Paddle({
              position: message.paddle.position,
              velocity: message.paddle.velocity,
              isActive: message.paddle.isActive,
              isSwinging: message.paddle.isSwinging,
              swipeSpeed: message.paddle.swipeSpeed,
              hand: message.paddle.hand,
            })
          }
          break

        case 'ball':
          if (!isHost && gameRef.current) {
            gameRef.current.setRemoteBallState(message.ball)
          }
          break

        case 'serve':
          if (gameRef.current) {
            gameRef.current.serve(message.player, message.seed)
          }
          break

        case 'point':
          if (!isHost) {
            scorePoint(message.winner)
          }
          break

        case 'game-start':
          setPhase('serving')
          break

        case 'game-end':
          setPhase('game-over')
          break
      }
    })

    return unsubscribe
  }, [isHost, playerId, scorePoint, setPhase])

  useEffect(() => {
    if (roomState === 'playing' && phase !== 'playing' && phase !== 'serving') {
      setPhase('serving')
    }
  }, [roomState, phase, setPhase])

  const doServe = useCallback(() => {
    if (!gameRef.current) return

    if (isHost) {
      gameRef.current.serve(servingPlayer, seed)
      gameSyncService.sendServe(servingPlayer, seed)
    }
    setPhase('playing')
  }, [servingPlayer, isHost, seed, setPhase])

  useEffect(() => {
    if (phase === 'point-scored') {
      gameRef.current?.reset()
      const timer = setTimeout(() => {
        doServe()
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [phase, doServe])

  const handleCountdownComplete = useCallback(() => {
    setShowCountdown(false)
    doServe()
  }, [doServe])

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

  // Show waiting room with hidden video element to initialize camera/WebRTC early
  if (roomState === 'waiting') {
    return (
      <div className="multiplayer-playfield multiplayer-playfield--waiting">
        {/* Hidden video element to capture stream for WebRTC during waiting */}
        <video
          ref={handleVideoRef}
          className="video-feed video-feed--hidden"
          autoPlay
          playsInline
          muted
        />
        {/* Waiting room overlay */}
        <WaitingRoom onBack={handleExit} />
        {/* WebRTC connection status */}
        <div className="webrtc-status">
          <span className={`webrtc-status-dot webrtc-status-dot--${
            handTrackerStatus === 'permission-denied' ? 'failed' 
            : !localStream ? 'initializing' 
            : connectionState
          }`} />
          {handTrackerStatus === 'initializing'
            ? 'Loading camera...'
            : handTrackerStatus === 'permission-denied'
              ? 'Camera access denied'
              : !localStream 
                ? 'Starting camera...'
                : connectionState === 'connected' 
                  ? 'Video connected' 
                  : connectionState === 'connecting' 
                    ? 'Connecting video...'
                    : opponent 
                      ? 'Waiting for opponent video...'
                      : 'Camera ready'}
        </div>
      </div>
    )
  }

  return (
    <div className="multiplayer-playfield">
      <div className="game-area">
        <canvas ref={canvasRef} className="game-canvas" />
        <HandOverlay paddleSize={0.035} paddleColor="#ffdd00" showDebug={false} />
        <GameHUD />

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
          {isConnecting && (
            <div className="video-overlay">
              <span>{connectionStatus}</span>
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
      </div>

      <button className="exit-btn" onClick={handleExit} title="Leave game">
        ✕
      </button>
    </div>
  )
}
