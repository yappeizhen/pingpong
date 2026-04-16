import { TABLE, PHYSICS, BALL } from './constants'
import type { BallState, PaddleState } from '@/types'

interface AIConfig {
  reactionDelay: number
  speed: number
  predictionError: number
  anticipation: number
}

const DIFFICULTY_PRESETS: Record<string, AIConfig> = {
  easy: {
    reactionDelay: 200,
    speed: 0.03,
    predictionError: 0.12,
    anticipation: 0.2,
  },
  medium: {
    reactionDelay: 60,
    speed: 0.06,
    predictionError: 0.05,
    anticipation: 0.5,
  },
  hard: {
    reactionDelay: 20,
    speed: 0.1,
    predictionError: 0.015,
    anticipation: 0.8,
  },
}

export class AIController {
  private config: AIConfig
  private targetX: number = 0.5
  private targetY: number = 0.5
  private lastUpdateTime: number = 0
  private currentPaddle: PaddleState = {
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    isActive: true,
    isSwinging: true,
    swipeSpeed: 0.5,
    hand: 'Right',
  }
  private lastBallZ: number = 0
  private rallyCount: number = 0

  constructor(difficulty: 'easy' | 'medium' | 'hard' = 'hard') {
    this.config = DIFFICULTY_PRESETS[difficulty]
  }

  update(ballState: BallState, deltaTime: number): PaddleState {
    const now = performance.now()

    // Track rally for adaptive positioning
    if (ballState.isInPlay && ballState.velocity.z > 0 && this.lastBallZ <= 0) {
      this.rallyCount++
    }
    this.lastBallZ = ballState.velocity.z

    // Update target more frequently for better tracking
    if (now - this.lastUpdateTime > this.config.reactionDelay) {
      this.lastUpdateTime = now
      this.calculateTarget(ballState)
    }

    this.moveTowardsTarget(deltaTime)

    return { ...this.currentPaddle }
  }

  private calculateTarget(ball: BallState) {
    if (!ball.isInPlay) {
      // Return to center when not in play
      this.targetX = 0.5
      this.targetY = 0.5
      this.rallyCount = 0
      return
    }

    const ballMovingTowardsAI = ball.velocity.z < 0

    if (ballMovingTowardsAI) {
      // Ball coming towards AI - predict and intercept
      const predictedPos = this.predictBallPosition(ball)
      
      // Small random error based on difficulty
      const error = (Math.random() - 0.5) * 2 * this.config.predictionError
      this.targetX = Math.max(0.1, Math.min(0.9, predictedPos.x + error))
      this.targetY = Math.max(0.25, Math.min(0.75, predictedPos.y + error * 0.3))
    } else {
      // Ball going away - anticipate return position
      const anticipatedX = this.anticipateReturnPosition(ball)
      this.targetX = 0.5 + (anticipatedX - 0.5) * this.config.anticipation
      this.targetY = 0.45 // Slightly lower, ready position
    }
  }

  private predictBallPosition(ball: BallState): { x: number; y: number } {
    const tableHalfLength = TABLE.LENGTH / 2
    const aiZ = -tableHalfLength - 0.15

    if (ball.velocity.z >= 0) {
      return { x: 0.5, y: 0.5 }
    }

    // Calculate time to reach AI's paddle position
    let timeToReach = (aiZ - ball.position.z) / ball.velocity.z

    if (timeToReach < 0 || timeToReach > 5) {
      return { x: 0.5, y: 0.5 }
    }

    // Simulate ball trajectory with bounces
    let simX = ball.position.x
    let simY = ball.position.y
    let simZ = ball.position.z
    let velX = ball.velocity.x
    let velY = ball.velocity.y
    let velZ = ball.velocity.z

    const dt = 0.016 // 60fps simulation
    const tableHalfWidth = TABLE.WIDTH / 2
    let steps = 0
    const maxSteps = 300

    while (simZ > aiZ && steps < maxSteps) {
      // Apply physics
      velY += PHYSICS.GRAVITY * dt
      velX *= PHYSICS.AIR_RESISTANCE
      velY *= PHYSICS.AIR_RESISTANCE
      velZ *= PHYSICS.AIR_RESISTANCE

      simX += velX * dt
      simY += velY * dt
      simZ += velZ * dt

      // Table bounce
      if (simY <= TABLE.HEIGHT + BALL.RADIUS && velY < 0) {
        simY = TABLE.HEIGHT + BALL.RADIUS
        velY = -velY * BALL.BOUNCE_COEFFICIENT
        velX *= PHYSICS.TABLE_FRICTION
        velZ *= PHYSICS.TABLE_FRICTION
      }

      steps++
    }

    // Clamp to table bounds
    simX = Math.max(-tableHalfWidth, Math.min(tableHalfWidth, simX))
    simY = Math.max(TABLE.HEIGHT, simY)

    // Normalize to 0-1 range
    const normalizedX = 0.5 + (simX / TABLE.WIDTH)
    const normalizedY = Math.max(0.2, Math.min(0.8, (simY - TABLE.HEIGHT) / 0.4))

    return { x: normalizedX, y: normalizedY }
  }

  private anticipateReturnPosition(ball: BallState): number {
    // Predict where opponent might return the ball
    // Based on ball position and typical return patterns
    const ballNormX = 0.5 + (ball.position.x / TABLE.WIDTH)
    
    // Anticipate cross-court or down-the-line returns
    if (this.rallyCount > 2) {
      // After a few rallies, anticipate more
      return 0.5 + (0.5 - ballNormX) * 0.3
    }
    
    return 0.5
  }

  private moveTowardsTarget(deltaTime: number) {
    const speed = this.config.speed * deltaTime * 60

    const dx = this.targetX - this.currentPaddle.position.x
    const dy = this.targetY - this.currentPaddle.position.y

    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance > 0.005) {
      // Smooth acceleration/deceleration
      const urgency = Math.min(1, distance * 5)
      const adjustedSpeed = speed * (0.5 + urgency * 0.5)
      
      const moveX = (dx / distance) * Math.min(adjustedSpeed, Math.abs(dx))
      const moveY = (dy / distance) * Math.min(adjustedSpeed, Math.abs(dy))

      this.currentPaddle.position = {
        x: Math.max(0.05, Math.min(0.95, this.currentPaddle.position.x + moveX)),
        y: Math.max(0.15, Math.min(0.85, this.currentPaddle.position.y + moveY)),
      }
    }

    this.currentPaddle.isActive = true
  }

  reset() {
    this.targetX = 0.5
    this.targetY = 0.5
    this.currentPaddle.position = { x: 0.5, y: 0.5 }
    this.currentPaddle.velocity = { x: 0, y: 0 }
    this.rallyCount = 0
    this.lastBallZ = 0
  }
}
