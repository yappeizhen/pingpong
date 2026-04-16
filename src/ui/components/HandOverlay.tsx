import { useRef, useEffect } from 'react'
import { useHandData } from '@/cv'
import { extractPalmPosition } from '@/cv/palmDetector'
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
  const { frame, status } = useHandData()

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
      
      const palmX = (1 - palm.x) * canvas.width
      const palmY = palm.y * canvas.height

      const baseSize = Math.min(canvas.width, canvas.height)
      const paddleRadius = baseSize * paddleSize

      const color = handIndex === 0 ? paddleColor : '#22d3ee'

      if (palm.isOpen) {
        ctx.save()
        ctx.shadowColor = color
        ctx.shadowBlur = 15
        
        ctx.beginPath()
        ctx.arc(palmX, palmY, paddleRadius, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.9
        ctx.fill()
        
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.globalAlpha = 0.8
        ctx.stroke()
        
        ctx.beginPath()
        ctx.arc(palmX, palmY, paddleRadius * 0.6, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.lineWidth = 1
        ctx.stroke()
        
        const handleLength = paddleRadius * 0.8
        const wrist = hand.landmarks[0]
        const wristX = (1 - wrist.x) * canvas.width
        const wristY = wrist.y * canvas.height
        
        const angle = Math.atan2(wristY - palmY, wristX - palmX)
        const handleX = palmX + Math.cos(angle) * (paddleRadius + handleLength * 0.3)
        const handleY = palmY + Math.sin(angle) * (paddleRadius + handleLength * 0.3)
        
        ctx.beginPath()
        ctx.moveTo(
          palmX + Math.cos(angle) * paddleRadius * 0.8,
          palmY + Math.sin(angle) * paddleRadius * 0.8
        )
        ctx.lineTo(handleX, handleY)
        ctx.strokeStyle = '#8B4513'
        ctx.lineWidth = paddleRadius * 0.4
        ctx.lineCap = 'round'
        ctx.globalAlpha = 0.9
        ctx.stroke()
        
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.arc(palmX, palmY, paddleRadius, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.6)'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
        
        ctx.font = 'bold 10px Inter, sans-serif'
        ctx.fillStyle = 'rgba(255, 100, 100, 0.8)'
        ctx.textAlign = 'center'
        ctx.fillText('✊', palmX, palmY + 4)
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
