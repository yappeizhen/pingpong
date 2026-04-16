import { useRef, useEffect, type ReactNode } from 'react'
import { HandTrackerContext } from './HandTrackerContext'
import { createHandTracker, type HandTracker } from './handTracker'

interface Props {
  children: ReactNode
  maxHands?: number
}

export function HandTrackerProvider({ children, maxHands = 2 }: Props) {
  const trackerRef = useRef<HandTracker | null>(null)

  if (!trackerRef.current) {
    console.log('[HandTrackerProvider] Creating hand tracker with maxHands:', maxHands)
    trackerRef.current = createHandTracker({ maxHands })
  }

  useEffect(() => {
    console.log('[HandTrackerProvider] Mounted, tracker:', !!trackerRef.current)
    return () => {
      console.log('[HandTrackerProvider] Unmounting, stopping tracker')
      trackerRef.current?.stop()
    }
  }, [])

  return (
    <HandTrackerContext.Provider value={trackerRef.current}>{children}</HandTrackerContext.Provider>
  )
}
