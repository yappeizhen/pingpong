import { useEffect, useMemo, useState } from 'react'
import { useGameStore } from '@/state'
import { MultiplayerMenu } from './MultiplayerMenu'
import './GameScreens.css'

export function StartScreen() {
  const { startNewGame } = useGameStore()
  const [showMultiplayer, setShowMultiplayer] = useState(false)
  const [initialJoinCode, setInitialJoinCode] = useState<string | null>(null)

  const deepLinkJoinCode = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const join = params.get('join')
    if (!join) return null
    const normalized = join.toUpperCase().trim()
    return /^[A-Z0-9]{4}$/.test(normalized) ? normalized : null
  }, [])

  useEffect(() => {
    if (!deepLinkJoinCode) return
    setInitialJoinCode(deepLinkJoinCode)
    setShowMultiplayer(true)

    const url = new URL(window.location.href)
    url.searchParams.delete('join')
    window.history.replaceState({}, '', url.toString())
  }, [deepLinkJoinCode])

  const handleSoloStart = () => {
    startNewGame('solo')
  }

  if (showMultiplayer) {
    return (
      <MultiplayerMenu
        onBack={() => {
          setShowMultiplayer(false)
          setInitialJoinCode(null)
        }}
        initialJoinCode={initialJoinCode}
      />
    )
  }

  return (
    <div className="start-screen">
      <div className="start-content">
        <div className="logo">
          <span className="logo-icon">🏓</span>
          <h1 className="logo-text">PongHub</h1>
        </div>

        <p className="tagline">Play ping pong with your hands</p>

        <div className="mode-buttons">
          <button className="mode-button solo" onClick={handleSoloStart}>
            <span className="mode-icon">👤</span>
            <span className="mode-label">Solo</span>
            <span className="mode-desc">Play against AI</span>
          </button>

          <button className="mode-button multiplayer" onClick={() => setShowMultiplayer(true)}>
            <span className="mode-icon">👥</span>
            <span className="mode-label">Multiplayer</span>
            <span className="mode-desc">Challenge a friend</span>
          </button>
        </div>

        <div className="instructions">
          <h3>How to play</h3>
          <ul>
            <li>🖐️ Open your palm to show your paddle</li>
            <li>✊ Close your fist to hide it</li>
            <li>👋 Move your hand to hit the ball</li>
            <li>🎯 First to 11 points wins!</li>
          </ul>
        </div>
      </div>

      <footer className="start-footer">
        <p>Use webcam for hand tracking • Works best in good lighting</p>
      </footer>
    </div>
  )
}
