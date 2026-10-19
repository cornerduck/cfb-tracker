import { number } from './format'

// A short stat line such as "QB · 412 pass yds · 5 TD · 0 INT".
export function playerLine(position: string, line: Record<string, number | undefined>) {
  const value = (key: string) => Number(line[key] ?? 0)
  const parts: string[] = []
  if (value('pass_yds')) {
    parts.push(`${number(value('pass_yds'))} pass yds`, `${value('pass_td')} TD`, `${value('int')} INT`)
    if (value('rush_yds') >= 40) parts.push(`${value('rush_yds')} rush yds`)
  } else if (value('rush_yds') >= value('rec_yds') && value('rush_yds')) {
    parts.push(`${number(value('rush_yds'))} rush yds`, `${value('rush_td')} TD`)
    if (value('rec_yds')) parts.push(`${value('rec_yds')} rec yds`)
  } else if (value('rec_yds')) {
    if (value('rec')) parts.push(`${value('rec')} rec`)
    parts.push(`${number(value('rec_yds'))} yds`, `${value('rec_td')} TD`)
  } else if (value('tackles') || value('sacks') || value('def_int')) {
    if (value('tackles')) parts.push(`${value('tackles')} tkl`)
    if (value('sacks')) parts.push(`${value('sacks')} sacks`)
    if (value('def_int')) parts.push(`${value('def_int')} INT`)
  }
  return [position && position !== 'DEF' ? position : '', ...parts].filter(Boolean).join(' · ')
}

export const statNumber = (stats: Record<string, unknown> | undefined, key: string) => {
  if (!stats) return 0
  const raw = stats[key]
  const parsed = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}
