import { useRef, useEffect, useCallback } from 'react'
import { useHandData, extractPalmPosition, getPrimaryHand, handToPaddlePosition, SwipeDetector } from '@/cv'
import type { HandFrame, Handedness } from '@/types/cv'
import type { SwipeState } from '@/cv/swipeDetector'

export interface HandControllerState {
  position: { x: number; y: number }
  velocity: { x: number; y: number }
  isActive: boolean
  isSwinging: boolean
  swipeSpeed: number
  hand: Handedness | null
}

export interface UseHandControllerOptions {
  preferredHand?: Handedness
  gracePeriodMs?: number
  onStateChange?: (state: HandControllerState) => void
}

const DEFAULT_GRACE_PERIOD = 300

export function useHandController(options: UseHandControllerOptions = {}) {
  const {
    preferredHand = 'Right',
    gracePeriodMs = DEFAULT_GRACE_PERIOD,
    onStateChange,
  } = options

  const { frame } = useHandData()
  const swipeDetectorRef = useRef<SwipeDetector | null>(null)

  const lastPositionRef = useRef({ x: 0.5, y: 0.5 })
  const lastActiveTimeRef = useRef<number>(0)
  const lastSwipeRef = useRef<SwipeState>({
    velocity: { x: 0, y: 0 },
    isSwinging: false,
    speed: 0,
    direction: { x: 0, y: 0 },
  })
  const currentStateRef = useRef<HandControllerState>({
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    isActive: false,
    isSwinging: false,
    swipeSpeed: 0,
    hand: null,
  })

  useEffect(() => {
    swipeDetectorRef.current = new SwipeDetector()
    return () => {
      swipeDetectorRef.current = null
    }
  }, [])

  const processFrame = useCallback(
    (handFrame: HandFrame | null): HandControllerState => {
      if (!swipeDetectorRef.current) {
        return currentStateRef.current
      }

      const now = performance.now()

      if (!handFrame) {
        swipeDetectorRef.current.update(null)
        const timeSinceActive = now - lastActiveTimeRef.current
        const inGracePeriod = timeSinceActive < gracePeriodMs

        const state: HandControllerState = {
          position: lastPositionRef.current,
          velocity: inGracePeriod ? lastSwipeRef.current.velocity : { x: 0, y: 0 },
          isActive: inGracePeriod,
          isSwinging: inGracePeriod && lastSwipeRef.current.isSwinging,
          swipeSpeed: inGracePeriod ? lastSwipeRef.current.speed : 0,
          hand: null,
        }

        currentStateRef.current = state
        return state
      }

      const primaryHand = getPrimaryHand(handFrame.hands, preferredHand)

      if (!primaryHand) {
        swipeDetectorRef.current.update(null)
        const timeSinceActive = now - lastActiveTimeRef.current
        const inGracePeriod = timeSinceActive < gracePeriodMs

        const state: HandControllerState = {
          position: lastPositionRef.current,
          velocity: inGracePeriod ? lastSwipeRef.current.velocity : { x: 0, y: 0 },
          isActive: inGracePeriod,
          isSwinging: inGracePeriod && lastSwipeRef.current.isSwinging,
          swipeSpeed: inGracePeriod ? lastSwipeRef.current.speed : 0,
          hand: null,
        }

        currentStateRef.current = state
        return state
      }

      const palm = extractPalmPosition(primaryHand)
      const position = handToPaddlePosition(palm, primaryHand)
      const swipe = swipeDetectorRef.current.update(palm.isOpen ? palm : null)

      lastPositionRef.current = position

      if (palm.isOpen) {
        lastActiveTimeRef.current = now
        lastSwipeRef.current = swipe
      }

      const state: HandControllerState = {
        position,
        velocity: swipe.velocity,
        isActive: palm.isOpen,
        isSwinging: swipe.isSwinging,
        swipeSpeed: swipe.speed,
        hand: primaryHand.handedness,
      }

      currentStateRef.current = state
      return state
    },
    [gracePeriodMs, preferredHand]
  )

  useEffect(() => {
    const state = processFrame(frame)
    onStateChange?.(state)
  }, [frame, processFrame, onStateChange])

  const isSwipeGesture = useCallback((): boolean => {
    const state = currentStateRef.current
    return state.isActive && state.isSwinging
  }, [])

  const getCurrentState = useCallback((): HandControllerState => {
    return currentStateRef.current
  }, [])

  return {
    frame,
    swipeDetectorRef,
    processFrame,
    isSwipeGesture,
    getCurrentState,
  }
}
