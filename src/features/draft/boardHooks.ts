import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBigBoards, fetchPlayerSeason, fetchRosterByIds, saveBigBoard, type BigBoardRow } from '../../data/queries'
import type { RosterPlayer } from '../../data/types'
import { statsSeasonFor } from './logic'

// The board of every year lives in one query; saves are queued so two quick
// changes can never arrive out of order.
export function useBigBoards() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['big-board'], queryFn: fetchBigBoards, staleTime: 60_000 })
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(new Map<number, string[]>())
  const running = useRef(false)

  const flush = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (pending.current.size) {
        const [year, ids] = pending.current.entries().next().value as [number, string[]]
        pending.current.delete(year)
        await saveBigBoard(year, ids)
      }
      setError(null)
    } catch (failure) {
      pending.current.clear()
      setError(failure instanceof Error ? failure.message : 'The board could not be saved.')
      void queryClient.invalidateQueries({ queryKey: ['big-board'] })
    } finally {
      running.current = false
    }
  }, [queryClient])

  const rows = query.data
  const idsFor = useCallback((year: number) => (rows ?? []).filter((row) => row.draft_year === year).sort((a, b) => a.rank - b.rank).map((row) => row.player_id), [rows])
  const setBoard = useCallback((year: number, ids: string[]) => {
    queryClient.setQueryData<BigBoardRow[]>(['big-board'], (old) => [
      ...(old ?? []).filter((row) => row.draft_year !== year),
      ...ids.map((id, index) => ({ draft_year: year, player_id: id, rank: index + 1 })),
    ])
    pending.current.set(year, ids)
    void flush()
  }, [queryClient, flush])
  return { query, years: useMemo(() => [...new Set((rows ?? []).map((row) => row.draft_year))], [rows]), idsFor, setBoard, error, clearError: () => setError(null) }
}

// Roster rows (newest season first, so the first row per player wins) and the
// stat rows of the season that belongs to the draft.
export function useBoardPlayers(year: number, ids: string[]) {
  const season = statsSeasonFor(year)
  const key = useMemo(() => [...ids].sort().join(','), [ids])
  const query = useQuery({
    queryKey: ['board-players', season, key],
    queryFn: async () => {
      const [roster, stats] = await Promise.all([fetchRosterByIds(ids), fetchPlayerSeason(season, ids)])
      const byPlayer = new Map<string, RosterPlayer>()
      for (const row of roster) if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, row)
      return { byPlayer, stats }
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  })
  return query
}
