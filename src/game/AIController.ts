import { TABLE, PHYSICS, BALL } from './constants'
import type { BallState, PaddleState } from '@/types'

interface AIConfig {
  reactionDelay: number
  speed: number
  predictionError: number
  anticipation: number
  aggression: number
}

const DIFFICULTY_PRESETS: Record<string, AIConfig> = {
  easy: {
    reactionDelay: 200,
    speed: 0.04,
    predictionError: 0.12,
    anticipation: 0.2,
    aggression: 0.3,
  },
  medium: {
    reactionDelay: 50,
    speed: 0.08,
    predictionError: 0.04,
    anticipation: 0.6,
    aggression: 0.5,
  },
  hard: {
    reactionDelay: 15,
    speed: 0.14,
    predictionError: 0.01,
    anticipation: 0.85,
    aggression: 0.7,
  },
}

export class AIController {
  private config: AIConfig
  private targetX: number = 0.5
  private targetY: number = 0.5
  private targetDepth: number = 0 // 0 = baseline, positive = forward towards net
  private lastUpdateTime: number = 0
  private currentPaddle: PaddleState & { depth: number } = {
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    isActive: true,
    isSwinging: true,
    swipeSpeed: 0.5,
    hand: 'Right',
    depth: 0,
  }
  private lastBallZ: number = 0
  private rallyCount: number = 0
  private returnAimX: number = 0 // Where AI aims its return (-1 to 1)

  constructor(difficulty: 'easy' | 'medium' | 'hard' = 'hard') {
    this.config = DIFFICULTY_PRESETS[difficulty]
  }

  update(ballState: BallState, deltaTime: number): PaddleState & { depth: number } {
    const now = performance.now()

    // Track rally for adaptive positioning
    if (ballState.isInPlay && ballState.velocity.z > 0 && this.lastBallZ <= 0) {
      this.rallyCount++
      // Vary return aim each rally
      this.returnAimX = (Math.random() - 0.5) * this.config.aggression
    }
    this.lastBallZ = ballState.velocity.z

    // Update target more frequently for better tracking
    if (now - this.lastUpdateTime > this.config.reactionDelay) {
      this.lastUpdateTime = now
      this.calculateTarget(ballState)
    }

    this.moveTowardsTarget(deltaTime, ballState)

    // Adjust swing speed based on ball speed and aggression
    const ballSpeed = Math.sqrt(
      ballState.velocity.x ** 2 + ballState.velocity.y ** 2 + ballState.velocity.z ** 2
    )
    this.currentPaddle.swipeSpeed = 0.4 + this.config.aggression * 0.4 + Math.min(ballSpeed * 0.05, 0.3)

    return { ...this.currentPaddle }
  }

  private calculateTarget(ball: BallState) {
    if (!ball.isInPlay) {
      // Return to center when not in play
      this.targetX = 0.5
      this.targetY = 0.5
      this.targetDepth = 0
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
      this.targetY = Math.max(0.2, Math.min(0.8, predictedPos.y + error * 0.3))
      
      // Move forward for short balls, back for deep balls
      const predictedDepth = predictedPos.depth
      this.targetDepth = Math.max(-0.3, Math.min(0.4, predictedDepth))
    } else {
      // Ball going away - anticipate return position
      const anticipatedX = this.anticipateReturnPosition(ball)
      this.targetX = 0.5 + (anticipatedX - 0.5) * this.config.anticipation
      this.targetY = 0.4
      this.targetDepth = 0.1 // Slightly forward, ready to move
    }
  }

  private predictBallPosition(ball: BallState): { x: number; y: number; depth: number } {
    const tableHalfLength = TABLE.LENGTH / 2
    const baselineZ = -tableHalfLength - 0.15

    if (ball.velocity.z >= 0) {
      return { x: 0.5, y: 0.5, depth: 0 }
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
    const maxSteps = 400
    let interceptZ = baselineZ
    let foundIntercept = false

    // First pass: find where ball will be at hittable height on AI side
    while (steps < maxSteps && !foundIntercept) {
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

      // Check if ball is in AI's hitting zone (behind net, at hittable height)
      const inAIZone = simZ < -0.1 && simZ > -tableHalfLength - 0.5
      const atHittableHeight = simY > TABLE.HEIGHT && simY < TABLE.HEIGHT + 0.5
      
      if (inAIZone && atHittableHeight && velZ < 0) {
        interceptZ = simZ
        foundIntercept = true
      }

      // Ball passed baseline - use final position
      if (simZ < baselineZ - 0.3) {
        interceptZ = Math.max(simZ, baselineZ - 0.3)
        break
      }

      steps++
    }

    // Clamp to table bounds
    simX = Math.max(-tableHalfWidth, Math.min(tableHalfWidth, simX))
    simY = Math.max(TABLE.HEIGHT, Math.min(TABLE.HEIGHT + 0.5, simY))

    // Normalize to 0-1 range
    const normalizedX = 0.5 + (simX / TABLE.WIDTH)
    const normalizedY = Math.max(0.15, Math.min(0.85, (simY - TABLE.HEIGHT) / 0.4))
    
    // Depth: how far forward from baseline (positive = closer to net)
    const depth = (baselineZ - interceptZ) / tableHalfLength

    return { x: normalizedX, y: normalizedY, depth }
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

  private moveTowardsTarget(deltaTime: number, ball: BallState) {
    const speed = this.config.speed * deltaTime * 60

    const dx = this.targetX - this.currentPaddle.position.x
    const dy = this.targetY - this.currentPaddle.position.y
    const dDepth = this.targetDepth - this.currentPaddle.depth

    const distance = Math.sqrt(dx * dx + dy * dy + dDepth * dDepth)

    if (distance > 0.005) {
      // Urgency increases when ball is close and coming fast
      const ballApproaching = ball.velocity.z < 0
      const ballDistance = ballApproaching ? Math.abs(ball.position.z + TABLE.LENGTH / 2) : 1
      const urgency = Math.min(1.5, distance * 6 + (ballApproaching ? 0.5 / Math.max(ballDistance, 0.3) : 0))
      const adjustedSpeed = speed * (0.6 + urgency * 0.6)
      
      const moveX = (dx / distance) * Math.min(adjustedSpeed, Math.abs(dx))
      const moveY = (dy / distance) * Math.min(adjustedSpeed, Math.abs(dy))
      const moveDepth = (dDepth / distance) * Math.min(adjustedSpeed * 0.7, Math.abs(dDepth))

      this.currentPaddle.position = {
        x: Math.max(0.05, Math.min(0.95, this.currentPaddle.position.x + moveX)),
        y: Math.max(0.1, Math.min(0.9, this.currentPaddle.position.y + moveY)),
      }
      this.currentPaddle.depth = Math.max(-0.3, Math.min(0.4, this.currentPaddle.depth + moveDepth))
    }

    // Set velocity for potential ball influence
    this.currentPaddle.velocity = {
      x: this.returnAimX * this.config.aggression,
      y: 0,
    }

    this.currentPaddle.isActive = true
  }

  reset() {
    this.targetX = 0.5
    this.targetY = 0.5
    this.targetDepth = 0
    this.currentPaddle.position = { x: 0.5, y: 0.5 }
    this.currentPaddle.velocity = { x: 0, y: 0 }
    this.currentPaddle.depth = 0
    this.rallyCount = 0
    this.lastBallZ = 0
    this.returnAimX = 0
  }
}
