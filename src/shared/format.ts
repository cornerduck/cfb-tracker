// Dates are stored in UTC and shown in the user's time zone.

const parts = (iso: string, timeZone: string) => {
  const date = new Date(iso)
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return values as Record<string, string>
}

export const kickoffParts = (iso: string | null, timeZone: string) => {
  if (!iso) return { day: 'TBA', date: '', time: 'TBA', dayKey: 'tba' }
  const p = parts(iso, timeZone)
  return {
    day: p.weekday.toUpperCase(),
    date: `${p.day} ${p.month.toUpperCase()}`,
    time: `${p.hour}:${p.minute}`,
    dayKey: `${p.weekday} ${p.day} ${p.month}`,
  }
}

export const longDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(new Date(iso)).toUpperCase()

export const shortDateTime = (iso: string | null, timeZone: string) => {
  if (!iso) return 'TBA'
  const p = parts(iso, timeZone)
  return `${p.weekday} ${p.hour}:${p.minute}`
}

export const dayMonth = (iso: string | null, timeZone: string) => {
  if (!iso) return ''
  const p = parts(iso, timeZone)
  return `${p.weekday} ${p.day} ${p.month}`
}

export const fullDateTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))

export const countdown = (target: number, now = Date.now()) => {
  const ms = Math.max(0, target - now)
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return { days, hours, minutes, text: days ? `${days}D ${hours}H` : `${hours}H ${minutes}M` }
}

export const number = (value: number) => new Intl.NumberFormat('en-US').format(value)
