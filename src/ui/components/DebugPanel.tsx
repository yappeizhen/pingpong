import { useHandData } from '@/cv'
import { useGameStore } from '@/state'
import './DebugPanel.css'

export function DebugPanel() {
  const { frame, status } = useHandData()
  const { phase } = useGameStore()

  return (
    <div className="debug-panel">
      <h4>Debug Info</h4>
      <div className="debug-row">
        <span>Game Phase:</span>
        <span className="debug-value">{phase}</span>
      </div>
      <div className="debug-row">
        <span>Tracking Status:</span>
        <span className={`debug-value ${status === 'ready' ? 'success' : 'warning'}`}>
          {status}
        </span>
      </div>
      <div className="debug-row">
        <span>Hands Detected:</span>
        <span className={`debug-value ${frame && frame.hands.length > 0 ? 'success' : 'error'}`}>
          {frame ? frame.hands.length : 'N/A'}
        </span>
      </div>
      {frame && frame.hands.length > 0 && (
        <>
          <div className="debug-row">
            <span>Hand Type:</span>
            <span className="debug-value">{frame.hands[0].handedness}</span>
          </div>
          <div className="debug-row">
            <span>Confidence:</span>
            <span className="debug-value">{(frame.hands[0].score * 100).toFixed(1)}%</span>
          </div>
          <div className="debug-row">
            <span>Landmarks:</span>
            <span className="debug-value">{frame.hands[0].landmarks.length}</span>
          </div>
        </>
      )}
      <div className="debug-row">
        <span>FPS:</span>
        <span className="debug-value">{frame ? Math.round(frame.fps) : 0}</span>
      </div>
      <div className="debug-tips">
        <p>Tips:</p>
        <ul>
          <li>Good lighting helps detection</li>
          <li>Keep hand 1-2 feet from camera</li>
          <li>Show palm clearly facing camera</li>
          <li>Avoid busy backgrounds</li>
        </ul>
      </div>
    </div>
  )
}
