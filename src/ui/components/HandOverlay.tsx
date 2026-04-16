import { useRef, useEffect } from 'react'
import { useHandData } from '@/cv'
import { extractPalmPosition } from '@/cv/palmDetector'
import './HandOverlay.css'

const DEBUG = true

const LANDMARK_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

interface Props {
  showLandmarks?: boolean
  showPaddle?: boolean
  paddleColor?: string
}

export function HandOverlay({ 
  showLandmarks = true, 
  showPaddle = true,
  paddleColor = '#4ade80'
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { frame, status } = useHandData()

  useEffect(() => {
    if (DEBUG) {
      console.log('[HandOverlay] status:', status, 'frame:', frame ? `${frame.hands.length} hands` : 'null')
    }
  }, [frame, status])

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

    if (DEBUG) {
      ctx.font = '14px monospace'
      ctx.fillStyle = status === 'ready' ? '#4ade80' : '#ffaa00'
      ctx.textAlign = 'right'
      ctx.fillText(`Tracking: ${status}`, canvas.width - 10, 20)
      
      if (frame) {
        ctx.fillText(`Hands: ${frame.hands.length}`, canvas.width - 10, 40)
      }
    }

    if (!frame || frame.hands.length === 0) return

    frame.hands.forEach((hand, handIndex) => {
      if (hand.landmarks.length < 21) return

      const palm = extractPalmPosition(hand)
      
      const mirroredLandmarks = hand.landmarks.map(lm => ({
        x: 1 - lm.x,
        y: lm.y,
        z: lm.z
      }))

      const palmX = (1 - palm.x) * canvas.width
      const palmY = palm.y * canvas.height

      if (showLandmarks) {
        const baseColor = handIndex === 0 ? paddleColor : '#22d3ee'
        
        ctx.strokeStyle = palm.isOpen 
          ? baseColor 
          : 'rgba(255, 100, 100, 0.6)'
        ctx.lineWidth = 2

        LANDMARK_CONNECTIONS.forEach(([start, end]) => {
          const startLm = mirroredLandmarks[start]
          const endLm = mirroredLandmarks[end]
          
          ctx.beginPath()
          ctx.moveTo(startLm.x * canvas.width, startLm.y * canvas.height)
          ctx.lineTo(endLm.x * canvas.width, endLm.y * canvas.height)
          ctx.stroke()
        })

        mirroredLandmarks.forEach((lm, i) => {
          const x = lm.x * canvas.width
          const y = lm.y * canvas.height
          
          const isTip = [4, 8, 12, 16, 20].includes(i)
          const isBase = [0, 5, 9, 13, 17].includes(i)
          
          ctx.beginPath()
          ctx.arc(x, y, isTip ? 6 : isBase ? 5 : 3, 0, Math.PI * 2)
          
          if (isTip) {
            ctx.fillStyle = palm.isOpen ? baseColor : 'rgba(255, 100, 100, 0.8)'
          } else if (isBase) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
          }
          ctx.fill()
        })
      }

      if (showPaddle) {
        const paddleRadius = Math.min(canvas.width, canvas.height) * 0.08
        
        ctx.beginPath()
        ctx.arc(palmX, palmY, paddleRadius, 0, Math.PI * 2)
        
        if (palm.isOpen) {
          const gradient = ctx.createRadialGradient(
            palmX, palmY, 0,
            palmX, palmY, paddleRadius
          )
          gradient.addColorStop(0, `${paddleColor}99`)
          gradient.addColorStop(0.7, `${paddleColor}66`)
          gradient.addColorStop(1, `${paddleColor}00`)
          ctx.fillStyle = gradient
          ctx.fill()
          
          ctx.strokeStyle = paddleColor
          ctx.lineWidth = 3
          ctx.stroke()
          
          ctx.beginPath()
          ctx.arc(palmX, palmY, paddleRadius * 0.3, 0, Math.PI * 2)
          ctx.fillStyle = `${paddleColor}cc`
          ctx.fill()
        } else {
          ctx.strokeStyle = 'rgba(255, 100, 100, 0.5)'
          ctx.lineWidth = 2
          ctx.setLineDash([5, 5])
          ctx.stroke()
          ctx.setLineDash([])
          
          ctx.font = 'bold 12px Inter, sans-serif'
          ctx.fillStyle = 'rgba(255, 100, 100, 0.8)'
          ctx.textAlign = 'center'
          ctx.fillText('CLOSED', palmX, palmY + 4)
        }
      }
    })

    if (frame.hands.length > 0) {
      const fps = Math.round(frame.fps)
      ctx.font = '12px monospace'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.textAlign = 'left'
      ctx.fillText(`${fps} FPS`, 10, canvas.height - 10)
      
      frame.hands.forEach((hand, i) => {
        const palm = extractPalmPosition(hand)
        ctx.fillText(
          `${hand.handedness}: ${palm.isOpen ? 'OPEN' : 'CLOSED'}`,
          10,
          canvas.height - 30 - i * 16
        )
      })
    }
  }, [frame, showLandmarks, showPaddle, paddleColor])

  return <canvas ref={canvasRef} className="hand-overlay" />
}
