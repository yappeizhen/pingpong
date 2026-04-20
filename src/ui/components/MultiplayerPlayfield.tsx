import { useRef, useEffect, useCallback, useState } from 'react'
import { PongGame } from '@/game'
import { useHandData } from '@/cv'
import { useHandController, type HandControllerState } from '@/hooks'
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
import {
  CountdownOverlay,
  PointScoredOverlay,
  GameOverOverlay,
} from './GameOverlays'
import './MultiplayerPlayfield.css'

interface MultiplayerPlayfieldProps {
  onExit: () => void
}

export function MultiplayerPlayfield({ onExit }: MultiplayerPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<PongGame | null>(null)
  const connectionRef = useRef<WebRTCConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  const { startTracking } = useHandData()
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

  const [isConnecting, setIsConnecting] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<string>('Connecting...')
  const [showCountdown, setShowCountdown] = useState(false)
  const playerId = getPlayerId()

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

      try {
        if (localVideoRef.current) {
          await startTracking(localVideoRef.current)
        }
      } catch {
        // MediaPipe may throw on reload - continue anyway
      }

      setConnectionStatus('Connecting to opponent...')

      const connection = await createPeerConnection(
        roomId,
        playerId,
        isHost,
        localStream,
        (remoteStream) => {
          setRemoteStream(remoteStream)
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream
            remoteVideoRef.current.play().catch(() => {})
          }
        },
        (dataChannel) => {
          setDataChannel(dataChannel)
          gameSyncService.setDataChannel(dataChannel, isHost)
          setIsConnecting(false)
          setConnectionStatus('Connected!')
          setShowCountdown(true)
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
    </div>
  )
}
