import { useState } from 'react'
import { useHandData } from '@/cv'
import { useGameStore } from '@/state'
import './DebugPanel.css'

export function DebugPanel() {
  const [isExpanded, setIsExpanded] = useState(false)
  const { frame, status } = useHandData()
  const { phase } = useGameStore()

  const handsDetected = frame?.hands.length ?? 0
  const fps = frame ? Math.round(frame.fps) : 0
  const confidence = frame?.hands[0]?.score ?? 0

  // Compact status indicator when collapsed
  if (!isExpanded) {
    return (
      <div className="debug-compact" onClick={() => setIsExpanded(true)}>
        <span className={`status-dot ${status === 'ready' && handsDetected > 0 ? 'good' : status === 'ready' ? 'warn' : 'bad'}`} />
        <span className="compact-info">
          {handsDetected > 0 ? `${fps} FPS` : 'No hand'}
        </span>
        <span className="expand-icon">›</span>
      </div>
    )
  }

  return (
    <div className="debug-panel">
      <div className="debug-header" onClick={() => setIsExpanded(false)}>
        <span className="debug-title">Status</span>
        <span className="collapse-icon">‹</span>
      </div>
      
      <div className="debug-content">
        <div className="debug-grid">
          <div className="debug-item">
            <span className="debug-label">Phase</span>
            <span className="debug-value">{phase}</span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Track</span>
            <span className={`debug-value ${status === 'ready' ? 'good' : ''}`}>
              {status === 'ready' ? '✓' : '...'}
            </span>
          </div>
          <div className="debug-item">
            <span className="debug-label">Hand</span>
            <span className={`debug-value ${handsDetected > 0 ? 'good' : 'bad'}`}>
              {handsDetected > 0 ? '✓' : '✗'}
            </span>
          </div>
          <div className="debug-item">
            <span className="debug-label">FPS</span>
            <span className="debug-value">{fps}</span>
          </div>
        </div>

        {handsDetected > 0 && (
          <div className="debug-detail">
            <span>{frame!.hands[0].handedness}</span>
            <span className="debug-confidence">{(confidence * 100).toFixed(0)}%</span>
          </div>
        )}

        {handsDetected === 0 && status === 'ready' && (
          <div className="debug-hint">
            Show open palm to camera
          </div>
        )}
      </div>
    </div>
  )
}
