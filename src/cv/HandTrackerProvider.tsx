import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HandFrame, HandTrackingStatus } from '@/types'
import { createHandTracker, type HandTracker } from './handTracker'
import { HandTrackerContext, type HandTrackerContextValue } from './HandTrackerContext'

interface HandTrackerProviderProps {
  children: ReactNode
  maxHands?: number
}

export function HandTrackerProvider({
  children,
  maxHands = 2,
}: HandTrackerProviderProps) {
  const trackerRef = useRef<HandTracker | undefined>(undefined)
  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<HandTrackingStatus>('idle')
  const [frame, setFrame] = useState<HandFrame | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ensureTracker = useCallback(() => {
    if (!trackerRef.current) {
      trackerRef.current = createHandTracker({ maxHands })
    }
    return trackerRef.current
  }, [maxHands])

  const start = useCallback(async () => {
    const video = videoElementRef.current
    console.log('[HandTrackerProvider] start() called, video element:', !!video)
    if (!video) return
    const tracker = ensureTracker()
    try {
      console.log('[HandTrackerProvider] Calling tracker.start()...')
      await tracker.start(video)
      console.log('[HandTrackerProvider] tracker.start() succeeded')
      setError(null)
    } catch (err) {
      console.error('[HandTrackerProvider] tracker.start() failed:', err)
      const message =
        err instanceof Error ? err.message : 'Unknown camera error occurred'
      setError(message)
    }
  }, [ensureTracker])

  const restart = useCallback(async () => {
    trackerRef.current?.stop()
    setFrame(null)
    setStatus('idle')
    await start()
  }, [start])

  const videoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      console.log('[HandTrackerProvider] videoRef called with node:', !!node)
      videoElementRef.current = node
      if (node) {
        console.log('[HandTrackerProvider] Video element assigned, starting tracker...')
        void start()
      }
    },
    [start],
  )

  useEffect(() => {
    console.log('[HandTrackerProvider] Setting up tracker subscriptions')
    const tracker = ensureTracker()
    const unsubscribeFrame = tracker.subscribe((nextFrame) => {
      setFrame(nextFrame)
    })
    const unsubscribeStatus = tracker.onStatusChange((nextStatus) => {
      console.log('[HandTrackerProvider] Status changed to:', nextStatus)
      setStatus(nextStatus)
      if (nextStatus === 'permission-denied') {
        setError('Camera permission denied')
      }
    })
    setStatus(tracker.getStatus())
    return () => {
      console.log('[HandTrackerProvider] Cleanup - stopping tracker')
      unsubscribeFrame()
      unsubscribeStatus()
      tracker.stop()
      trackerRef.current = undefined
    }
  }, [ensureTracker])

  const value = useMemo<HandTrackerContextValue>(
    () => ({
      status,
      frame,
      videoRef,
      error,
      restart,
    }),
    [status, frame, error, videoRef, restart],
  )

  return (
    <HandTrackerContext.Provider value={value}>
      {children}
    </HandTrackerContext.Provider>
  )
}
