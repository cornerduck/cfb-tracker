import { useState, type ReactNode } from 'react'
import { AppContext, useApp, type AppState } from './context'
import { useSeasonModel } from './useSeasonData'
import { ErrorBox, Loading } from '../shared/ui'

// Renders its children against another season. Screens read the season from
// the app context, so the archive can reuse Scores, the bracket and the game
// and player windows for any stored season.
export function SeasonScope({ year, children }: { year: number | undefined; children: ReactNode }) {
  const app = useApp()
  const other = year !== undefined && year !== app.model.year
  const season = useSeasonModel(other ? year : null, false)
  const [periodKey, setPeriodKey] = useState<string | null>(null)
  if (!other) return <>{children}</>
  if (season.error) return <ErrorBox message={(season.error as Error).message} onRetry={() => void season.refetch()} />
  if (!season.model) return <Loading label={`Loading the ${year} season…`} />
  const model = season.model
  const currentPeriod = model.currentPeriod()
  const value: AppState = {
    ...app,
    model,
    period: (periodKey && model.periodByKey.get(periodKey)) || currentPeriod,
    currentPeriod,
    setPeriodKey,
    openWindow: (spec) => app.openWindow(spec.type === 'game' || spec.type === 'player' ? { ...spec, season: model.year } : spec),
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
