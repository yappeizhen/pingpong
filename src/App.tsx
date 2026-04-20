import { HandTrackerProvider } from '@/cv'
import { useGameStore } from '@/state'
import { StartScreen, Playfield } from '@/ui/components'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import './App.css'

function App() {
  const { phase, mode } = useGameStore()

  // Only show single-player Playfield when actively playing in solo mode
  // Multiplayer mode handles its own playfield inside StartScreen -> MultiplayerMenu -> MultiplayerPlayfield
  const showSoloPlayfield = phase !== 'idle' && mode === 'solo'

  return (
    <HandTrackerProvider maxHands={2}>
      <div className="app">{showSoloPlayfield ? <Playfield /> : <StartScreen />}</div>
    </HandTrackerProvider>
  )
}

export default App
