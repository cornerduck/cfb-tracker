import { useQuery } from '@tanstack/react-query'
import { fetchGamedayStops } from '../../data/queries'
import type { GamedayStop, Team } from '../../data/types'

export function useGamedayStops() {
  return useQuery({ queryKey: ['gameday-stops'], queryFn: fetchGamedayStops, staleTime: 60 * 60_000 })
}

export const STATE_CODES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', 'D.C.': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE',
  Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
}

export const stateCode = (state: string | null | undefined) => (state ? STATE_CODES[state.trim()] ?? state.trim() : '')

export const placeLabel = (stop: Pick<GamedayStop, 'city' | 'state'>) =>
  [stop.city, stateCode(stop.state)].filter(Boolean).join(', ')

export const placeKey = (stop: Pick<GamedayStop, 'city' | 'state'>) => `${(stop.city ?? '').toLowerCase()}|${stateCode(stop.state)}`

// Result from the host's point of view; neutral-site shows read as neutral.
export function hostResult(stop: GamedayStop): 'W' | 'L' | 'T' | null {
  if (stop.host_points === null || stop.visitor_points === null) return null
  return stop.host_points > stop.visitor_points ? 'W' : stop.host_points < stop.visitor_points ? 'L' : 'T'
}

export const isNeutral = (stop: GamedayStop, host: Team | undefined) =>
  /inside|neutral|bowl|championship/i.test(`${stop.site ?? ''} ${stop.notes ?? ''}`) ||
  Boolean(host?.location?.city && stop.city && host.location.city.toLowerCase() !== stop.city.toLowerCase())

export type TeamGameday = { appearances: number; w: number; l: number; homeShows: number; homeW: number; homeL: number; awayW: number; awayL: number }

export function teamGameday(stops: GamedayStop[], teamId: number, host: Team | undefined): TeamGameday {
  const line: TeamGameday = { appearances: 0, w: 0, l: 0, homeShows: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0 }
  for (const stop of stops) {
    const isHost = stop.host_team_id === teamId
    if (!isHost && stop.visitor_team_id !== teamId) continue
    line.appearances += 1
    const atHome = isHost && !isNeutral(stop, host)
    if (atHome) line.homeShows += 1
    const result = hostResult(stop)
    if (!result || result === 'T') continue
    const won = (result === 'W') === isHost
    if (won) line.w += 1
    else line.l += 1
    if (atHome) {
      if (won) line.homeW += 1
      else line.homeL += 1
    } else if (!isHost) {
      if (won) line.awayW += 1
      else line.awayL += 1
    }
  }
  return line
}
