import { useCallback } from 'react'
import { HandTrackerProvider } from '@/cv'
import { useGameStore, useMultiplayerStore } from '@/state'
import { StartScreen, Playfield, MultiplayerPlayfield } from '@/ui/components'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import './App.css'

function App() {
  const { phase, resetGame } = useGameStore()
  const { roomId, roomState, reset: resetMultiplayer } = useMultiplayerStore()

  // Check if multiplayer game is active (like frootninja)
  const isMultiplayerActive = roomId && (roomState === 'waiting' || roomState === 'countdown' || roomState === 'playing' || roomState === 'finished')

  // Handle exit from multiplayer
  const handleExitMultiplayer = useCallback(() => {
    resetMultiplayer()
    resetGame()
  }, [resetMultiplayer, resetGame])

  // Show solo Playfield when playing in solo mode
  const showSoloPlayfield = phase !== 'idle' && !isMultiplayerActive

  // Render multiplayer playfield when active (like frootninja)
  if (isMultiplayerActive) {
    return (
      <HandTrackerProvider maxHands={2}>
        <div className="app">
          <MultiplayerPlayfield onExit={handleExitMultiplayer} />
        </div>
      </HandTrackerProvider>
    )
  }

  return (
    <HandTrackerProvider maxHands={2}>
      <div className="app">{showSoloPlayfield ? <Playfield /> : <StartScreen />}</div>
    </HandTrackerProvider>
  )
}

export default App
