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

  const detectionLoop = () => {
    if (!videoEl || !landmarker) {
      emitFrame(null)
      return
    }

    const hasNewFrame = videoEl.currentTime !== lastVideoTime
    lastVideoTime = videoEl.currentTime

    if (hasNewFrame) {
      const now = performance.now()
      const result = landmarker.detectForVideo(videoEl, now)
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
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_FILES_URL)
    landmarker = await HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'VIDEO',
      numHands: maxHands,
    })
    return landmarker
  }

  const attachCamera = async (video: HTMLVideoElement) => {
    cleanupStream()
    videoEl = video
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
        if (mediaStream && mediaStream.active) {
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
