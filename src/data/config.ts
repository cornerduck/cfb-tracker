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
