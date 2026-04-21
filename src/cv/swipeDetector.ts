import type { PalmPosition } from '@/types'

export interface SwipeState {
  isSwinging: boolean
  velocity: { x: number; y: number }
  speed: number
  direction: { x: number; y: number }
}

const HISTORY_SIZE = 6
const MIN_SWIPE_SPEED = 0.025
const SMOOTHING = 0.4

export class SwipeDetector {
  private positionHistory: Array<{ x: number; y: number; time: number }> = []
  private lastVelocity = { x: 0, y: 0 }

  update(
    palm: PalmPosition | null,
    options: { requireOpenPalm?: boolean } = {}
  ): SwipeState {
    const now = performance.now()
    const requireOpenPalm = options.requireOpenPalm ?? true

    if (!palm || (requireOpenPalm && !palm.isOpen)) {
      this.positionHistory = []
      this.lastVelocity = { x: 0, y: 0 }
      return {
        isSwinging: false,
        velocity: { x: 0, y: 0 },
        speed: 0,
        direction: { x: 0, y: 0 },
      }
    }

    this.positionHistory.push({ x: palm.x, y: palm.y, time: now })

    if (this.positionHistory.length > HISTORY_SIZE) {
      this.positionHistory.shift()
    }

    if (this.positionHistory.length < 2) {
      return {
        isSwinging: false,
        velocity: { x: 0, y: 0 },
        speed: 0,
        direction: { x: 0, y: 0 },
      }
    }

    const oldest = this.positionHistory[0]
    const newest = this.positionHistory[this.positionHistory.length - 1]
    const timeDelta = (newest.time - oldest.time) / 1000

    if (timeDelta <= 0) {
      return {
        isSwinging: false,
        velocity: this.lastVelocity,
        speed: 0,
        direction: { x: 0, y: 0 },
      }
    }

    const rawVelX = (newest.x - oldest.x) / timeDelta
    const rawVelY = (newest.y - oldest.y) / timeDelta

    const velX = this.lastVelocity.x * (1 - SMOOTHING) + rawVelX * SMOOTHING
    const velY = this.lastVelocity.y * (1 - SMOOTHING) + rawVelY * SMOOTHING
    this.lastVelocity = { x: velX, y: velY }

    const speed = Math.sqrt(velX * velX + velY * velY)
    const isSwinging = speed > MIN_SWIPE_SPEED

    let direction = { x: 0, y: 0 }
    if (speed > 0.001) {
      direction = { x: velX / speed, y: velY / speed }
    }

    return {
      isSwinging,
      velocity: { x: velX, y: velY },
      speed,
      direction,
    }
  }

  reset() {
    this.positionHistory = []
    this.lastVelocity = { x: 0, y: 0 }
  }
}
