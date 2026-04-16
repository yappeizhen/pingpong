import { useGameStore } from '@/state'
import './GameHUD.css'

export function GameHUD() {
  const { player1, player2, servingPlayer, rallyCount, phase, resetGame } = useGameStore()

  return (
    <div className="game-hud">
      <button className="hud-menu-btn" onClick={resetGame} title="Return to menu">
        ✕
      </button>
      <div className="hud-scores">
        <div className={`hud-player ${servingPlayer === 'player1' ? 'serving' : ''}`}>
          <span className="player-name">{player1.name}</span>
          <span className="player-score">{player1.score}</span>
          {servingPlayer === 'player1' && <span className="serve-indicator">●</span>}
        </div>

        <div className="hud-divider">-</div>

        <div className={`hud-player opponent ${servingPlayer === 'player2' ? 'serving' : ''}`}>
          <span className="player-name">{player2.name}</span>
          <span className="player-score">{player2.score}</span>
          {servingPlayer === 'player2' && <span className="serve-indicator">●</span>}
        </div>
      </div>

      {phase === 'playing' && rallyCount > 0 && (
        <div className="hud-rally">Rally: {rallyCount}</div>
      )}

      {phase === 'serving' && (
        <div className="hud-message">
          {servingPlayer === 'player1' ? 'Your serve - Open palm to serve!' : 'Opponent serving...'}
        </div>
      )}
    </div>
  )
}
