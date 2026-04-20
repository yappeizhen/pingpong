import type { HandFrame, HandPrediction, HandTrackingStatus } from '@/types'
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const TASKS_VISION_VERSION = '0.10.22-rc.20250304'
const WASM_FILES_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`

export type HandFrameListener = (frame: HandFrame | null) => void
export type StatusListener = (status: HandTrackingStatus) => void

interface TrackerOptions {
  maxHands?: number
}

export interface HandTracker {
  start: (video: HTMLVideoElement) => Promise<void>
  stop: () => void
  subscribe: (listener: HandFrameListener) => () => void
  onStatusChange: (listener: StatusListener) => () => void
  getStatus: () => HandTrackingStatus
}

export const createHandTracker = (options: TrackerOptions = {}): HandTracker => {
  const maxHands = options.maxHands ?? 2
  let landmarker: HandLandmarker | undefined
  let videoEl: HTMLVideoElement | undefined
  let mediaStream: MediaStream | undefined
  let rafId: number | undefined
  let lastVideoTime = -1
  let status: HandTrackingStatus = 'idle'
  let lastFrameTimestamp = performance.now()
  const frameListeners = new Set<HandFrameListener>()
  const statusListeners = new Set<StatusListener>()

  const notifyStatus = (next: HandTrackingStatus) => {
    if (status === next) return
    status = next
    statusListeners.forEach((listener) => listener(status))
  }

  const emitFrame = (frame: HandFrame | null) => {
    frameListeners.forEach((listener) => listener(frame))
  }

  const cleanupStream = () => {
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = undefined
  }

  const stopLoop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = undefined
    }
  }

  const convertResultToFrame = (
    result: HandLandmarkerResult,
    timestamp: number,
    fps: number
  ): HandFrame => {
    const hands: HandPrediction[] =
      result.handednesses?.map((handedness, index) => {
        const category = handedness[0]
        const handednessLabel = category?.categoryName === 'Left' ? 'Left' : 'Right'

        const landmarks =
          result.landmarks?.[index]?.map((landmark) => ({
            x: landmark.x,
            y: landmark.y,
            z: landmark.z ?? 0,
          })) ?? []

        return {
          landmarks,
          handedness: handednessLabel,
          score: category?.score ?? 0,
        }
      }) ?? []

    return { hands, timestamp, fps }
  }

  let loopCount = 0
  let lastLogTime = 0
  
  const detectionLoop = () => {
    loopCount++
    const now = performance.now()
    
    // Log every 5 seconds
    if (now - lastLogTime > 5000) {
      console.log('[handTracker] Detection loop running, count:', loopCount, 'videoEl:', !!videoEl, 'landmarker:', !!landmarker)
      lastLogTime = now
    }
    
    if (!videoEl || !landmarker) {
      console.warn('[handTracker] Detection loop stopped: videoEl=', !!videoEl, 'landmarker=', !!landmarker)
      emitFrame(null)
      return
    }

    // Skip if video isn't ready
    if (
      videoEl.readyState < 2 ||
      videoEl.paused ||
      videoEl.videoWidth === 0 ||
      videoEl.videoHeight === 0
    ) {
      rafId = requestAnimationFrame(detectionLoop)
      return
    }

    const hasNewFrame = videoEl.currentTime !== lastVideoTime
    lastVideoTime = videoEl.currentTime

    if (hasNewFrame) {
      const now = performance.now()
      try {
        const result = landmarker.detectForVideo(videoEl, now)
        const frameDelta = now - lastFrameTimestamp
        const fps = Number.isFinite(frameDelta) && frameDelta > 0 ? 1000 / frameDelta : 0
        lastFrameTimestamp = now
        const frame = convertResultToFrame(result, now, fps)
        emitFrame(frame)
      } catch {
        // Skip frame on detection error
      }
    }

    rafId = requestAnimationFrame(detectionLoop)
  }

  const ensureLandmarker = async () => {
    if (landmarker) return landmarker
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_FILES_URL)
    landmarker = await HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'VIDEO',
      numHands: maxHands,
    })
    return landmarker
  }

  const attachCamera = async (video: HTMLVideoElement) => {
    videoEl = video
    
    // Check if video already has a stream (e.g., from WebRTC)
    const existingStream = video.srcObject as MediaStream | null
    if (existingStream && existingStream.active && existingStream.getVideoTracks().length > 0) {
      mediaStream = existingStream
      return
    }
    
    // Only get new stream if video doesn't have one
    cleanupStream()
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
        facingMode: 'user',
      },
    })
    mediaStream = stream
    video.srcObject = stream
    video.playsInline = true
    video.muted = true
    await video.play()
  }

  let isStarting = false

  const start = async (video: HTMLVideoElement) => {
    console.log('[handTracker] start() called, isStarting:', isStarting, 'status:', status, 'sameVideo:', videoEl === video)
    
    if (isStarting) {
      console.log('[handTracker] Already starting, returning')
      return
    }
    if (status === 'ready' && videoEl === video) {
      console.log('[handTracker] Already ready with same video, returning')
      return
    }

    if (status === 'ready' && videoEl !== video) {
      console.log('[handTracker] Switching to new video element while already ready')
      isStarting = true
      try {
        // Check if video already has a working stream
        const existingStream = video.srcObject as MediaStream | null
        if (existingStream && existingStream.active) {
          console.log('[handTracker] Using existing stream from new video')
          videoEl = video
          mediaStream = existingStream
          lastVideoTime = -1
        } else if (mediaStream && mediaStream.active) {
          console.log('[handTracker] Reusing our stream on new video')
          video.srcObject = mediaStream
          video.playsInline = true
          video.muted = true
          await video.play()
          videoEl = video
          lastVideoTime = -1
        } else {
          console.log('[handTracker] Getting new camera for new video')
          await attachCamera(video)
          lastVideoTime = -1
        }
      } finally {
        isStarting = false
      }
      return
    }

    console.log('[handTracker] Initial start, getting camera and landmarker')
    isStarting = true
    notifyStatus('initializing')
    try {
      await attachCamera(video)
      console.log('[handTracker] Camera attached, stream:', !!mediaStream)
      await ensureLandmarker()
      console.log('[handTracker] Landmarker ready')
      notifyStatus('ready')
      lastVideoTime = -1
      stopLoop()
      console.log('[handTracker] Starting detection loop')
      rafId = requestAnimationFrame(detectionLoop)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        notifyStatus('permission-denied')
      } else {
        console.error('[handTracker] Init failed:', error)
        notifyStatus('error')
      }
      cleanupStream()
      stopLoop()
      emitFrame(null)
      throw error
    } finally {
      isStarting = false
    }
  }

  const stop = () => {
    console.log('[handTracker] stop() called')
    console.trace('[handTracker] stop() call stack')
    stopLoop()
    cleanupStream()
    landmarker?.close()
    landmarker = undefined
    notifyStatus('idle')
    emitFrame(null)
  }

  return {
    start,
    stop,
    subscribe: (listener) => {
      frameListeners.add(listener)
      return () => frameListeners.delete(listener)
    },
    onStatusChange: (listener) => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    getStatus: () => status,
  }
}
