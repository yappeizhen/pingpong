import { createContext } from 'react'
import type { HandTracker } from './handTracker'

export const HandTrackerContext = createContext<HandTracker | null>(null)
