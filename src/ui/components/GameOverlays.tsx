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
  winnerName: string
  score: { player1: number; player2: number }
  player1Name?: string
  player2Name?: string
  onPlayAgain?: () => void
  onExit?: () => void
  showPlayAgain?: boolean
  showExit?: boolean
}

export function GameOverOverlay({
  winnerName,
  score,
  player1Name = 'You',
  player2Name = 'Opponent',
  onPlayAgain,
  onExit,
  showPlayAgain = true,
  showExit = false,
}: GameOverOverlayProps) {
  return (
    <div className="gameover-overlay">
      <h2 className="gameover-title">Game Over</h2>
      <p className="gameover-winner">{winnerName} wins!</p>
      <p className="gameover-score">
        {player1Name}: {score.player1} - {player2Name}: {score.player2}
      </p>
      <div className="gameover-buttons">
        {showPlayAgain && onPlayAgain && (
          <button className="gameover-button primary" onClick={onPlayAgain}>
            Play Again
          </button>
        )}
        {showExit && onExit && (
          <button className="gameover-button secondary" onClick={onExit}>
            Exit
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
