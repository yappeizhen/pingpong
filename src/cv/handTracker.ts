import type { HandFrame, HandPrediction, HandTrackingStatus } from '@/types'
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const TASKS_VISION_VERSION = '0.10.22-rc.20250304'
const WASM_FILES_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`

type WasmFilesetType = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
let globalFilesetResolver: WasmFilesetType | null = null
let filesetResolverPromise: Promise<WasmFilesetType> | null = null

const getFilesetResolver = async (): Promise<WasmFilesetType> => {
  if (globalFilesetResolver) return globalFilesetResolver
  if (filesetResolverPromise) return filesetResolverPromise
  
  filesetResolverPromise = FilesetResolver.forVisionTasks(WASM_FILES_URL)
    .then(resolver => {
      globalFilesetResolver = resolver
      return resolver
    })
    .catch(error => {
      filesetResolverPromise = null
      throw error
    })
  
  return filesetResolverPromise
}

// Global singleton for HandLandmarker to prevent duplicate WASM/WebGL contexts
let globalLandmarker: HandLandmarker | null = null
let landmarkerPromise: Promise<HandLandmarker> | null = null
let landmarkerMaxHands = 2

const getGlobalLandmarker = async (maxHands: number): Promise<HandLandmarker> => {
  // If landmarker exists with same or more hands, reuse it
  if (globalLandmarker && landmarkerMaxHands >= maxHands) {
    return globalLandmarker
  }
  
  // If landmarker is being created, wait for it
  if (landmarkerPromise && landmarkerMaxHands >= maxHands) {
    return landmarkerPromise
  }
  
  // Close existing landmarker if we need more hands
  if (globalLandmarker) {
    globalLandmarker.close()
    globalLandmarker = null
  }
  
  landmarkerMaxHands = maxHands
  landmarkerPromise = (async () => {
    const filesetResolver = await getFilesetResolver()
    const landmarker = await HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'VIDEO',
      numHands: maxHands,
    })
    globalLandmarker = landmarker
    return landmarker
  })()
  
  landmarkerPromise.catch(() => {
    landmarkerPromise = null
  })
  
  return landmarkerPromise
}

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

  const detectionLoop = () => {
    if (!videoEl || !landmarker) {
      emitFrame(null)
      return
    }

    // Don't process if video isn't ready, paused, or has zero dimensions
    // readyState >= 3 means HAVE_FUTURE_DATA - enough data to play
    if (
      videoEl.readyState < 3 ||
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
      let result
      try {
        result = landmarker.detectForVideo(videoEl, now)
      } catch {
        // Skip frame if detection fails (e.g., WebGL errors)
        rafId = requestAnimationFrame(detectionLoop)
        return
      }
      const frameDelta = now - lastFrameTimestamp
      const fps = Number.isFinite(frameDelta) && frameDelta > 0 ? 1000 / frameDelta : 0
      lastFrameTimestamp = now
      const frame = convertResultToFrame(result, now, fps)
      emitFrame(frame)
    }

    rafId = requestAnimationFrame(detectionLoop)
  }

  const ensureLandmarker = async () => {
    if (landmarker) return landmarker
    // Use global singleton to prevent duplicate WASM/WebGL contexts
    landmarker = await getGlobalLandmarker(maxHands)
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
    if (isStarting) return
    if (status === 'ready' && videoEl === video) return

    if (status === 'ready' && videoEl !== video) {
      isStarting = true
      try {
        // Check if video already has a working stream
        const existingStream = video.srcObject as MediaStream | null
        if (existingStream && existingStream.active) {
          videoEl = video
          mediaStream = existingStream
          lastVideoTime = -1
        } else if (mediaStream && mediaStream.active) {
          video.srcObject = mediaStream
          video.playsInline = true
          video.muted = true
          await video.play()
          videoEl = video
          lastVideoTime = -1
        } else {
          await attachCamera(video)
          lastVideoTime = -1
        }
      } finally {
        isStarting = false
      }
      return
    }

    isStarting = true
    notifyStatus('initializing')
    try {
      await attachCamera(video)
      await ensureLandmarker()
      notifyStatus('ready')
      lastVideoTime = -1
      stopLoop()
      rafId = requestAnimationFrame(detectionLoop)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        notifyStatus('permission-denied')
      } else {
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
    stopLoop()
    cleanupStream()
    // Don't close the global landmarker - just clear our reference
    // The global singleton will be reused by other tracker instances
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
