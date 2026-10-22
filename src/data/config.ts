// Season rules that the API does not provide. Times are UTC.
// Source for 2026: College Football Playoff release schedule (fbschedules.com).

export type SeasonConfig = {
  cfpReleases: string[]
  titleGameVenue: string | null
}

export const SEASON_CONFIG: Record<number, SeasonConfig> = {
  2026: {
    cfpReleases: [
      '2026-11-04T00:00:00Z',
      '2026-11-11T02:00:00Z',
      '2026-11-18T02:00:00Z',
      '2026-11-25T00:30:00Z',
      '2026-12-02T00:00:00Z',
      '2026-12-06T17:00:00Z',
    ],
    titleGameVenue: 'Allegiant Stadium · Las Vegas',
  },
  2025: { cfpReleases: [], titleGameVenue: 'Hard Rock Stadium · Miami Gardens' },
}

export const seasonConfig = (year: number): SeasonConfig => SEASON_CONFIG[year] ?? { cfpReleases: [], titleGameVenue: null }

// Divisions the API does not always deliver. Sun Belt keeps East and West
// divisions; the division winners meet in the title game. Keyed by team slug.
// Source for 2026: Sun Belt football media days (sunbeltsports.org).
const SUN_BELT_EAST = ['app-state', 'coastal-carolina', 'georgia-southern', 'georgia-state', 'james-madison', 'marshall', 'old-dominion']
const SUN_BELT_WEST_BASE = ['arkansas-state', 'louisiana', 'ul-monroe', 'south-alabama', 'southern-miss', 'troy']

export function fallbackDivisions(year: number, conferenceSlug: string | undefined): { names: string[]; byTeam: Map<string, string> } | null {
  if (conferenceSlug !== 'sun-belt') return null
  // Texas State left for the Pac-12 and Louisiana Tech joined in 2026.
  const west = [...SUN_BELT_WEST_BASE, year >= 2026 ? 'louisiana-tech' : 'texas-state']
  const byTeam = new Map<string, string>()
  for (const slug of SUN_BELT_EAST) byTeam.set(slug, 'East')
  for (const slug of west) byTeam.set(slug, 'West')
  return { names: ['East', 'West'], byTeam }
}
