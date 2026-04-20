import { useGameStore } from '@/state'
import './GameHUD.css'

interface GameHUDProps {
  isMultiplayer?: boolean
  isHost?: boolean
  hideMenuButton?: boolean
}

export function GameHUD({ isMultiplayer = false, isHost = true, hideMenuButton = false }: GameHUDProps) {
  const { player1, player2, servingPlayer, rallyCount, phase, resetGame } = useGameStore()

  // In multiplayer, determine if it's "your turn" based on whether you're the serving player
  // Host is player1, Guest is player2
  const myPlayer = isMultiplayer ? (isHost ? 'player1' : 'player2') : 'player1'
  const isMyServe = servingPlayer === myPlayer

  // Determine display names and scores based on perspective
  const youName = isMultiplayer ? (isHost ? player1.name : player2.name) : player1.name
  const youScore = isMultiplayer ? (isHost ? player1.score : player2.score) : player1.score
  const opponentName = isMultiplayer ? (isHost ? player2.name : player1.name) : player2.name
  const opponentScore = isMultiplayer ? (isHost ? player2.score : player1.score) : player2.score

  return (
    <div className="game-hud">
      {!hideMenuButton && (
        <button className="hud-menu-btn" onClick={resetGame} title="Return to menu">
          ✕
        </button>
      )}
      <div className="hud-scores">
        <div className={`hud-player ${isMyServe ? 'serving' : ''}`}>
          <span className="player-name">{youName || 'You'}</span>
          <span className="player-score">{youScore}</span>
          {isMyServe && <span className="serve-indicator">●</span>}
        </div>

        <div className="hud-divider">-</div>

        <div className={`hud-player opponent ${!isMyServe && servingPlayer ? 'serving' : ''}`}>
          <span className="player-name">{opponentName || 'Opponent'}</span>
          <span className="player-score">{opponentScore}</span>
          {!isMyServe && servingPlayer && <span className="serve-indicator">●</span>}
        </div>
      </div>

      {phase === 'playing' && rallyCount > 0 && (
        <div className="hud-rally">Rally: {rallyCount}</div>
      )}

      {phase === 'serving' && (
        <div className="hud-message">
          {isMyServe ? 'Your serve - Swipe to serve!' : 'Opponent serving...'}
        </div>
      )}
    </div>
  )
}
