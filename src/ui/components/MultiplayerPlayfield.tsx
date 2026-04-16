import { useRef, useEffect, useCallback, useState } from 'react'
import { PongGame } from '@/game'
import { useHandData, extractPalmPosition, getPrimaryHand, handToPaddlePosition, SwipeDetector } from '@/cv'
import { useMultiplayerRoom, getPlayerId } from '@/multiplayer'
import {
  createPeerConnection,
  closePeerConnection,
  getLocalMediaStream,
  stopMediaStream,
} from '@/multiplayer/webrtcService'
import { gameSyncService } from '@/multiplayer/gameSyncService'
import type { GameSyncMessage, WebRTCConnection } from '@/multiplayer/types'
import { HandOverlay } from './HandOverlay'
import { GameHUD } from './GameHUD'
import { useGameStore } from '@/state'
import './MultiplayerPlayfield.css'

interface MultiplayerPlayfieldProps {
  onExit: () => void
}

export function MultiplayerPlayfield({ onExit }: MultiplayerPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<PongGame | null>(null)
  const swipeDetectorRef = useRef<SwipeDetector | null>(null)
  const connectionRef = useRef<WebRTCConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  const { frame, startTracking } = useHandData()
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
    seed,
    setPhase,
    scorePoint,
  } = useGameStore()

  const [isConnecting, setIsConnecting] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<string>('Connecting...')
  const playerId = getPlayerId()

  useEffect(() => {
    if (!canvasRef.current) return

    const game = new PongGame(canvasRef.current)
    gameRef.current = game
    swipeDetectorRef.current = new SwipeDetector()

    game.setGuestMode(!isHost)

    game.setOnPoint((winner, reason) => {
      console.log(`[MP] Point for ${winner}: ${reason}`)
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
      swipeDetectorRef.current = null
    }
  }, [scorePoint, isHost])

  useEffect(() => {
    const setupWebRTC = async () => {
      if (!roomId || connectionRef.current) return

      setConnectionStatus('Getting camera access...')
      const localStream = await getLocalMediaStream()
      if (!localStream) {
        setConnectionError('Failed to access camera')
        setIsConnecting(false)
        return
      }

      localStreamRef.current = localStream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream
        await localVideoRef.current.play().catch(() => {})
      }

      if (localVideoRef.current) {
        await startTracking(localVideoRef.current)
      }

      setConnectionStatus('Connecting to opponent...')

      const connection = await createPeerConnection(
        roomId,
        playerId,
        isHost,
        localStream,
        (remoteStream) => {
          console.log('[MP] Received remote stream')
          setRemoteStream(remoteStream)
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream
            remoteVideoRef.current.play().catch(() => {})
          }
        },
        (dataChannel) => {
          console.log('[MP] Data channel ready')
          setDataChannel(dataChannel)
          gameSyncService.setDataChannel(dataChannel, isHost)
          setIsConnecting(false)
          setConnectionStatus('Connected!')
        }
      )

      if (connection) {
        connectionRef.current = connection
      } else {
        setConnectionError('Failed to establish connection')
        setIsConnecting(false)
      }
    }

    setupWebRTC()

    return () => {
      if (connectionRef.current && roomId) {
        closePeerConnection(connectionRef.current, roomId, playerId)
        connectionRef.current = null
      }
      if (localStreamRef.current) {
        stopMediaStream(localStreamRef.current)
        localStreamRef.current = null
      }
      gameSyncService.close()
    }
  }, [roomId, isHost, playerId])

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

  const lastPaddlePosRef = useRef({ x: 0.5, y: 0.5 })
  const lastActiveTimeRef = useRef<number>(0)
  const lastSwipeRef = useRef({ velocity: { x: 0, y: 0 }, isSwinging: false, speed: 0 })
  const ACTIVE_GRACE_PERIOD = 300

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

      const paddleState = {
        position: paddlePos,
        velocity: swipe.velocity,
        isActive: palm.isOpen,
        isSwinging: swipe.isSwinging,
        swipeSpeed: swipe.speed,
        hand: primaryHand.handedness,
      }

      gameRef.current.setPlayer1Paddle(paddleState)
      gameSyncService.sendPaddle(playerId, paddleState)

      if (isHost && phase === 'playing') {
        const ballState = gameRef.current.getBallState()
        gameSyncService.sendBall(ballState)
      }
    } else {
      swipeDetectorRef.current.update(null)

      const timeSinceActive = now - lastActiveTimeRef.current
      const inGracePeriod = timeSinceActive < ACTIVE_GRACE_PERIOD

      const paddleState = {
        position: lastPaddlePosRef.current,
        velocity: inGracePeriod ? lastSwipeRef.current.velocity : { x: 0, y: 0 },
        isActive: inGracePeriod,
        isSwinging: inGracePeriod && lastSwipeRef.current.isSwinging,
        swipeSpeed: inGracePeriod ? lastSwipeRef.current.speed : 0,
        hand: null,
      }

      gameRef.current.setPlayer1Paddle(paddleState)
      gameSyncService.sendPaddle(playerId, paddleState)
    }
  }, [frame, phase, isHost, playerId])

  useEffect(() => {
    if (roomState === 'playing' && phase !== 'playing' && phase !== 'serving') {
      setPhase('serving')
    }
  }, [roomState, phase, setPhase])

  const handleServe = useCallback(() => {
    if (phase !== 'serving' || !gameRef.current) return

    const isMyServe =
      (servingPlayer === 'player1' && isHost) ||
      (servingPlayer === 'player2' && !isHost)

    if (isMyServe) {
      gameRef.current.serve(servingPlayer, seed)
      gameSyncService.sendServe(servingPlayer, seed)
      setPhase('playing')
    }
  }, [phase, servingPlayer, isHost, seed, setPhase])

  useEffect(() => {
    if (phase === 'serving' && frame) {
      const primaryHand = getPrimaryHand(frame.hands, 'Right')
      if (primaryHand) {
        const palm = extractPalmPosition(primaryHand)
        const swipe = swipeDetectorRef.current?.update(palm.isOpen ? palm : null)
        if (palm.isOpen && swipe?.isSwinging) {
          handleServe()
        }
      }
    }
  }, [phase, frame, handleServe])

  const handleExit = useCallback(async () => {
    await leaveRoom()
    onExit()
  }, [leaveRoom, onExit])

  return (
    <div className="multiplayer-playfield">
      <div className="game-area">
        <canvas ref={canvasRef} className="game-canvas" />
        <HandOverlay paddleSize={0.035} paddleColor="#ffdd00" showDebug={false} />
        <GameHUD />
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
            ref={localVideoRef}
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

      {phase === 'serving' && (
        <div className="serve-prompt">
          {(servingPlayer === 'player1' && isHost) ||
          (servingPlayer === 'player2' && !isHost)
            ? 'Your serve - swipe to serve!'
            : 'Opponent serving...'}
        </div>
      )}
    </div>
  )
}
