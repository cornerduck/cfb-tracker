// Pure helpers for the mock draft.
import type { MockPickRow, MockSlotRow } from '../../data/queries'
import { POSITION_GROUPS } from './logic'

// The next pick to make: the first slot that is not forfeited and has no player yet.
export function nextSlot(slots: readonly MockSlotRow[], picks: readonly MockPickRow[]) {
  const done = new Set(picks.map((pick) => pick.pick))
  return [...slots].sort((a, b) => a.pick - b.pick).find((slot) => !slot.forfeited && !done.has(slot.pick)) ?? null
}

// Picks that can be made in total (forfeited picks do not count).
export const openPicks = (slots: readonly MockSlotRow[]) => slots.filter((slot) => !slot.forfeited).length
export const isComplete = (slots: readonly MockSlotRow[], picks: readonly MockPickRow[]) => nextSlot(slots, picks) === null

// Adds a pick; ignored when the player is already picked or the pick is not the next one.
export function addPick(slots: readonly MockSlotRow[], picks: readonly MockPickRow[], playerId: string) {
  const slot = nextSlot(slots, picks)
  if (!slot || picks.some((pick) => pick.player_id === playerId)) return [...picks]
  return [...picks, { pick: slot.pick, player_id: playerId }]
}

// Takes back the last pick that was made.
export const undoPick = (picks: readonly MockPickRow[]) => picks.slice(0, -1)

// Position chip of a roster position ("OT" counts as OL), or "Other".
export function positionGroup(position: string | null) {
  if (!position) return 'Other'
  for (const [group, list] of Object.entries(POSITION_GROUPS)) if (list?.includes(position)) return group
  return 'Other'
}

// Counts of a list of labels, biggest first (ties alphabetical).
export function tally(labels: readonly string[]) {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export const defaultMockName = (date: Date) =>
  `Mock of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
