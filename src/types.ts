export type LiveUpdateState = 'healthy' | 'overdue' | 'failed' | 'running' | 'uninitialized' | 'unavailable'

export type LiveUpdateSnapshot = {
  state: LiveUpdateState
  last_updated: string | null
  job: string | null
  current_week: number | null
  season_active: boolean
  overdue: boolean
}
