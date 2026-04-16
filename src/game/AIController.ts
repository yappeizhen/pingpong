import { TABLE, PHYSICS } from './constants'
import type { BallState, PaddleState } from '@/types'

interface AIConfig {
  reactionDelay: number
  accuracy: number
  speed: number
  predictionError: number
}

const DIFFICULTY_PRESETS: Record<string, AIConfig> = {
  easy: {
    reactionDelay: 200,
    accuracy: 0.6,
    speed: 0.03,
    predictionError: 0.12,
  },
  medium: {
    reactionDelay: 80,
    accuracy: 0.85,
    speed: 0.05,
    predictionError: 0.06,
  },
  hard: {
    reactionDelay: 30,
    accuracy: 0.95,
    speed: 0.08,
    predictionError: 0.02,
  },
}

export class AIController {
  private config: AIConfig
  private targetX: number = 0.5
  private targetY: number = 0.5
  private lastUpdateTime: number = 0
  private currentPaddle: PaddleState = {
    position: { x: 0.5, y: 0.5 },
    isActive: true,
    hand: 'Right',
  }

  constructor(difficulty: 'easy' | 'medium' | 'hard' = 'medium') {
    this.config = DIFFICULTY_PRESETS[difficulty]
  }

  update(ballState: BallState, deltaTime: number): PaddleState {
    const now = performance.now()

    if (now - this.lastUpdateTime > this.config.reactionDelay) {
      this.lastUpdateTime = now
      this.calculateTarget(ballState)
    }

    this.moveTowardsTarget(deltaTime)

    return { ...this.currentPaddle }
  }

  private calculateTarget(ball: BallState) {
    if (!ball.isInPlay) {
      this.targetX = 0.5
      this.targetY = 0.5
      return
    }

    const ballMovingTowardsAI = ball.velocity.z < 0

    if (ballMovingTowardsAI) {
      const predictedPos = this.predictBallPosition(ball)
      
      const error = (Math.random() - 0.5) * 2 * this.config.predictionError
      this.targetX = Math.max(0.15, Math.min(0.85, predictedPos.x + error))
      this.targetY = Math.max(0.3, Math.min(0.7, predictedPos.y + error * 0.5))
    } else {
      this.targetX = 0.5 + (ball.position.x / TABLE.WIDTH) * 0.2
      this.targetY = 0.5
    }
  }

  private predictBallPosition(ball: BallState): { x: number; y: number } {
    const tableHalfLength = TABLE.LENGTH / 2
    const aiZ = -tableHalfLength - 0.1

    if (ball.velocity.z >= 0) {
      return { x: 0.5, y: 0.5 }
    }

    const timeToReach = (aiZ - ball.position.z) / ball.velocity.z

    if (timeToReach < 0 || timeToReach > 3) {
      return { x: 0.5, y: 0.5 }
    }

    let predictedX = ball.position.x + ball.velocity.x * timeToReach
    let predictedY = ball.position.y + ball.velocity.y * timeToReach + 0.5 * PHYSICS.GRAVITY * timeToReach * timeToReach

    const tableHalfWidth = TABLE.WIDTH / 2
    while (Math.abs(predictedX) > tableHalfWidth) {
      if (predictedX > tableHalfWidth) {
        predictedX = 2 * tableHalfWidth - predictedX
      } else if (predictedX < -tableHalfWidth) {
        predictedX = -2 * tableHalfWidth - predictedX
      }
    }

    predictedY = Math.max(TABLE.HEIGHT, predictedY)

    const normalizedX = 0.5 + (predictedX / TABLE.WIDTH)
    const normalizedY = Math.max(0.2, Math.min(0.8, (predictedY - TABLE.HEIGHT) / 0.5))

    return { x: normalizedX, y: normalizedY }
  }

  private moveTowardsTarget(deltaTime: number) {
    const speed = this.config.speed * deltaTime * 60

    const dx = this.targetX - this.currentPaddle.position.x
    const dy = this.targetY - this.currentPaddle.position.y

    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance > 0.01) {
      const moveX = (dx / distance) * Math.min(speed, Math.abs(dx))
      const moveY = (dy / distance) * Math.min(speed, Math.abs(dy))

      this.currentPaddle.position = {
        x: this.currentPaddle.position.x + moveX,
        y: this.currentPaddle.position.y + moveY,
      }
    }

    this.currentPaddle.isActive = true
  }

  reset() {
    this.targetX = 0.5
    this.targetY = 0.5
    this.currentPaddle.position = { x: 0.5, y: 0.5 }
  }
}
