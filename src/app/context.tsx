import { createContext, useContext } from 'react'
import type { Account } from './useAccount'
import type { Period, SeasonModel } from '../data/model'

export type WindowSpec =
  | { type: 'game'; gameId: number; season?: number }
  | { type: 'player'; playerId: string; name?: string; teamId?: number | null; season?: number }
  | { type: 'top25' }
  | { type: 'undefeated' }
  | { type: 'gameday'; week?: number; season?: number }
  | { type: 'search' }
  | { type: 'favorites' }
  | { type: 'account' }
  | { type: 'error' }

export type AppState = {
  account: Account
  timeZone: string
  favorites: Set<number>
  model: SeasonModel
  liveYear: number
  seasons: Array<{ year: number; status: 'archived' | 'live' }>
  period: Period | null
  currentPeriod: Period | null
  setPeriodKey: (key: string) => void
  openWindow: (spec: WindowSpec) => void
  closeWindow: () => void
  backWindow: () => void
  windowDepth: number
  mobile: boolean
}

export const AppContext = createContext<AppState | null>(null)

export const useApp = () => {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside the app shell')
  return value
}
