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
  faceTilt: { x: number; y: number }
  brush: { x: number; y: number }
  swingEnergy: number
  hand: Handedness | null
}

export interface UseHandControllerOptions {
  preferredHand?: Handedness
  gracePeriodMs?: number
  onStateChange?: (state: HandControllerState) => void
}

const DEFAULT_GRACE_PERIOD = 300
const ACQUIRE_OPEN_FRAMES_REQUIRED = 6
const TRACKING_LOST_REACQUIRE_MS = 700
const MIN_TRACKING_CONFIDENCE = 0.35

type TrackingPhase = 'acquiring' | 'tracking'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeGestureFeatures(frame: HandFrame, preferredHand: Handedness) {
  const primaryHand = getPrimaryHand(frame.hands, preferredHand)
  if (!primaryHand || primaryHand.landmarks.length < 21) {
    return {
      faceTilt: { x: 0, y: 0 },
      brushBias: { x: 0, y: 0 },
      handedness: null as Handedness | null,
    }
  }

  const wrist = primaryHand.landmarks[0]
  const indexMcp = primaryHand.landmarks[5]
  const middleMcp = primaryHand.landmarks[9]
  const pinkyMcp = primaryHand.landmarks[17]

  // Depth tilt approximates opening/closing paddle face.
  const depthTilt = clamp((wrist.z - middleMcp.z) * 8, -1, 1)
  // Side tilt approximates racket angle for cross-court style shots.
  const sideTilt = clamp((indexMcp.y - pinkyMcp.y) * 3, -1, 1)

  const handednessSign = primaryHand.handedness === 'Right' ? 1 : -1
  return {
    faceTilt: {
      x: depthTilt,
      y: sideTilt * handednessSign,
    },
    brushBias: {
      x: clamp((indexMcp.x - pinkyMcp.x) * 3, -1, 1),
      y: clamp((middleMcp.y - wrist.y) * -4, -1, 1),
    },
    handedness: primaryHand.handedness,
  }
}

