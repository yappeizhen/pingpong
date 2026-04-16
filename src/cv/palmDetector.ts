import type { HandPrediction, PalmPosition, Handedness } from '@/types'

export function extractPalmPosition(hand: HandPrediction): PalmPosition {
  if (hand.landmarks.length < 21) {
    return { x: 0.5, y: 0.5, z: 0.5, isOpen: false, confidence: 0 }
  }

  const wrist = hand.landmarks[0]
  const indexBase = hand.landmarks[5]
  const middleBase = hand.landmarks[9]
  const ringBase = hand.landmarks[13]
  const pinkyBase = hand.landmarks[17]

  const palmCenter = {
    x: (wrist.x + indexBase.x + middleBase.x + ringBase.x + pinkyBase.x) / 5,
    y: (wrist.y + indexBase.y + middleBase.y + ringBase.y + pinkyBase.y) / 5,
    z: (wrist.z + indexBase.z + middleBase.z + ringBase.z + pinkyBase.z) / 5,
  }

  const isOpen = detectOpenPalm(hand)

  return {
    x: palmCenter.x,
    y: palmCenter.y,
    z: palmCenter.z,
    isOpen,
    confidence: hand.score,
  }
}

function detectOpenPalm(hand: HandPrediction): boolean {
  const fingerTips = [8, 12, 16, 20]
  const fingerPIPs = [6, 10, 14, 18]
  const fingerMCPs = [5, 9, 13, 17]

  let extendedCount = 0

  for (let i = 0; i < 4; i++) {
    const tip = hand.landmarks[fingerTips[i]]
    const pip = hand.landmarks[fingerPIPs[i]]
    const mcp = hand.landmarks[fingerMCPs[i]]

    // Finger is extended if tip is above PIP AND significantly above MCP
    const tipAbovePip = tip.y < pip.y
    const tipAboveMcp = tip.y < mcp.y - 0.02

    if (tipAbovePip && tipAboveMcp) {
      extendedCount++
    }
  }

  // Require at least 4 fingers extended (stricter than before)
  return extendedCount >= 4
}

export function getPrimaryHand(hands: HandPrediction[], preferred: Handedness = 'Right'): HandPrediction | null {
  if (hands.length === 0) return null
  if (hands.length === 1) return hands[0]

  const preferredHand = hands.find((h) => h.handedness === preferred)
  if (preferredHand) return preferredHand

  return hands.reduce((best, current) => (current.score > best.score ? current : best))
}

export function handToPaddlePosition(
  palm: PalmPosition,
  _hand: HandPrediction
): { x: number; y: number } {
  // Scale factor: larger = more hand movement needed, gentler response
  // 0.8 means 80% of camera view = 100% of paddle range
  const SCALE_X = 0.80  // Gentle horizontal scaling
  const SCALE_Y = 0.70  // Gentle vertical scaling
  
  // Center offset: where in camera space maps to paddle center
  // palm.x/y are 0-1 where 0,0 is top-left of camera feed
  // Shift CENTER_X to give more room for leftward movement
  const CENTER_X = 0.55  // Shifted right to give more left room
  const CENTER_Y = 0.50  // Middle of camera view = paddle center
  
  // Map from camera space to paddle space with scaling
  const rawX = 1 - palm.x // Mirror horizontally
  const rawY = 1 - palm.y // Invert Y (hand up = paddle up)
  
  // Center the mapping
  const scaledX = 0.5 + (rawX - CENTER_X) / SCALE_X
  const scaledY = 0.5 + (rawY - (1 - CENTER_Y)) / SCALE_Y
  
  // Clamp to valid range
  return {
    x: Math.max(0.08, Math.min(0.92, scaledX)),
    y: Math.max(0.08, Math.min(0.92, scaledY)),
  }
}
