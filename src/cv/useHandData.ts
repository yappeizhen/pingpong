import { useContext, useEffect, useState, useCallback, useRef } from 'react'
import { HandTrackerContext } from './HandTrackerContext'
import type { HandFrame, HandTrackingStatus } from '@/types'

export function useHandData() {
  const tracker = useContext(HandTrackerContext)
  const [frame, setFrame] = useState<HandFrame | null>(null)
  const [status, setStatus] = useState<HandTrackingStatus>('idle')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!tracker) return

    const unsubFrame = tracker.subscribe(setFrame)
    const unsubStatus = tracker.onStatusChange(setStatus)
    setStatus(tracker.getStatus())

    return () => {
      unsubFrame()
      unsubStatus()
    }
  }, [tracker])

  const startTracking = useCallback(
    async (video: HTMLVideoElement) => {
      if (!tracker) return
      videoRef.current = video
      await tracker.start(video)
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
