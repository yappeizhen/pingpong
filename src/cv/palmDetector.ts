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
  return {
    x: 1 - palm.x,
    y: 1 - palm.y,
  }
}
