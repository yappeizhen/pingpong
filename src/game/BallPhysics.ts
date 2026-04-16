import { TABLE, BALL, PHYSICS, PADDLE } from './constants'
import type { BallState, Player, PaddleState } from '@/types'

export class BallPhysics {
  private state: BallState
  private tableHalfLength = TABLE.LENGTH / 2
  private tableHalfWidth = TABLE.WIDTH / 2
  private bouncedOnPlayerSide: { player1: boolean; player2: boolean } = {
    player1: false,
    player2: false,
  }

  constructor(initialState?: Partial<BallState>) {
    this.state = {
      position: { x: 0, y: TABLE.HEIGHT + 0.2, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0 },
      lastHitBy: null,
      isInPlay: false,
      ...initialState,
    }
  }

  getState(): BallState {
    return { ...this.state }
  }

  setState(state: Partial<BallState>) {
    this.state = { ...this.state, ...state }
  }

  serve(player: Player, seed: number) {
    const seededRandom = this.seededRandom(seed)
    
    // Player 1 is at +z (near camera), Player 2 (AI) is at -z (far side)
    // Start ball at back edge of server's side, with good arc to reach opponent
    const startZ = player === 'player1' 
      ? this.tableHalfLength * 0.85   // Near back of player 1's side
      : -this.tableHalfLength * 0.85  // Near back of AI's side
    
    // Serve speed - needs enough forward momentum to reach deep into opponent's side
    const serveSpeed = BALL.INITIAL_SPEED + 0.8 + seededRandom() * 0.4
    
    const velocityZ = player === 'player1'
      ? -serveSpeed  // Towards AI (negative z)
      : serveSpeed   // Towards player1 (positive z)

    // Higher arc for better serve - gives time to travel and bounce properly
    const upwardVelocity = 2.5 + seededRandom() * 0.5

    this.state = {
      position: {
        x: (seededRandom() - 0.5) * 0.2,
        y: TABLE.HEIGHT + 0.3,
        z: startZ,
      },
      velocity: {
        x: (seededRandom() - 0.5) * 0.3,
        y: upwardVelocity,
        z: velocityZ,
      },
      spin: { x: 0, y: 0 },
      lastHitBy: player,
      isInPlay: true,
    }

    this.bouncedOnPlayerSide = { player1: false, player2: false }
    
    console.log(`[Physics] ${player} served: speed=${serveSpeed.toFixed(2)}, arc=${upwardVelocity.toFixed(2)}`)
  }

  update(
    deltaTime: number,
    player1Paddle: PaddleState,
    player2Paddle: PaddleState
  ): { point?: { winner: Player; reason: string } } {
    if (!this.state.isInPlay) return {}

    const subSteps = Math.ceil(deltaTime / PHYSICS.TIME_STEP)
    const dt = deltaTime / subSteps

    for (let i = 0; i < subSteps; i++) {
      this.applyGravity(dt)
      this.applyAirResistance()
      this.applySpin(dt)
      this.updatePosition(dt)

      const tableResult = this.checkTableCollision()
      if (tableResult.point) return { point: tableResult.point }

      this.checkPaddleCollision(player1Paddle, 'player1')
      this.checkPaddleCollision(player2Paddle, 'player2')

      const boundsResult = this.checkOutOfBounds()
      if (boundsResult.point) return { point: boundsResult.point }
    }

    return {}
  }

  private applyGravity(dt: number) {
    this.state.velocity.y += PHYSICS.GRAVITY * dt
  }

  private applyAirResistance() {
    this.state.velocity.x *= PHYSICS.AIR_RESISTANCE
    this.state.velocity.y *= PHYSICS.AIR_RESISTANCE
    this.state.velocity.z *= PHYSICS.AIR_RESISTANCE
  }

  private applySpin(dt: number) {
    this.state.velocity.x += this.state.spin.x * BALL.SPIN_FACTOR * dt
    this.state.velocity.z += this.state.spin.y * BALL.SPIN_FACTOR * dt
  }

  private updatePosition(dt: number) {
    this.state.position.x += this.state.velocity.x * dt
    this.state.position.y += this.state.velocity.y * dt
    this.state.position.z += this.state.velocity.z * dt
  }

  private checkTableCollision(): { point?: { winner: Player; reason: string } } {
    const { position, velocity } = this.state
    const ballBottom = position.y - BALL.RADIUS

    if (ballBottom <= TABLE.HEIGHT && velocity.y < 0) {
      const onTable =
        Math.abs(position.x) <= this.tableHalfWidth &&
        Math.abs(position.z) <= this.tableHalfLength

      if (onTable) {
        position.y = TABLE.HEIGHT + BALL.RADIUS
        velocity.y = -velocity.y * BALL.BOUNCE_COEFFICIENT
        velocity.x *= PHYSICS.TABLE_FRICTION
        velocity.z *= PHYSICS.TABLE_FRICTION

        const onPlayer1Side = position.z > 0
        const onPlayer2Side = position.z < 0

        if (onPlayer1Side) {
          if (this.bouncedOnPlayerSide.player1) {
            return { point: { winner: 'player2', reason: 'double-bounce' } }
          }
          this.bouncedOnPlayerSide.player1 = true
        }
        if (onPlayer2Side) {
          if (this.bouncedOnPlayerSide.player2) {
            return { point: { winner: 'player1', reason: 'double-bounce' } }
          }
          this.bouncedOnPlayerSide.player2 = true
        }
      }
    }

    if (
      Math.abs(position.z) < 0.05 &&
      position.y < TABLE.HEIGHT + TABLE.NET_HEIGHT &&
      position.y > TABLE.HEIGHT
    ) {
      const hitNet = Math.abs(position.x) <= this.tableHalfWidth
      if (hitNet) {
        velocity.z = -velocity.z * 0.3
        velocity.y = Math.abs(velocity.y) * 0.5

        const winner = this.state.lastHitBy === 'player1' ? 'player2' : 'player1'
        return { point: { winner, reason: 'net-fault' } }
      }
    }

    return {}
  }

