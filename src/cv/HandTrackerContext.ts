import { createContext } from 'react'
import type { HandFrame, HandTrackingStatus } from '@/types'

export interface HandTrackerContextValue {
  status: HandTrackingStatus
  frame: HandFrame | null
  videoRef: (node: HTMLVideoElement | null) => void
  error: string | null
  restart: () => Promise<void>
}

export const HandTrackerContext = createContext<HandTrackerContextValue | undefined>(undefined)
