import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { confName } from '../../data/model'
import type { Conference, Team } from '../../data/types'
import { Pills, Tabs } from '../../shared/ui'
import { PortalView } from './PortalView'
import { RankingsView } from './RankingsView'
import { RecruitsView } from './RecruitsView'
import { POSITION_GROUPS, classYearsFor, portalYearsFor, type PositionGroup } from './logic'

const VIEWS = ['CLASS RANKINGS', 'TOP RECRUITS', 'PORTAL'] as const
type View = typeof VIEWS[number]
const VIEW_PARAM: Record<View, string> = { 'CLASS RANKINGS': 'rankings', 'TOP RECRUITS': 'players', PORTAL: 'portal' }

export type RecruitingFilters = {
  year: number
  team: Team | null
  conference: Conference | null
  mine: boolean
  position: PositionGroup | null
  state: string | null
  setParam: (patch: Record<string, string | null>) => void
  clearTeam: () => void
  setYear: (year: number) => void
}

export function Recruiting() {
  const { model, liveYear, mobile } = useApp()
  const [params, setParams] = useSearchParams()
  const view: View = VIEWS.find((item) => VIEW_PARAM[item] === params.get('view')) ?? 'CLASS RANKINGS'
  const years = view === 'PORTAL' ? portalYearsFor(liveYear) : classYearsFor(liveYear)
  const requested = Number(params.get('year'))
  const year = years.includes(requested) ? requested : years[0]
  const slug = params.get('team')
  const team = useMemo(() => (slug ? [...model.teams.values()].find((item) => item.slug === slug && model.fbsIds.has(item.id)) ?? null : null), [model, slug])
  const conferences = useMemo(() => model.conferenceList(), [model])
  const conference = conferences.find((item) => item.slug === params.get('conf')) ?? null
  const position = POSITION_GROUPS.find((item) => item === params.get('pos')) ?? null
  const teams = useMemo(() => [...model.teams.values()].filter((item) => model.fbsIds.has(item.id)).sort((a, b) => a.school.localeCompare(b.school)), [model])

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }
  const goView = (target: View) => {
    const next: Record<string, string> = {}
    if (VIEW_PARAM[target] !== 'rankings') next.view = VIEW_PARAM[target]
    if (params.get('team')) next.team = params.get('team')!
    const targetYears = target === 'PORTAL' ? portalYearsFor(liveYear) : classYearsFor(liveYear)
    if (targetYears.includes(year) && year !== targetYears[0]) next.year = String(year)
    setParams(next, { replace: true })
  }
  const filters: RecruitingFilters = {
    year,
    team,
    conference,
    mine: params.get('mine') === '1',
    position,
    state: params.get('state'),
    setParam,
    clearTeam: () => setParam({ team: null }),
    setYear: (value) => setParam({ year: value === years[0] ? null : String(value) }),
  }

  return (
    <div className="recruiting">
      <div className="page-head page-head--tabs">
        <h1 className="cond">RECRUITING</h1>
        <Tabs items={VIEWS} value={view} onChange={goView} />
      </div>
      <div className="rc-filters">
        <Pills items={years.map(String)} value={String(year)} onChange={(value) => filters.setYear(Number(value))} />
        <span className="grow" />
        {view === 'CLASS RANKINGS' && !team && (
          <button type="button" className={`pill cond${filters.mine ? ' active' : ''}`} aria-pressed={filters.mine} onClick={() => setParam({ mine: filters.mine ? null : '1' })}>MY TEAMS</button>
        )}
        {view !== 'TOP RECRUITS' && !(view === 'CLASS RANKINGS' && team) && (
          <select className="select cond rc-select" aria-label="Conference" value={conference?.slug ?? ''} onChange={(event) => setParam({ conf: event.target.value || null })}>
            <option value="">ALL CONFERENCES</option>
            {conferences.map((item) => <option key={item.id} value={item.slug}>{confName(item).toUpperCase()}</option>)}
          </select>
        )}
        <select className="select cond rc-select" aria-label="Team" value={team?.slug ?? ''} onChange={(event) => setParam({ team: event.target.value || null })}>
          <option value="">ALL TEAMS</option>
          {teams.map((item) => <option key={item.id} value={item.slug}>{item.school.toUpperCase()}</option>)}
        </select>
      </div>
      {view === 'CLASS RANKINGS' ? <RankingsView filters={filters} mobile={mobile} />
        : view === 'TOP RECRUITS' ? <RecruitsView filters={filters} mobile={mobile} />
          : <PortalView filters={filters} mobile={mobile} />}
    </div>
  )
}
