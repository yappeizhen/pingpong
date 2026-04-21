export const TABLE = {
  WIDTH: 1.525,
  LENGTH: 2.74,
  HEIGHT: 0.76,
  NET_HEIGHT: 0.1525,
  LINE_WIDTH: 0.02,
  COLOR: 0x1565c0,        // Darker muted blue
  SURFACE_COLOR: 0x1976d2, // Medium blue for surface
  EDGE_COLOR: 0x0d47a1,   // Dark blue for edges
  LINE_COLOR: 0xffffff,
} as const

export const BALL = {
  RADIUS: 0.02,
  MASS: 0.0027,
  COLOR: 0xfaebd7,        // Antique white/cream - warmer ping pong ball color
  INITIAL_SPEED: 2.45,
  MAX_SPEED: 6.2,
  BOUNCE_COEFFICIENT: 0.89,
  SPIN_FACTOR: 0.16,
} as const

export const PADDLE = {
  RADIUS: 0.10,
  THICKNESS: 0.01,
  COLOR: 0xffdd00,        // Yellow for player 1 (you)
  OPPONENT_COLOR: 0xf44336, // Red for player 2 (AI)
  HIT_ZONE: 0.18,
  ACTIVE_OPACITY: 0.9,
  INACTIVE_OPACITY: 0.4,
} as const

export const PHYSICS = {
  GRAVITY: -7.2,
  AIR_RESISTANCE: 0.995,
  TIME_STEP: 1 / 120,
  TABLE_FRICTION: 0.86,
} as const

export const CAMERA = {
  FOV: 50,
  NEAR: 0.1,
  FAR: 100,
  POSITION: { x: 0, y: 2.0, z: 2.8 },
  LOOK_AT: { x: 0, y: TABLE.HEIGHT, z: -0.1 },
} as const

export const GAME = {
  POINTS_TO_WIN: 7,
  SERVE_SWITCH_INTERVAL: 2,
  COUNTDOWN_SECONDS: 3,
  RALLY_TIMEOUT_MS: 10000,
} as const

export const MULTIPLAYER = {
  PADDLE_SYNC_INTERVAL_MS: 33,
  BALL_SYNC_INTERVAL_MS: 50,
  STATE_RECONCILE_THRESHOLD: 0.1,
} as const
