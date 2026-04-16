import { useState, useCallback, useEffect, useRef } from 'react'
import { useMultiplayerRoom } from '@/multiplayer'
import './WaitingRoom.css'

interface WaitingRoomProps {
  onBack: () => void
}

export function WaitingRoom({ onBack }: WaitingRoomProps) {
  const {
    roomCode,
    roomState,
    isHost,
    opponent,
    localPlayer,
    hasBothPlayers,
    leaveRoom,
    updateRoomState,
  } = useMultiplayerRoom()

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownStartedRef = useRef(false)

  useEffect(() => {
    if (roomState === 'countdown' && !countdownStartedRef.current) {
      countdownStartedRef.current = true
      setCountdown(3)
      
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval)
            return null
          }
          return prev - 1
        })
      }, 1000)
      
      return () => clearInterval(interval)
    }
  }, [roomState])

  const handleStartGame = useCallback(async () => {
    if (isHost && hasBothPlayers) {
      await updateRoomState('countdown')
      
      setTimeout(async () => {
        await updateRoomState('playing')
      }, 3000)
    }
  }, [isHost, hasBothPlayers, updateRoomState])

  const handleLeave = useCallback(async () => {
    await leaveRoom()
    onBack()
  }, [leaveRoom, onBack])

  const handleCopyCode = useCallback(async () => {
    if (!roomCode) return
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 2000)
    } catch {
      window.prompt('Share this code with a friend:', roomCode)
    }
  }, [roomCode])

  const handleCopyLink = useCallback(async () => {
    if (!roomCode) return
    const link = `${window.location.origin}?join=${roomCode}`
    try {
      await navigator.clipboard.writeText(link)
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 2000)
    } catch {
      window.prompt('Share this link with a friend:', link)
    }
  }, [roomCode])

  if (countdown !== null) {
    return (
      <div className="waiting-room">
        <div className="waiting-content">
          <div className="countdown-display">
            <span className="countdown-number">{countdown}</span>
          </div>
          <h1 className="waiting-title">Get Ready!</h1>
          <p className="waiting-subtitle">Game starting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="waiting-room">
      <div className="waiting-content">
        <div className="waiting-icon">🎮</div>
        <h1 className="waiting-title">Waiting Room</h1>

        <div className="room-code-display">
          <span className="room-code-label">Room Code</span>
          <div className="room-code-box">
            <span className="room-code">{roomCode}</span>
            <button
              className="copy-btn"
              onClick={handleCopyCode}
              title={copyStatus === 'copied' ? 'Copied!' : 'Copy code'}
            >
              {copyStatus === 'copied' ? '✓' : '📋'}
            </button>
            <button
              className="copy-btn"
              onClick={handleCopyLink}
              title="Copy invite link"
            >
              🔗
            </button>
          </div>
          <span className="room-code-hint">Share the code with a friend!</span>
        </div>

        <div className="players-list">
          <div className="player-item player-ready">
            <span className="player-icon">👤</span>
            <span className="player-name">
              {localPlayer?.name || 'You'}
              {isHost && <span className="host-badge">Host</span>}
            </span>
            <span className="player-status">✓ Ready</span>
          </div>

          {opponent ? (
            <div className="player-item player-ready">
              <span className="player-icon">👤</span>
              <span className="player-name">
                {opponent.name}
                {!isHost && <span className="host-badge">Host</span>}
              </span>
              <span className="player-status">✓ Ready</span>
            </div>
          ) : (
            <div className="player-item player-waiting">
              <span className="player-icon">⏳</span>
              <span className="player-name">Waiting for opponent...</span>
            </div>
          )}
        </div>

        {!opponent && (
          <p className="waiting-message">
            Share the room code with a friend to start playing!
          </p>
        )}

        <div className="waiting-actions">
          {isHost && (
            <button
              className="action-btn primary"
              onClick={handleStartGame}
              disabled={!hasBothPlayers}
            >
              {hasBothPlayers ? 'Start Game' : 'Waiting for opponent...'}
            </button>
          )}

          {!isHost && opponent && (
            <p className="waiting-message">Waiting for host to start...</p>
          )}
        </div>

        <button className="action-btn secondary leave-btn" onClick={handleLeave}>
          Leave Room
        </button>
      </div>
    </div>
  )
}
