import type { Period, SeasonModel } from '../data/model'

// Periods that have a recap: the weekly awards are computed once every game
// of the week is final.
export function recapPeriods(model: SeasonModel) {
  const weeks = new Set(model.bundle.awards.map((award) => award.week))
  return model.periods.filter((period) => weeks.has(model.awardWeekFor(period)))
}

// The recap counts as new until Tuesday night after the week's games.
export function recapIsNew(period: Period, now = Date.now()) {
  return period.end !== null && now <= period.end + 2.5 * 24 * 3600_000
}
