import { useContext, useEffect, useState, useCallback, useRef } from 'react'
import { HandTrackerContext } from './HandTrackerContext'
import type { HandFrame, HandTrackingStatus } from '@/types'

export function useHandData() {
  const tracker = useContext(HandTrackerContext)
  const [frame, setFrame] = useState<HandFrame | null>(null)
  const [status, setStatus] = useState<HandTrackingStatus>('idle')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    console.log('[useHandData] Effect running, tracker:', !!tracker)
    if (!tracker) {
      console.warn('[useHandData] No tracker in context!')
      return
    }

    const unsubFrame = tracker.subscribe(setFrame)
    const unsubStatus = tracker.onStatusChange((newStatus) => {
      console.log('[useHandData] Status changed:', newStatus)
      setStatus(newStatus)
    })
    setStatus(tracker.getStatus())

    return () => {
      unsubFrame()
      unsubStatus()
    }
  }, [tracker])

  const startTracking = useCallback(
    async (video: HTMLVideoElement) => {
      console.log('[useHandData] startTracking called, tracker:', !!tracker)
      if (!tracker) {
        console.error('[useHandData] No tracker available!')
        return
      }
      videoRef.current = video
      console.log('[useHandData] Calling tracker.start...')
      await tracker.start(video)
      console.log('[useHandData] tracker.start completed')
    },
    [tracker]
  )

  const stopTracking = useCallback(() => {
    tracker?.stop()
    videoRef.current = null
  }, [tracker])

  return {
    frame,
    status,
    startTracking,
    stopTracking,
    videoRef,
  }
}