export function useHandController(options: UseHandControllerOptions = {}) {
  const {
    preferredHand = 'Right',
    gracePeriodMs = DEFAULT_GRACE_PERIOD,
    onStateChange,
  } = options

  const { frame } = useHandData()
  const swipeDetectorRef = useRef<SwipeDetector | null>(null)
  const trackingPhaseRef = useRef<TrackingPhase>('acquiring')
  const openPalmStabilityFramesRef = useRef(0)
  const lockedHandRef = useRef<Handedness | null>(null)
  const lastTrackingTimeRef = useRef<number>(0)

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
    faceTilt: { x: 0, y: 0 },
    brush: { x: 0, y: 0 },
    swingEnergy: 0,
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

      const resetToAcquireMode = () => {
        trackingPhaseRef.current = 'acquiring'
        openPalmStabilityFramesRef.current = 0
        lockedHandRef.current = null
      }

      if (!handFrame) {
        swipeDetectorRef.current.update(null)
        const timeSinceTracked = now - lastTrackingTimeRef.current
        if (timeSinceTracked > TRACKING_LOST_REACQUIRE_MS) {
          resetToAcquireMode()
        }
        const timeSinceActive = now - lastActiveTimeRef.current
        const inGracePeriod = timeSinceActive < gracePeriodMs

        const state: HandControllerState = {
          position: lastPositionRef.current,
          velocity: inGracePeriod ? lastSwipeRef.current.velocity : { x: 0, y: 0 },
          isActive: inGracePeriod,
          isSwinging: inGracePeriod && lastSwipeRef.current.isSwinging,
          swipeSpeed: inGracePeriod ? lastSwipeRef.current.speed : 0,
          faceTilt: inGracePeriod ? currentStateRef.current.faceTilt : { x: 0, y: 0 },
          brush: inGracePeriod ? currentStateRef.current.brush : { x: 0, y: 0 },
          swingEnergy: inGracePeriod ? currentStateRef.current.swingEnergy : 0,
          hand: null,
        }

        currentStateRef.current = state
        return state
      }

      const primaryHand = getPrimaryHand(handFrame.hands, preferredHand)

      if (!primaryHand) {
        swipeDetectorRef.current.update(null)
        const timeSinceTracked = now - lastTrackingTimeRef.current
        if (timeSinceTracked > TRACKING_LOST_REACQUIRE_MS) {
          resetToAcquireMode()
        }
        const timeSinceActive = now - lastActiveTimeRef.current
        const inGracePeriod = timeSinceActive < gracePeriodMs

        const state: HandControllerState = {
          position: lastPositionRef.current,
          velocity: inGracePeriod ? lastSwipeRef.current.velocity : { x: 0, y: 0 },
          isActive: inGracePeriod,
          isSwinging: inGracePeriod && lastSwipeRef.current.isSwinging,
          swipeSpeed: inGracePeriod ? lastSwipeRef.current.speed : 0,
          faceTilt: inGracePeriod ? currentStateRef.current.faceTilt : { x: 0, y: 0 },
          brush: inGracePeriod ? currentStateRef.current.brush : { x: 0, y: 0 },
          swingEnergy: inGracePeriod ? currentStateRef.current.swingEnergy : 0,
          hand: null,
        }

        currentStateRef.current = state
        return state
      }

      const palm = extractPalmPosition(primaryHand)
      const position = handToPaddlePosition(palm, primaryHand)
      const handMatchesLock = !lockedHandRef.current || primaryHand.handedness === lockedHandRef.current
      const isTrackable = primaryHand.score >= MIN_TRACKING_CONFIDENCE && handMatchesLock

      if (trackingPhaseRef.current === 'acquiring') {
        if (palm.isOpen && isTrackable) {
          lockedHandRef.current = primaryHand.handedness
          openPalmStabilityFramesRef.current += 1
          if (openPalmStabilityFramesRef.current >= ACQUIRE_OPEN_FRAMES_REQUIRED) {
            trackingPhaseRef.current = 'tracking'
            lastTrackingTimeRef.current = now
          }
        } else {
          openPalmStabilityFramesRef.current = 0
        }
      }

      if (trackingPhaseRef.current === 'tracking') {
        if (isTrackable) {
          lastTrackingTimeRef.current = now
        } else if (now - lastTrackingTimeRef.current > TRACKING_LOST_REACQUIRE_MS) {
          resetToAcquireMode()
          swipeDetectorRef.current.update(null)
        }
      }

      const hasControl = trackingPhaseRef.current === 'tracking' && isTrackable
      const swipe = swipeDetectorRef.current.update(hasControl ? palm : null, {
        requireOpenPalm: !hasControl,
      })
      const gesture = computeGestureFeatures(handFrame, preferredHand)

      const brushX = clamp(
        swipe.velocity.x * 0.95 + gesture.brushBias.x * 0.45 + gesture.faceTilt.y * 0.35,
        -1,
        1
      )
      const brushY = clamp(
        -swipe.velocity.y * 0.95 + gesture.brushBias.y * 0.45 + gesture.faceTilt.x * 0.35,
        -1,
        1
      )
      const swingEnergy = clamp(
        swipe.speed * 1.45 + (swipe.isSwinging ? 0.16 : 0),
        0,
        1
      )

      lastPositionRef.current = position

      if (hasControl) {
        lastActiveTimeRef.current = now
        lastSwipeRef.current = swipe
      }

      const state: HandControllerState = {
        position,
        velocity: swipe.velocity,
        isActive: hasControl,
        isSwinging: swipe.isSwinging,
        swipeSpeed: swipe.speed,
        faceTilt: hasControl ? gesture.faceTilt : { x: 0, y: 0 },
        brush: hasControl ? { x: brushX, y: brushY } : { x: 0, y: 0 },
        swingEnergy: hasControl ? swingEnergy : 0,
        hand: hasControl ? (gesture.handedness ?? primaryHand.handedness) : null,
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
