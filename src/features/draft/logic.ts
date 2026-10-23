// Pure helpers for the Big Board.

export const BOARD_SIZE = 100
// A full two-round mock needs 64 players; the rest of the board is reserve.
export const MOCK_PICKS = 64

// Position chips and the roster positions behind each one.
export const POSITION_GROUPS: Record<string, string[] | null> = {
  ALL: null,
  QB: ['QB'],
  RB: ['RB', 'FB', 'HB'],
  WR: ['WR'],
  TE: ['TE'],
  OL: ['OL', 'OT', 'OG', 'C', 'G', 'T', 'IOL'],
  DL: ['DL', 'DT', 'NT'],
  EDGE: ['DE', 'EDGE'],
  LB: ['LB', 'ILB', 'OLB'],
  CB: ['CB'],
  S: ['S', 'FS', 'SS', 'DB'],
}

// The season whose numbers and roster belong to a draft: the draft in spring
// 2027 follows the 2026 season.
export const statsSeasonFor = (draftYear: number) => draftYear - 1

// CFBD stores height in inches and weight in pounds: 6'4" · 225 lb.
export function sizeText(height: number | null, weight: number | null) {
  const parts: string[] = []
  if (height) parts.push(`${Math.floor(height / 12)}'${height % 12}"`)
  if (weight) parts.push(`${weight} lb`)
  return parts.join(' · ')
}

// Moves one entry to a new index and returns a new list.
export function move<T>(list: readonly T[], from: number, to: number) {
  if (from === to || from < 0 || from >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

// The years to offer: every stored board plus the default draft year.
export function boardYears(stored: readonly number[], fallback: number) {
  return [...new Set([...stored, fallback])].sort((a, b) => a - b)
}
