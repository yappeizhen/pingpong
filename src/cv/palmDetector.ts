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

  // Clamp to 0-1 range - MediaPipe can return values slightly outside
  // this range when hand is near camera edges
  return {
    x: Math.max(0, Math.min(1, palmCenter.x)),
    y: Math.max(0, Math.min(1, palmCenter.y)),
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

    // Use distance-based detection (rotation invariant)
    // Finger is extended if tip is further from MCP than PIP is from MCP
    const tipToMcp = Math.hypot(tip.x - mcp.x, tip.y - mcp.y)
    const pipToMcp = Math.hypot(pip.x - mcp.x, pip.y - mcp.y)
    
    // Extended if fingertip is at least 1.5x further from knuckle than the middle joint
    if (tipToMcp > pipToMcp * 1.5) {
      extendedCount++
    }
  }

  // Require at least 3 fingers extended (more lenient for edge positions)
  return extendedCount >= 3
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
  // Direct mapping: hand position maps 1:1 to paddle position
  // No device-specific offsets - just mirror and invert as needed
  const x = 1 - palm.x // Mirror horizontally (so moving left moves paddle left)
  const y = 1 - palm.y // Invert Y (hand up = paddle up)
  
  // Clamp to valid range (0-1)
  return {
    x: Math.max(0.0, Math.min(1.0, x)),
    y: Math.max(0.0, Math.min(1.0, y)),
  }
}
