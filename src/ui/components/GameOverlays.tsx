import { useEffect, useState } from 'react'
import './GameOverlays.css'

interface CountdownOverlayProps {
  startFrom?: number
  onComplete?: () => void
}

export function CountdownOverlay({ startFrom = 3, onComplete }: CountdownOverlayProps) {
  const [count, setCount] = useState(startFrom)

  useEffect(() => {
    if (count > 0) {
      const timer = setTimeout(() => setCount(count - 1), 1000)
      return () => clearTimeout(timer)
    } else if (count === 0 && onComplete) {
      const timer = setTimeout(onComplete, 500)
      return () => clearTimeout(timer)
    }
  }, [count, onComplete])

  return (
    <div className="countdown-overlay">
      <span className="countdown-number">{count > 0 ? count : 'GO!'}</span>
    </div>
  )
}

interface PointScoredOverlayProps {
  scorerName: string
  title?: string
}

export function PointScoredOverlay({ scorerName, title = 'Point!' }: PointScoredOverlayProps) {
  return (
    <div className="point-overlay">
      <span className="point-text">{title}</span>
      <span className="point-scorer">{scorerName}</span>
    </div>
  )
}

interface GameOverOverlayProps {
  winnerName?: string
  score: { player1: number; player2: number }
  player1Name?: string
  player2Name?: string
  onPlayAgain?: () => void
  onExit?: () => void
  showPlayAgain?: boolean
  isVictory?: boolean
}

export function GameOverOverlay({
  score,
  player1Name = 'You',
  player2Name = 'Opponent',
  onPlayAgain,
  onExit,
  showPlayAgain = true,
  isVictory = true,
}: GameOverOverlayProps) {
  const [showContent, setShowContent] = useState(false)
  const [showButtons, setShowButtons] = useState(false)

  useEffect(() => {
    const contentTimer = setTimeout(() => setShowContent(true), 600)
    const buttonsTimer = setTimeout(() => setShowButtons(true), 1200)
    return () => {
      clearTimeout(contentTimer)
      clearTimeout(buttonsTimer)
    }
  }, [])

  const totalPoints = score.player1 + score.player2
  const winMargin = Math.abs(score.player1 - score.player2)
  const marginLabel = isVictory ? 'Win Margin' : 'Loss Margin'
  const resultMessage = isVictory
    ? `You beat ${player2Name} ${score.player1}-${score.player2}`
    : `${player2Name} beat you ${score.player2}-${score.player1}`

  return (
    <div className={`gameover-overlay ${isVictory ? 'victory' : 'defeat'}`}>
      <div className="gameover-particles">
        {isVictory && Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="particle" style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 2}s`,
            animationDuration: `${2 + Math.random() * 2}s`,
          }} />
        ))}
      </div>

      <div className={`gameover-banner ${isVictory ? 'victory' : 'defeat'}`}>
        <span className="banner-text">{isVictory ? 'VICTORY' : 'DEFEAT'}</span>
      </div>

      <div className={`gameover-content ${showContent ? 'visible' : ''}`}>
        <div className="gameover-score-display">
          <div className="score-side player">
            <span className="score-label">{player1Name}</span>
            <span className="score-value">{score.player1}</span>
          </div>
          <div className="score-divider">
            <span className="vs-text">VS</span>
          </div>
          <div className="score-side opponent">
            <span className="score-label">{player2Name}</span>
            <span className="score-value">{score.player2}</span>
          </div>
        </div>

        <div className="gameover-stats">
          <div className="stat-item">
            <span className="stat-value">{totalPoints}</span>
            <span className="stat-label">Total Rallies</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">+{winMargin}</span>
            <span className="stat-label">{marginLabel}</span>
          </div>
        </div>

        <p className="gameover-message">
          <span className="gameover-result-line">{resultMessage}</span>
          {isVictory 
            ? winMargin >= 5 ? 'Dominant performance!' : 'Well played!'
            : winMargin >= 5 ? 'Better luck next time!' : 'So close!'}
        </p>
      </div>

      <div className={`gameover-buttons ${showButtons ? 'visible' : ''}`}>
        {showPlayAgain && onPlayAgain && (
          <button className="gameover-button primary" onClick={onPlayAgain}>
            <span className="button-icon">↻</span>
            Play Again
          </button>
        )}
        {onExit && (
          <button className="gameover-button secondary" onClick={onExit}>
            <span className="button-icon">⌂</span>
            Home
          </button>
        )}
      </div>
    </div>
  )
}

interface LoadingOverlayProps {
  message?: string
}

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <div className="loading-overlay">
      <div className="loading-spinner" />
      <p>{message}</p>
    </div>
  )
}

interface ErrorOverlayProps {
  message: string
  hint?: string
  onRetry?: () => void
}

export function ErrorOverlay({ message, hint, onRetry }: ErrorOverlayProps) {
  return (
    <div className="error-overlay">
      <p>{message}</p>
      {hint && <p className="error-hint">{hint}</p>}
      {onRetry && (
        <button className="error-retry-button" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  )
}
