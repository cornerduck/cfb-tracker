import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSeasonBundle, fetchSeasons } from '../data/queries'
import { SeasonModel } from '../data/model'

export function useSeasons(enabled: boolean) {
  return useQuery({ queryKey: ['seasons'], queryFn: fetchSeasons, enabled, staleTime: 10 * 60_000 })
}

// The live season reloads every five minutes so near-live scores appear.
export function useSeasonModel(year: number | null, live: boolean) {
  const query = useQuery({
    queryKey: ['season', year],
    queryFn: () => fetchSeasonBundle(year!),
    enabled: year !== null,
    staleTime: live ? 5 * 60_000 : 60 * 60_000,
    refetchInterval: live ? 5 * 60_000 : false,
  })
  const model = useMemo(() => (query.data ? new SeasonModel(query.data) : null), [query.data])
  return { ...query, model }
}
