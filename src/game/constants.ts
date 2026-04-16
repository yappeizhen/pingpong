export const TABLE = {
  WIDTH: 1.525,
  LENGTH: 2.74,
  HEIGHT: 0.76,
  NET_HEIGHT: 0.1525,
  LINE_WIDTH: 0.02,
  COLOR: 0x1a5f2a,
  LINE_COLOR: 0xffffff,
} as const

export const BALL = {
  RADIUS: 0.02,
  MASS: 0.0027,
  COLOR: 0xffa500,
  INITIAL_SPEED: 2.2,
  MAX_SPEED: 6.0,
  BOUNCE_COEFFICIENT: 0.9,
  SPIN_FACTOR: 0.2,
} as const

export const PADDLE = {
  RADIUS: 0.10,
  THICKNESS: 0.01,
  COLOR: 0xff4444,
  OPPONENT_COLOR: 0x4444ff,
  HIT_ZONE: 0.18,
  ACTIVE_OPACITY: 0.9,
  INACTIVE_OPACITY: 0.4,
} as const

export const PHYSICS = {
  GRAVITY: -6.0,
  AIR_RESISTANCE: 0.995,
  TIME_STEP: 1 / 120,
  TABLE_FRICTION: 0.8,
} as const

export const CAMERA = {
  FOV: 50,
  NEAR: 0.1,
  FAR: 100,
  POSITION: { x: 0, y: 2.0, z: 2.5 },
  LOOK_AT: { x: 0, y: TABLE.HEIGHT, z: 0 },
} as const

export const GAME = {
  POINTS_TO_WIN: 11,
  SERVE_SWITCH_INTERVAL: 2,
  COUNTDOWN_SECONDS: 3,
  RALLY_TIMEOUT_MS: 10000,
} as const

export const MULTIPLAYER = {
  PADDLE_SYNC_INTERVAL_MS: 33,
  BALL_SYNC_INTERVAL_MS: 50,
  STATE_RECONCILE_THRESHOLD: 0.1,
} as const
