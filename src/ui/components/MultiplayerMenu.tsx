import { useState, useCallback, useEffect } from 'react'
import { useMultiplayerRoom } from '@/multiplayer'
import { getPlayerName, setPlayerName } from '@/multiplayer/multiplayerService'
import './MultiplayerMenu.css'

interface MultiplayerMenuProps {
  onBack: () => void
  initialJoinCode?: string | null
}

type MenuView = 'menu' | 'create' | 'join'

export function MultiplayerMenu({ onBack, initialJoinCode = null }: MultiplayerMenuProps) {
  const {
    createRoom,
    joinRoom,
  } = useMultiplayerRoom()

  const [view, setView] = useState<MenuView>(initialJoinCode ? 'join' : 'menu')
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? '')
  const [playerName, setPlayerNameState] = useState(getPlayerName())
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!initialJoinCode) return
    setView('join')
    setJoinCode(initialJoinCode)
  }, [initialJoinCode])

  const handleCreateRoom = useCallback(async () => {
    if (!playerName.trim()) {
      setError('Please enter your name')
      return
    }

    setPlayerName(playerName.trim())
    setIsLoading(true)
    setError(null)

    const code = await createRoom(playerName.trim())
    if (!code) {
      setError('Failed to create room. Check your connection and Firebase config.')
    }
    // If successful, roomId is set in store and App.tsx will render MultiplayerPlayfield
    setIsLoading(false)
  }, [playerName, createRoom])

  const handleJoinRoom = useCallback(async () => {
    if (!playerName.trim()) {
      setError('Please enter your name')
      return
    }

    if (joinCode.length !== 4) {
      setError('Please enter a 4-character room code')
      return
    }

    setPlayerName(playerName.trim())
    setIsLoading(true)
    setError(null)

    const success = await joinRoom(joinCode.toUpperCase(), playerName.trim())
    if (!success) {
      setError('Room not found or full. Check the code and try again.')
    }
    // If successful, roomId is set in store and App.tsx will render MultiplayerPlayfield
    setIsLoading(false)
  }, [playerName, joinCode, joinRoom])

  const handleBack = useCallback(() => {
    if (view === 'menu') {
      onBack()
    } else {
      setView('menu')
      setJoinCode('')
      setError(null)
    }
  }, [view, onBack])

  if (view === 'create') {
    return (
      <div className="multiplayer-menu">
        <div className="menu-content">
          <div className="menu-icon">🏠</div>
          <h1 className="menu-title">Create Room</h1>
          <p className="menu-subtitle">Start a new game and invite a friend</p>

          <div className="input-group">
            <label htmlFor="playerName">Your Name</label>
            <input
              id="playerName"
              type="text"
              className="text-input"
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => {
                setPlayerNameState(e.target.value)
                setError(null)
              }}
              maxLength={20}
              disabled={isLoading}
            />
          </div>

          {error && <p className="error-message">{error}</p>}

          <div className="menu-actions">
            <button
              className="action-btn primary"
              onClick={handleCreateRoom}
              disabled={isLoading}
            >
              {isLoading ? 'Creating...' : 'Create Room'}
            </button>
            <button
              className="action-btn secondary"
              onClick={handleBack}
              disabled={isLoading}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'join') {
    return (
      <div className="multiplayer-menu">
        <div className="menu-content">
          <div className="menu-icon">🚪</div>
          <h1 className="menu-title">Join Room</h1>
          <p className="menu-subtitle">Enter a room code to join</p>

          <div className="input-group">
            <label htmlFor="playerNameJoin">Your Name</label>
            <input
              id="playerNameJoin"
              type="text"
              className="text-input"
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => {
                setPlayerNameState(e.target.value)
                setError(null)
              }}
              maxLength={20}
              disabled={isLoading}
            />
          </div>

          <div className="input-group">
            <label htmlFor="roomCode">Room Code</label>
            <input
              id="roomCode"
              type="text"
              className="code-input"
              placeholder="ABCD"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase().slice(0, 4))
                setError(null)
              }}
              maxLength={4}
              disabled={isLoading}
            />
          </div>

          {error && <p className="error-message">{error}</p>}

          <div className="menu-actions">
            <button
              className="action-btn primary"
              onClick={handleJoinRoom}
              disabled={isLoading || joinCode.length !== 4}
            >
              {isLoading ? 'Joining...' : 'Join Room'}
            </button>
            <button
              className="action-btn secondary"
              onClick={handleBack}
              disabled={isLoading}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="multiplayer-menu">
      <div className="menu-content">
        <div className="menu-icon">👥</div>
        <h1 className="menu-title">Multiplayer</h1>
        <p className="menu-subtitle">Play against a friend online</p>

        {error && <p className="error-message">{error}</p>}

        <div className="option-buttons">
          <button
            className="option-button"
            onClick={() => setView('create')}
          >
            <span className="option-icon">🏠</span>
            <span className="option-text">
              <span className="option-title">Create Room</span>
              <span className="option-desc">Start a new game and invite a friend</span>
            </span>
          </button>

          <button
            className="option-button"
            onClick={() => setView('join')}
          >
            <span className="option-icon">🚪</span>
            <span className="option-text">
              <span className="option-title">Join Room</span>
              <span className="option-desc">Enter a room code to join</span>
            </span>
          </button>
        </div>

        <button className="action-btn secondary" onClick={onBack}>
          Back to Menu
        </button>
      </div>
    </div>
  )
}