  private checkPaddleCollision(paddle: PaddleState, player: Player) {
    if (!paddle.isActive) return

    const paddleZ = player === 'player1' ? this.tableHalfLength + 0.15 : -this.tableHalfLength - 0.15
    const paddleX = (paddle.position.x - 0.5) * TABLE.WIDTH
    const paddleY = TABLE.HEIGHT + 0.15 + paddle.position.y * 0.3

    const dx = this.state.position.x - paddleX
    const dy = this.state.position.y - paddleY
    const dz = this.state.position.z - paddleZ

    const distanceXY = Math.sqrt(dx * dx + dy * dy)
    const hitZone = PADDLE.HIT_ZONE

    const approachingPaddle =
      (player === 'player1' && this.state.velocity.z > 0) ||
      (player === 'player2' && this.state.velocity.z < 0)

    // For player, require swinging motion; AI is always ready
    const canHit = player === 'player2' || paddle.isSwinging

    if (distanceXY < hitZone && Math.abs(dz) < 0.2 && approachingPaddle && canHit) {
      const direction = player === 'player1' ? -1 : 1
      const incomingSpeed = Math.sqrt(
        this.state.velocity.x ** 2 +
          this.state.velocity.y ** 2 +
          this.state.velocity.z ** 2
      )
      
      // Use paddle swing speed to boost the hit
      const swingBoost = player === 'player1' ? Math.min(paddle.swipeSpeed * 20, 2.0) : 0.5
      const baseSpeed = Math.max(incomingSpeed, 2.5)
      const newSpeed = Math.min(baseSpeed * 1.1 + 0.8 + swingBoost, BALL.MAX_SPEED)

      // Use paddle velocity to influence ball direction
      const paddleVelInfluence = player === 'player1' ? 0.4 : 0
      const swipeX = paddle.velocity.x * paddleVelInfluence
      
      const offsetX = dx / hitZone
      const offsetY = dy / hitZone

      // Ball trajectory influenced by swing direction
      this.state.velocity = {
        x: (offsetX * 0.3 + swipeX * 2) * newSpeed,
        y: 1.8 + Math.abs(offsetY) * newSpeed * 0.2 + swingBoost * 0.3,
        z: direction * newSpeed * 0.95,
      }

      this.state.spin = {
        x: (offsetX + swipeX * 3) * 2,
        y: offsetY * 2,
      }

      this.state.lastHitBy = player
      this.bouncedOnPlayerSide = { player1: false, player2: false }
      
      console.log(`[Physics] ${player} hit ball, speed: ${newSpeed.toFixed(2)}, swingBoost: ${swingBoost.toFixed(2)}`)
    }
  }

  private checkOutOfBounds(): { point?: { winner: Player; reason: string } } {
    const { position } = this.state

    if (position.y < 0) {
      const winner = position.z > 0 ? 'player2' : 'player1'
      this.state.isInPlay = false
      return { point: { winner, reason: 'out-of-bounds' } }
    }

    if (Math.abs(position.z) > this.tableHalfLength + 1.5) {
      const missedByPlayer1 = position.z > this.tableHalfLength + 0.5
      const missedByPlayer2 = position.z < -this.tableHalfLength - 0.5

      if (missedByPlayer1 && this.state.lastHitBy === 'player2') {
        this.state.isInPlay = false
        return { point: { winner: 'player2', reason: 'miss' } }
      }
      if (missedByPlayer2 && this.state.lastHitBy === 'player1') {
        this.state.isInPlay = false
        return { point: { winner: 'player1', reason: 'miss' } }
      }

      if (missedByPlayer1 || missedByPlayer2) {
        const winner = this.state.lastHitBy === 'player1' ? 'player2' : 'player1'
        this.state.isInPlay = false
        return { point: { winner, reason: 'out-of-bounds' } }
      }
    }

    if (Math.abs(position.x) > this.tableHalfWidth + 1.0) {
      const winner = this.state.lastHitBy === 'player1' ? 'player2' : 'player1'
      this.state.isInPlay = false
      return { point: { winner, reason: 'out-of-bounds' } }
    }

    return {}
  }

  private seededRandom(seed: number): () => number {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
  }

  reset() {
    this.state = {
      position: { x: 0, y: TABLE.HEIGHT + 0.2, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      spin: { x: 0, y: 0 },
      lastHitBy: null,
      isInPlay: false,
    }
    this.bouncedOnPlayerSide = { player1: false, player2: false }
  }
}
