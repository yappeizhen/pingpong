import * as THREE from 'three'
import { TABLE, BALL, PADDLE, CAMERA, PHYSICS } from './constants'
import { BallPhysics } from './BallPhysics'
import type { PaddleState, Player, BallState } from '@/types'

export type PointCallback = (winner: Player, reason: string) => void

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
    mesh.visible = true

    const x = (paddle.position.x - 0.5) * TABLE.WIDTH
    const y = TABLE.HEIGHT + 0.1 + paddle.position.y * 0.4
    const z = player === 'player1' ? TABLE.LENGTH / 2 + 0.15 : -TABLE.LENGTH / 2 - 0.15

    mesh.position.set(x, y, z)
    mesh.rotation.x = player === 'player1' ? -Math.PI / 6 : Math.PI / 6

    const mat = mesh.material as THREE.MeshToonMaterial
    mat.opacity = paddle.isActive ? PADDLE.ACTIVE_OPACITY : PADDLE.INACTIVE_OPACITY
  }

  serve(player: Player, seed: number) {
    this.physics.serve(player, seed)
  }

  getBallState(): BallState {
    return this.physics.getState()
  }

  setBallState(state: Partial<BallState>) {
    this.physics.setState(state)
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

    this.update(delta)
    this.renderer.render(this.scene, this.camera)
  }

  private update(delta: number) {
    const result = this.physics.update(delta, this.player1Paddle, this.player2Paddle)

    if (result.point && this.onPoint) {
      this.onPoint(result.point.winner, result.point.reason)
    }

    const ballState = this.physics.getState()
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

  private updateTrajectory(ballState: BallState) {
    if (!ballState.isInPlay) {
      this.trajectoryLine.visible = false
      return
    }

    this.trajectoryLine.visible = true
    const positions = this.trajectoryLine.geometry.attributes.position as THREE.BufferAttribute

    let pos = { ...ballState.position }
    let vel = { ...ballState.velocity }
    const dt = 0.02

    for (let i = 0; i < 60; i++) {
      positions.setXYZ(i, pos.x, pos.y, pos.z)

      vel.y += PHYSICS.GRAVITY * dt
      pos.x += vel.x * dt
      pos.y += vel.y * dt
      pos.z += vel.z * dt

      if (pos.y < TABLE.HEIGHT) {
        pos.y = TABLE.HEIGHT
        vel.y = -vel.y * BALL.BOUNCE_COEFFICIENT
      }
    }

    positions.needsUpdate = true
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
