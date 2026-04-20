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
    if (!video) return
    const tracker = ensureTracker()
    try {
      await tracker.start(video)
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
      videoElementRef.current = node
      if (node) {
        void start()
      }
    },
    [start],
  )

  useEffect(() => {
    const tracker = ensureTracker()
    const unsubscribeFrame = tracker.subscribe((nextFrame) => {
      setFrame(nextFrame)
    })
    const unsubscribeStatus = tracker.onStatusChange((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus === 'permission-denied') {
        setError('Camera permission denied')
      }
    })
    setStatus(tracker.getStatus())
    return () => {
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
