import * as THREE from 'three'
import { TABLE, BALL, PADDLE, CAMERA } from './constants'
import { BallPhysics } from './BallPhysics'
import type { PaddleState, Player, BallState } from '@/types'

export type PointCallback = (winner: Player, reason: string) => void

interface RemoteBallFrame {
  state: BallState
  receivedAt: number
}

export class PongGame {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private canvas: HTMLCanvasElement

  private table: THREE.Group
  private ball: THREE.Mesh
  private ballShadow: THREE.Mesh
  private paddle1: THREE.Mesh
  private paddle2: THREE.Mesh
  private trajectoryLine: THREE.Line

  private physics: BallPhysics
  private animationHandle: number | null = null
  private lastTime = 0

  private player1Paddle: PaddleState = { position: { x: 0.5, y: 0.5 }, velocity: { x: 0, y: 0 }, isActive: false, isSwinging: false, swipeSpeed: 0, hand: null }
  private player2Paddle: PaddleState = { position: { x: 0.5, y: 0.5 }, velocity: { x: 0, y: 0 }, isActive: true, isSwinging: true, swipeSpeed: 0.5, hand: 'Right' }

  private onPoint: PointCallback | null = null
  
  private isGuestMode = false
  private remoteBallState: BallState | null = null
  private remoteBallFrames: RemoteBallFrame[] = []
  private readonly remoteInterpolationDelayMs = 50
  private readonly remoteMaxExtrapolationMs = 90

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.scene = new THREE.Scene()
    this.physics = new BallPhysics()

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2

    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV, 1, CAMERA.NEAR, CAMERA.FAR)
    this.camera.position.set(CAMERA.POSITION.x, CAMERA.POSITION.y, CAMERA.POSITION.z)
    this.camera.lookAt(CAMERA.LOOK_AT.x, CAMERA.LOOK_AT.y, CAMERA.LOOK_AT.z)

    this.setupLighting()
    this.table = this.createTable()
    this.ball = this.createBall()
    this.ballShadow = this.createBallShadow()
    this.paddle1 = this.createPaddle(PADDLE.COLOR)
    this.paddle2 = this.createPaddle(PADDLE.OPPONENT_COLOR)
    this.trajectoryLine = this.createTrajectoryLine()

    this.scene.add(this.table)
    this.scene.add(this.ball)
    this.scene.add(this.ballShadow)
    this.scene.add(this.paddle1)
    this.scene.add(this.paddle2)
    this.scene.add(this.trajectoryLine)

    this.handleResize()
    window.addEventListener('resize', this.handleResize)
  }

  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4))

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
    keyLight.position.set(2, 5, 3)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.width = 2048
    keyLight.shadow.mapSize.height = 2048
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 15
    keyLight.shadow.camera.left = -3
    keyLight.shadow.camera.right = 3
    keyLight.shadow.camera.top = 3
    keyLight.shadow.camera.bottom = -3
    this.scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0x88ccff, 0.5)
    fillLight.position.set(-3, 3, -2)
    this.scene.add(fillLight)

    const rimLight = new THREE.DirectionalLight(0xffffee, 0.3)
    rimLight.position.set(0, 2, -4)
    this.scene.add(rimLight)
  }

  private createTable(): THREE.Group {
    const group = new THREE.Group()

    // Main table surface - bright cartoonish blue
    const tableGeo = new THREE.BoxGeometry(TABLE.WIDTH, 0.08, TABLE.LENGTH)
    const tableMat = new THREE.MeshToonMaterial({
      color: TABLE.COLOR,
    })
    const tableMesh = new THREE.Mesh(tableGeo, tableMat)
    tableMesh.position.y = TABLE.HEIGHT - 0.04
    tableMesh.receiveShadow = true
    group.add(tableMesh)

    // Table edge trim - darker blue border for cartoon effect
    const edgeTrimMat = new THREE.MeshToonMaterial({ color: 0x0d47a1 })
    
    // Long edge trims
    const longTrimGeo = new THREE.BoxGeometry(0.04, 0.1, TABLE.LENGTH + 0.04)
    const leftTrim = new THREE.Mesh(longTrimGeo, edgeTrimMat)
    leftTrim.position.set(-TABLE.WIDTH / 2 - 0.02, TABLE.HEIGHT - 0.03, 0)
    group.add(leftTrim)
    const rightTrim = new THREE.Mesh(longTrimGeo, edgeTrimMat)
    rightTrim.position.set(TABLE.WIDTH / 2 + 0.02, TABLE.HEIGHT - 0.03, 0)
    group.add(rightTrim)
    
    // Short edge trims
    const shortTrimGeo = new THREE.BoxGeometry(TABLE.WIDTH + 0.08, 0.1, 0.04)
    const nearTrim = new THREE.Mesh(shortTrimGeo, edgeTrimMat)
    nearTrim.position.set(0, TABLE.HEIGHT - 0.03, TABLE.LENGTH / 2 + 0.02)
    group.add(nearTrim)
    const farTrim = new THREE.Mesh(shortTrimGeo, edgeTrimMat)
    farTrim.position.set(0, TABLE.HEIGHT - 0.03, -TABLE.LENGTH / 2 - 0.02)
    group.add(farTrim)

    // White lines on table
    const lineMat = new THREE.MeshBasicMaterial({ color: TABLE.LINE_COLOR })

    const edgeGeoLong = new THREE.BoxGeometry(TABLE.LINE_WIDTH, 0.01, TABLE.LENGTH)
    const leftEdge = new THREE.Mesh(edgeGeoLong, lineMat)
    leftEdge.position.set(-TABLE.WIDTH / 2 + TABLE.LINE_WIDTH / 2 + 0.02, TABLE.HEIGHT + 0.001, 0)
    group.add(leftEdge)

    const rightEdge = new THREE.Mesh(edgeGeoLong, lineMat)
    rightEdge.position.set(TABLE.WIDTH / 2 - TABLE.LINE_WIDTH / 2 - 0.02, TABLE.HEIGHT + 0.001, 0)
    group.add(rightEdge)

    const edgeGeoShort = new THREE.BoxGeometry(TABLE.WIDTH - 0.04, 0.01, TABLE.LINE_WIDTH)
    const nearEdge = new THREE.Mesh(edgeGeoShort, lineMat)
    nearEdge.position.set(0, TABLE.HEIGHT + 0.001, TABLE.LENGTH / 2 - TABLE.LINE_WIDTH / 2 - 0.02)
    group.add(nearEdge)

    const farEdge = new THREE.Mesh(edgeGeoShort, lineMat)
    farEdge.position.set(0, TABLE.HEIGHT + 0.001, -TABLE.LENGTH / 2 + TABLE.LINE_WIDTH / 2 + 0.02)
    group.add(farEdge)

    const centerLineGeo = new THREE.BoxGeometry(TABLE.LINE_WIDTH / 2, 0.01, TABLE.LENGTH)
    const centerLine = new THREE.Mesh(centerLineGeo, lineMat)
    centerLine.position.set(0, TABLE.HEIGHT + 0.001, 0)
    group.add(centerLine)

    // Net - white with slight transparency
    const netGeo = new THREE.BoxGeometry(TABLE.WIDTH + 0.1, TABLE.NET_HEIGHT, 0.015)
    const netMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    })
    const net = new THREE.Mesh(netGeo, netMat)
    net.position.set(0, TABLE.HEIGHT + TABLE.NET_HEIGHT / 2, 0)
    group.add(net)

    // Net posts - bright silver/chrome look
    const netPostGeo = new THREE.CylinderGeometry(0.02, 0.02, TABLE.NET_HEIGHT + 0.06, 16)
    const netPostMat = new THREE.MeshToonMaterial({ color: 0x90a4ae })
    const leftPost = new THREE.Mesh(netPostGeo, netPostMat)
    leftPost.position.set(-TABLE.WIDTH / 2 - 0.05, TABLE.HEIGHT + TABLE.NET_HEIGHT / 2, 0)
    group.add(leftPost)

    const rightPost = new THREE.Mesh(netPostGeo, netPostMat)
    rightPost.position.set(TABLE.WIDTH / 2 + 0.05, TABLE.HEIGHT + TABLE.NET_HEIGHT / 2, 0)
    group.add(rightPost)

    // Table legs - cartoonish chunky style
    const legGeo = new THREE.CylinderGeometry(0.05, 0.06, TABLE.HEIGHT - 0.05, 8)
    const legMat = new THREE.MeshToonMaterial({ color: 0x37474f })
    const legPositions = [
      [-TABLE.WIDTH / 2 + 0.1, -TABLE.LENGTH / 2 + 0.15],
      [TABLE.WIDTH / 2 - 0.1, -TABLE.LENGTH / 2 + 0.15],
      [-TABLE.WIDTH / 2 + 0.1, TABLE.LENGTH / 2 - 0.15],
      [TABLE.WIDTH / 2 - 0.1, TABLE.LENGTH / 2 - 0.15],
    ]
    legPositions.forEach(([x, z]) => {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(x, (TABLE.HEIGHT - 0.05) / 2, z)
      leg.castShadow = true
      group.add(leg)
    })

    return group
  }

  private createBall(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(BALL.RADIUS, 32, 32)
    const mat = new THREE.MeshToonMaterial({
      color: BALL.COLOR,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.position.set(0, TABLE.HEIGHT + 0.2, 0)
    return mesh
  }

  private createBallShadow(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(BALL.RADIUS * 1.5, 32)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(0, TABLE.HEIGHT + 0.002, 0)
    return mesh
  }

  private createPaddle(color: number): THREE.Mesh {
    // Create a paddle group with circle and handle for cartoonish look
    const geo = new THREE.CircleGeometry(PADDLE.RADIUS, 32)
    const mat = new THREE.MeshToonMaterial({
      color,
      transparent: true,
      opacity: PADDLE.INACTIVE_OPACITY,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.visible = false
    return mesh
  }

  private createTrajectoryLine(): THREE.Line {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(60 * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.LineBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.5,
    })
    const line = new THREE.Line(geo, mat)
    line.visible = false
    return line
  }

  setOnPoint(callback: PointCallback | null) {
    this.onPoint = callback
  }

  setPlayer1Paddle(paddle: PaddleState) {
    this.player1Paddle = paddle
    this.updatePaddleMesh(this.paddle1, paddle, 'player1')
  }

  setPlayer2Paddle(paddle: PaddleState) {
    this.player2Paddle = paddle
    this.updatePaddleMesh(this.paddle2, paddle, 'player2')
  }

  private updatePaddleMesh(mesh: THREE.Mesh, paddle: PaddleState, player: Player) {
    // Show opponent's paddle mesh (local player uses the 2D overlay instead)
    // Host: show player2 (opponent = guest)
    // Guest: show player1 (opponent = host)
    const isOpponent = this.isGuestMode ? player === 'player1' : player === 'player2'
    mesh.visible = isOpponent

    const x = (paddle.position.x - 0.5) * TABLE.WIDTH
    const y = TABLE.HEIGHT + 0.1 + paddle.position.y * 0.4
    const z = player === 'player1' ? TABLE.LENGTH / 2 + 0.15 : -TABLE.LENGTH / 2 - 0.15

    mesh.position.set(x, y, z)
    mesh.rotation.x = player === 'player1' ? -Math.PI / 6 : Math.PI / 6

    const mat = mesh.material as THREE.MeshStandardMaterial
    mat.opacity = paddle.isActive ? PADDLE.ACTIVE_OPACITY : PADDLE.INACTIVE_OPACITY
  }

  serve(player: Player, seed: number) {
    this.physics.serve(player, seed)
    if (this.isGuestMode) {
      this.clearRemoteSync()
    }
  }

  getBallState(): BallState {
    return this.physics.getState()
  }

  setBallState(state: Partial<BallState>) {
    this.physics.setState(state)
    if (this.isGuestMode && state.position) {
      this.remoteBallState = { ...this.physics.getState(), ...state }
    }
  }

  setGuestMode(isGuest: boolean) {
    this.isGuestMode = isGuest
    this.clearRemoteSync()
    
    if (isGuest) {
      // Flip camera to view from opponent's side of the table
      this.camera.position.set(
        -CAMERA.POSITION.x,
        CAMERA.POSITION.y,
        -CAMERA.POSITION.z
      )
      this.camera.lookAt(
        -CAMERA.LOOK_AT.x,
        CAMERA.LOOK_AT.y,
        -CAMERA.LOOK_AT.z
      )
    } else {
      // Reset to default camera position
      this.camera.position.set(CAMERA.POSITION.x, CAMERA.POSITION.y, CAMERA.POSITION.z)
      this.camera.lookAt(CAMERA.LOOK_AT.x, CAMERA.LOOK_AT.y, CAMERA.LOOK_AT.z)
    }
  }

  setRemoteBallState(state: BallState, receivedAt = performance.now()) {
    const copiedState = this.cloneBallState(state)
    this.remoteBallState = copiedState
    this.remoteBallFrames.push({ state: copiedState, receivedAt })

    if (this.remoteBallFrames.length > 24) {
      this.remoteBallFrames.splice(0, this.remoteBallFrames.length - 24)
    }

    this.physics.setState(copiedState)
  }

  clearRemoteSync() {
    this.remoteBallFrames = []
    this.remoteBallState = null
  }

  start() {
    if (this.animationHandle) return
    this.lastTime = performance.now()
    this.renderer.setAnimationLoop(this.tick)
    this.animationHandle = 1
  }

  stop() {
    if (!this.animationHandle) return
    this.renderer.setAnimationLoop(null)
    this.animationHandle = null
  }

  reset() {
    this.physics.reset()
    this.ball.position.set(0, TABLE.HEIGHT + 0.2, 0)
    if (this.isGuestMode) {
      this.clearRemoteSync()
    }
  }

  dispose() {
    this.stop()
    window.removeEventListener('resize', this.handleResize)

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })

    this.renderer.dispose()
  }

  private tick = () => {
    const now = performance.now()
    const delta = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now

    this.update(delta, now)
    this.renderer.render(this.scene, this.camera)
  }

  private update(delta: number, now: number) {
    let ballState: BallState

    if (this.isGuestMode) {
      ballState = this.getGuestBallState(now)
    } else {
      const result = this.physics.update(delta, this.player1Paddle, this.player2Paddle)

      if (result.point && this.onPoint) {
        this.onPoint(result.point.winner, result.point.reason)
      }

      ballState = this.physics.getState()
    }

    this.ball.position.set(ballState.position.x, ballState.position.y, ballState.position.z)

    const shadowY = TABLE.HEIGHT + 0.002
    const heightAboveTable = ballState.position.y - TABLE.HEIGHT
    const shadowScale = Math.max(0.3, 1 - heightAboveTable * 0.5)
    this.ballShadow.position.set(ballState.position.x, shadowY, ballState.position.z)
    this.ballShadow.scale.setScalar(shadowScale)

    const shadowMat = this.ballShadow.material as THREE.MeshBasicMaterial
    shadowMat.opacity = Math.max(0.1, 0.4 - heightAboveTable * 0.2)

    this.updateTrajectory(ballState)
  }

  private updateTrajectory(_ballState: BallState) {
    // Trajectory line disabled - was confusing for players
    this.trajectoryLine.visible = false
  }

  private cloneBallState(state: BallState): BallState {
    return {
      position: { ...state.position },
      velocity: { ...state.velocity },
      spin: { ...state.spin },
      lastHitBy: state.lastHitBy,
      isInPlay: state.isInPlay,
    }
  }

  private lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t
  }

  private interpolateBallState(from: BallState, to: BallState, t: number): BallState {
    const clamped = Math.min(Math.max(t, 0), 1)
    return {
      position: {
        x: this.lerp(from.position.x, to.position.x, clamped),
        y: this.lerp(from.position.y, to.position.y, clamped),
        z: this.lerp(from.position.z, to.position.z, clamped),
      },
      velocity: {
        x: this.lerp(from.velocity.x, to.velocity.x, clamped),
        y: this.lerp(from.velocity.y, to.velocity.y, clamped),
        z: this.lerp(from.velocity.z, to.velocity.z, clamped),
      },
      spin: {
        x: this.lerp(from.spin.x, to.spin.x, clamped),
        y: this.lerp(from.spin.y, to.spin.y, clamped),
      },
      lastHitBy: to.lastHitBy ?? from.lastHitBy,
      isInPlay: to.isInPlay,
    }
  }

  private getGuestBallState(now: number): BallState {
    if (this.remoteBallFrames.length === 0) {
      return this.remoteBallState ?? this.physics.getState()
    }

    const renderTime = now - this.remoteInterpolationDelayMs

    while (
      this.remoteBallFrames.length >= 2 &&
      this.remoteBallFrames[1].receivedAt <= renderTime
    ) {
      this.remoteBallFrames.shift()
    }

    if (this.remoteBallFrames.length >= 2) {
      const from = this.remoteBallFrames[0]
      const to = this.remoteBallFrames[1]
      const duration = Math.max(1, to.receivedAt - from.receivedAt)
      const t = (renderTime - from.receivedAt) / duration
      return this.interpolateBallState(from.state, to.state, t)
    }

    const latest = this.remoteBallFrames[0]
    if (renderTime <= latest.receivedAt) {
      return latest.state
    }

    const dtSeconds = Math.min(
      (renderTime - latest.receivedAt) / 1000,
      this.remoteMaxExtrapolationMs / 1000
    )

    if (!latest.state.isInPlay || dtSeconds <= 0) {
      return latest.state
    }

    return {
      ...latest.state,
      position: {
        x: latest.state.position.x + latest.state.velocity.x * dtSeconds,
        y: latest.state.position.y + latest.state.velocity.y * dtSeconds,
        z: latest.state.position.z + latest.state.velocity.z * dtSeconds,
      },
    }
  }

  private handleResize = () => {
    const container = this.canvas.parentElement ?? this.canvas
    const { clientWidth, clientHeight } = container
    if (clientWidth === 0 || clientHeight === 0) return

    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(clientWidth, clientHeight, false)
  }

  syncViewport() {
    this.handleResize()
  }
}
