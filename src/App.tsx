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
  const { phase } = useGameStore()

  const isPlaying = phase !== 'idle'

  return (
    <HandTrackerProvider maxHands={2}>
      <div className="app">{isPlaying ? <Playfield /> : <StartScreen />}</div>
    </HandTrackerProvider>
  )
}

export default App
