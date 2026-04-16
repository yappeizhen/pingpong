import { useRef, useEffect } from 'react'
import { useHandData } from '@/cv'
import { extractPalmPosition, handToPaddlePosition } from '@/cv/palmDetector'
import { SwipeDetector } from '@/cv/swipeDetector'
import './HandOverlay.css'

interface Props {
  showDebug?: boolean
  paddleColor?: string
  paddleSize?: number
}

export function HandOverlay({ 
  showDebug = false,
  paddleColor = '#4ade80',
  paddleSize = 0.04,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const swipeDetectorRef = useRef<SwipeDetector | null>(null)
  const trailRef = useRef<Array<{ x: number; y: number; time: number }>>([])
  const { frame, status } = useHandData()

  useEffect(() => {
    swipeDetectorRef.current = new SwipeDetector()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const updateSize = () => {
      const parent = canvas.parentElement
      if (parent) {
        canvas.width = parent.clientWidth
        canvas.height = parent.clientHeight
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)

    return () => window.removeEventListener('resize', updateSize)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (showDebug) {
      ctx.font = '12px monospace'
      ctx.fillStyle = status === 'ready' ? '#4ade80' : '#ffaa00'
      ctx.textAlign = 'right'
      ctx.fillText(`Tracking: ${status}`, canvas.width - 10, 20)
      if (frame) {
        ctx.fillText(`Hands: ${frame.hands.length}`, canvas.width - 10, 36)
      }
    }

    if (!frame || frame.hands.length === 0) return

    frame.hands.forEach((hand, handIndex) => {
      if (hand.landmarks.length < 21) return

      const palm = extractPalmPosition(hand)
      const swipe = swipeDetectorRef.current?.update(palm.isOpen ? palm : null) ?? { isSwinging: false, speed: 0 }
      
      // Use scaled paddle position so overlay matches actual game paddle
      const paddlePos = handToPaddlePosition(palm, hand)
      const palmX = paddlePos.x * canvas.width
      const palmY = (1 - paddlePos.y) * canvas.height

      const baseSize = Math.min(canvas.width, canvas.height)
      const paddleRadius = baseSize * paddleSize

      const color = handIndex === 0 ? paddleColor : '#22d3ee'

      // Update trail
      const now = performance.now()
      if (palm.isOpen) {
        trailRef.current.push({ x: palmX, y: palmY, time: now })
      }
      trailRef.current = trailRef.current.filter(p => now - p.time < 150)

      // Draw motion trail when swinging
      if (trailRef.current.length > 2 && swipe.isSwinging) {
        ctx.beginPath()
        ctx.moveTo(trailRef.current[0].x, trailRef.current[0].y)
        for (let i = 1; i < trailRef.current.length; i++) {
          ctx.lineTo(trailRef.current[i].x, trailRef.current[i].y)
        }
        ctx.strokeStyle = `${color}88`
        ctx.lineWidth = paddleRadius * 1.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
      }

      if (palm.isOpen) {
        ctx.save()
        
        // Yellow theme - brighter when swinging
        ctx.shadowColor = swipe.isSwinging ? '#ffee00' : color
        ctx.shadowBlur = swipe.isSwinging ? 30 : 15
        
        // Paddle grows slightly when swinging
        const swingScale = swipe.isSwinging ? 1.15 : 1.0
        const currentRadius = paddleRadius * swingScale
        
        ctx.beginPath()
        ctx.arc(palmX, palmY, currentRadius, 0, Math.PI * 2)
        // Yellow, brighter when swinging
        ctx.fillStyle = swipe.isSwinging ? '#ffee55' : color
        ctx.globalAlpha = 0.9
        ctx.fill()
        
        ctx.strokeStyle = swipe.isSwinging ? '#ffffff' : 'rgba(255, 255, 255, 0.8)'
        ctx.lineWidth = swipe.isSwinging ? 3 : 2
        ctx.globalAlpha = 1
        ctx.stroke()
        
        // Inner circle
        ctx.beginPath()
        ctx.arc(palmX, palmY, currentRadius * 0.5, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
        
        // Handle - use raw landmarks for angle calculation
        const wrist = hand.landmarks[0]
        const rawPalmX = (1 - palm.x) * canvas.width
        const rawPalmY = palm.y * canvas.height
        const wristX = (1 - wrist.x) * canvas.width
        const wristY = wrist.y * canvas.height
        
        const angle = Math.atan2(wristY - rawPalmY, wristX - rawPalmX)
        const handleLength = currentRadius * 0.7
        const handleX = palmX + Math.cos(angle) * (currentRadius + handleLength * 0.3)
        const handleY = palmY + Math.sin(angle) * (currentRadius + handleLength * 0.3)
        
        ctx.beginPath()
        ctx.moveTo(
          palmX + Math.cos(angle) * currentRadius * 0.7,
          palmY + Math.sin(angle) * currentRadius * 0.7
        )
        ctx.lineTo(handleX, handleY)
        ctx.strokeStyle = '#8B4513'
        ctx.lineWidth = currentRadius * 0.35
        ctx.lineCap = 'round'
        ctx.stroke()
        
        ctx.restore()

        // Show swing indicator when ready to hit
        if (swipe.isSwinging) {
          ctx.font = 'bold 12px Inter, sans-serif'
          ctx.fillStyle = '#ffffff'
          ctx.textAlign = 'center'
          ctx.fillText('●', palmX, palmY - currentRadius - 8)
        }
      } else {
        // Dimmed yellow when palm is closed
        trailRef.current = []
        ctx.beginPath()
        ctx.arc(palmX, palmY, paddleRadius, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255, 221, 0, 0.5)'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
        
        ctx.font = 'bold 16px Inter, sans-serif'
        ctx.fillStyle = 'rgba(255, 221, 0, 0.7)'
        ctx.textAlign = 'center'
        ctx.fillText('✊', palmX, palmY + 5)
      }
    })

    if (showDebug && frame.hands.length > 0) {
      ctx.font = '11px monospace'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.textAlign = 'left'
      ctx.fillText(`${Math.round(frame.fps)} FPS`, 10, canvas.height - 10)
    }
  }, [frame, status, showDebug, paddleColor, paddleSize])

  return <canvas ref={canvasRef} className="hand-overlay" />
}
