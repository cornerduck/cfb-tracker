import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchNflTeams, fetchPickOrders, refreshNflTeams, savePickOrder, type PickExceptionRow, type PickOrderRow } from '../../data/queries'
import { TEAM_COUNT } from './pickOrder'

const REFRESH_AFTER_MS = 2 * 60 * 60 * 1000

export type Saved = { teamOrder: string[] | null; exceptions: PickExceptionRow[] }

// The pick orders of every year live in one query; saves are queued so two
// quick changes can never arrive out of order.
export function usePickOrders() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['pick-orders'], queryFn: fetchPickOrders, staleTime: 60_000 })
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(new Map<number, Saved>())
  const running = useRef(false)

  const flush = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (pending.current.size) {
        const [year, value] = pending.current.entries().next().value as [number, Saved]
        pending.current.delete(year)
        await savePickOrder(year, value.teamOrder, value.exceptions)
      }
      setError(null)
    } catch (failure) {
      pending.current.clear()
      setError(failure instanceof Error ? failure.message : 'The pick order could not be saved.')
      void queryClient.invalidateQueries({ queryKey: ['pick-orders'] })
    } finally {
      running.current = false
    }
  }, [queryClient])

  const rows = query.data
  const savedFor = useCallback((year: number): Saved => {
    const row = (rows ?? []).find((item) => item.draft_year === year)
    return { teamOrder: row?.team_order ?? null, exceptions: row?.exceptions ?? [] }
  }, [rows])
  const setOrder = useCallback((year: number, value: Saved) => {
    queryClient.setQueryData<PickOrderRow[]>(['pick-orders'], (old) => [
      ...(old ?? []).filter((row) => row.draft_year !== year),
      ...(value.teamOrder || value.exceptions.length ? [{ draft_year: year, team_order: value.teamOrder, exceptions: value.exceptions }] : []),
    ])
    pending.current.set(year, value)
    void flush()
  }, [queryClient, flush])
  return { query, savedFor, setOrder, error, clearError: () => setError(null) }
}

// The records come from ESPN and are cached in the database. Opening the tab
// asks for a refresh when the stored records are old or missing.
export function useNflTeams() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['nfl-teams'], queryFn: fetchNflTeams, staleTime: 5 * 60_000 })
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const asked = useRef(false)
  const teams = query.data
  useEffect(() => {
    if (!teams || asked.current) return
    const oldest = teams.length === TEAM_COUNT ? Math.min(...teams.map((team) => Date.parse(team.updated_at))) : 0
    if (Date.now() - oldest < REFRESH_AFTER_MS) return
    asked.current = true
    refreshNflTeams()
      .then(() => queryClient.invalidateQueries({ queryKey: ['nfl-teams'] }))
      .catch((failure: unknown) => setRefreshError(failure instanceof Error ? failure.message : 'The records could not be updated.'))
  }, [teams, queryClient])
  return { query, refreshError }
}
