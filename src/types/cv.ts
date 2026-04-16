export type Handedness = 'Left' | 'Right'

export interface Landmark {
  x: number
  y: number
  z: number
}

export interface HandPrediction {
  landmarks: Landmark[]
  handedness: Handedness
  score: number
}

export interface HandFrame {
  hands: HandPrediction[]
  timestamp: number
  fps: number
}

export type HandTrackingStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'permission-denied'
  | 'error'

export interface PalmPosition {
  x: number
  y: number
  z: number
  isOpen: boolean
  confidence: number
}
