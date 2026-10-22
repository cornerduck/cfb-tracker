import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/context'
import { fetchGameDetail } from '../data/queries'
import { abbr, confAbbr, formatSpread, recordText, teamColor } from '../data/model'
import type { PlayerGameStat } from '../data/types'
import { UPSET_LABEL, gameStatusText } from '../shared/GameTile'
import { kickoffParts } from '../shared/format'
import { statNumber } from '../shared/stats'
import { Empty, ErrorBox, Loading, Plate, PlayerAvatar, Tabs } from '../shared/ui'
import { WindowFrame } from './WindowFrame'

const TEAM_STATS: Array<{ key: string; label: string; lowerBetter?: boolean; parse?: 'ratio' | 'penalty' | 'time' }> = [
  { key: 'totalYards', label: 'Total yards' },
  { key: 'netPassingYards', label: 'Passing yards' },
  { key: 'rushingYards', label: 'Rushing yards' },
  { key: 'firstDowns', label: 'First downs' },
  { key: 'thirdDownEff', label: '3rd down', parse: 'ratio' },
  { key: 'turnovers', label: 'Turnovers', lowerBetter: true },
  { key: 'totalPenaltiesYards', label: 'Penalties', lowerBetter: true, parse: 'penalty' },
  { key: 'possessionTime', label: 'Possession', parse: 'time' },
]

const numeric = (value: unknown, parse?: 'ratio' | 'penalty' | 'time') => {
  const text = String(value ?? '')
  if (parse === 'ratio') {
    const [made, tries] = text.split('-').map(Number)
    return tries ? made / tries : 0
  }
  if (parse === 'penalty') return Number(text.split('-')[1] ?? 0) || 0
  if (parse === 'time') {
    const [minutes, seconds] = text.split(':').map(Number)
    return (minutes || 0) * 60 + (seconds || 0)
  }
  return Number(text) || 0
}
const display = (value: unknown, parse?: string) => (parse === 'ratio' ? String(value ?? '').replace('-', '/') : String(value ?? '—'))

const PLAYER_TABLES: Array<{ category: string; title: string; columns: string[]; sort: string }> = [
  { category: 'passing', title: 'PASSING', columns: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'QBR'], sort: 'YDS' },
  { category: 'rushing', title: 'RUSHING', columns: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], sort: 'YDS' },
  { category: 'receiving', title: 'RECEIVING', columns: ['REC', 'YDS', 'AVG', 'TD', 'LONG'], sort: 'YDS' },
  { category: 'defensive', title: 'DEFENSE', columns: ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HUR'], sort: 'TOT' },
  { category: 'interceptions', title: 'INTERCEPTIONS', columns: ['INT', 'YDS', 'TD'], sort: 'INT' },
  { category: 'kicking', title: 'KICKING', columns: ['FG', 'PCT', 'LONG', 'XP', 'PTS'], sort: 'PTS' },
  { category: 'punting', title: 'PUNTING', columns: ['NO', 'YDS', 'AVG', 'In 20', 'LONG'], sort: 'YDS' },
]

// Best player of the whole game in a category, whichever team he plays for.
function leader(rows: PlayerGameStat[], category: string, key: string) {
  const candidates = rows.filter((row) => row.category === category)
  if (category === 'defensive') {
    const interceptions = new Map(rows.filter((row) => row.category === 'interceptions').map((row) => [row.player_id, statNumber(row.stats, 'INT')]))
    candidates.sort((a, b) => statNumber(b.stats, 'TOT') - statNumber(a.stats, 'TOT') || statNumber(b.stats, 'SACKS') - statNumber(a.stats, 'SACKS') ||
      (interceptions.get(b.player_id) ?? 0) - (interceptions.get(a.player_id) ?? 0))
  } else candidates.sort((a, b) => statNumber(b.stats, key) - statNumber(a.stats, key))
  return candidates[0] ?? null
}

const performerLine = (row: PlayerGameStat, category: string, all: PlayerGameStat[]) => {
  const stats = row.stats
  if (category === 'passing') return `${stats['C/ATT'] ?? ''} · ${stats.YDS ?? 0} yds · ${stats.TD ?? 0} TD${statNumber(stats, 'INT') ? ` · ${stats.INT} INT` : ''}`
  if (category === 'rushing') return `${stats.CAR ?? 0} car · ${stats.YDS ?? 0} yds · ${stats.TD ?? 0} TD`
  if (category === 'receiving') return `${stats.REC ?? 0} rec · ${stats.YDS ?? 0} yds · ${stats.TD ?? 0} TD`
  const interceptions = all.find((item) => item.player_id === row.player_id && item.category === 'interceptions')
  return [`${stats.TOT ?? 0} tkl`, statNumber(stats, 'SACKS') ? `${stats.SACKS} sacks` : null, interceptions ? `${interceptions.stats.INT} INT` : null].filter(Boolean).join(' · ')
}

export function GameWindow({ gameId }: { gameId: number }) {
  const { model, timeZone, openWindow, closeWindow, mobile } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'SUMMARY' | 'PLAYER STATS'>('SUMMARY')
  const game = model.gameById.get(gameId)
  const detail = useQuery({ queryKey: ['game', gameId], queryFn: () => fetchGameDetail(gameId), enabled: Boolean(game) && game?.status !== 'scheduled', staleTime: 5 * 60_000 })
  if (!game) return <WindowFrame title="GAME" onClose={closeWindow}><Empty>This game is not in the selected season.</Empty></WindowFrame>

  const order = model.gameOrder(game)
  const kickoff = kickoffParts(game.start_time, timeZone)
  const period = model.periodByKey.get(model.periodKeyOf(game))
  const upset = model.upset(game)
  const winner = model.winnerId(game)
  const spread = model.spreads.get(game.id) ?? null
  const total = model.totals.get(game.id) ?? null
  const headerLine = [game.cfp_round ?? game.bowl_name ?? period?.label, `${kickoff.day} ${kickoff.date}`, game.venue, game.tv].filter(Boolean).join(' · ').toUpperCase()
  const sides = [
    { teamId: game.away_team_id, points: game.away_points, lines: game.away_line_scores },
    { teamId: game.home_team_id, points: game.home_points, lines: game.home_line_scores },
  ]
  const teamLabel = (teamId: number) => {
    const conference = model.conferenceOf(teamId)
    const record = model.record(teamId, game.status === 'final' ? order : order - 1)
    const conf = model.confRecord(teamId, game.status === 'final' ? order : order - 1)
    return `${recordText(record)}${conference && confAbbr(conference) !== 'IND' ? ` · ${recordText(conf)} ${confAbbr(conference)}` : ''}`
  }

  const periods = Math.max(4, game.away_line_scores?.length ?? 0, game.home_line_scores?.length ?? 0)
  const teamStats = detail.data?.teamStats ?? []
  const players = detail.data?.playerStats ?? []
  const ou = total !== null && game.status === 'final' && game.home_points !== null && game.away_points !== null
    ? (game.home_points + game.away_points > total ? 'Over' : game.home_points + game.away_points < total ? 'Under' : 'Push') : null

  const summary = (
    <div className="game-summary">
      <div className="game-summary-left">
        <h3 className="cond">BOX SCORE</h3>
        <table className="box">
          <thead><tr><th className="cond">TEAM</th>{Array.from({ length: periods }, (_, index) => <th key={index} className="cond num">{index < 4 ? index + 1 : periods > 5 ? `OT${index - 3}` : 'OT'}</th>)}<th className="cond num">T</th></tr></thead>
          <tbody>
            {sides.map((side, index) => (
              <tr key={side.teamId} className={winner === side.teamId ? 'won' : winner ? 'lost' : ''}>
                <td className="cond">{index ? (game.neutral_site ? 'vs ' : '@ ') : ''}{abbr(model.team(side.teamId))}</td>
                {Array.from({ length: periods }, (_, period) => <td key={period} className="num">{side.lines?.[period] ?? (game.status === 'scheduled' ? '' : '–')}</td>)}
                <td className="num strong">{side.points ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="cond">BETTING LINE</h3>
        <div className="line-boxes">
          <div><span>Closing spread</span><strong className="cond num">{model.favoriteText(game) ?? '—'}</strong></div>
          <div><span>Over / under</span><strong className="cond num">{total !== null ? formatSpread(total) : '—'}{ou ? ` · ${ou}` : ''}</strong></div>
          <div><span>Upset tier</span><strong className={`cond ${upset ? `tier-${upset.tier}` : ''}`}>{upset ? { upset: 'Upset', big: 'Big upset', stunner: 'Stunner' }[upset.tier] : spread === null ? '—' : 'None'}</strong></div>
        </div>
        <h3 className="cond">TOP PERFORMERS</h3>
        {detail.isLoading ? <Loading /> : players.length ? (
          <div className="performers">
            {(['passing', 'rushing', 'receiving', 'defensive'] as const).map((category) => {
              const row = leader(players, category, 'YDS')
              if (!row) return null
              return (
                <button key={category} type="button" className="performer" onClick={() => openWindow({ type: 'player', playerId: row.player_id, name: row.player_name, teamId: row.team_id })}>
                  <span className="cond muted performer-cat">{category === 'defensive' ? 'DEFENSE' : category.toUpperCase()}</span>
                  <PlayerAvatar playerId={row.player_id} team={model.team(row.team_id)} size={28} />
                  <span className="grow truncate">{row.player_name}</span>
                  <span className="num secondary">{performerLine(row, category, players)}</span>
                </button>
              )
            })}
          </div>
        ) : <Empty>{game.status === 'scheduled' ? 'Box scores appear after kickoff.' : 'Player stats arrive with the Sunday update.'}</Empty>}
      </div>
      <div className="game-summary-right">
        <div className="team-stats-head cond">
          <span style={{ color: teamColor(model.team(game.away_team_id)) }}>{model.team(game.away_team_id)?.school.toUpperCase()}</span>
          <span>TEAM STATS</span>
          <span style={{ color: teamColor(model.team(game.home_team_id)) }}>{model.team(game.home_team_id)?.school.toUpperCase()}</span>
        </div>
        {detail.isLoading ? <Loading /> : teamStats.length ? TEAM_STATS.map((stat) => {
          const away = teamStats.find((row) => row.team_id === game.away_team_id)?.stats[stat.key]
          const home = teamStats.find((row) => row.team_id === game.home_team_id)?.stats[stat.key]
          if (away === undefined && home === undefined) return null
          const a = numeric(away, stat.parse)
          const h = numeric(home, stat.parse)
          const sum = a + h || 1
          const awayBetter = stat.lowerBetter ? a < h : a > h
          return (
            <div key={stat.key} className="team-stat">
              <div className="team-stat-values"><strong className={`cond num${awayBetter ? '' : ' muted'}`}>{display(away, stat.parse)}</strong><span className="muted small">{stat.label}</span><strong className={`cond num${!awayBetter && a !== h ? '' : ' muted'}`}>{display(home, stat.parse)}</strong></div>
              <div className="team-stat-bars">
                <span style={{ width: `${(a / sum) * 100}%`, background: teamColor(model.team(game.away_team_id)), opacity: awayBetter ? 1 : 0.45 }} />
                <span style={{ width: `${(h / sum) * 100}%`, background: teamColor(model.team(game.home_team_id)), opacity: !awayBetter && a !== h ? 1 : 0.45 }} />
              </div>
            </div>
          )
        }) : <Empty>Team stats appear after the game.</Empty>}
      </div>
    </div>
  )

  const playerTables = (
    <div className="player-tables">
      {sides.map((side, index) => {
        const team = model.team(side.teamId)
        return (
          <div key={side.teamId} className="player-side">
            <h3 className="cond side-title" style={{ borderColor: teamColor(team) }}>{index ? (game.neutral_site ? 'VS ' : '@ ') : ''}{team?.school.toUpperCase()}</h3>
            {PLAYER_TABLES.map((table) => {
              const rows = players.filter((row) => row.team_id === side.teamId && row.category === table.category)
                .sort((a, b) => statNumber(b.stats, table.sort) - statNumber(a.stats, table.sort))
              if (!rows.length) return null
              return (
                <table key={table.category} className="stat-table">
                  <caption className="cond">{table.title}</caption>
                  <thead><tr><th className="cond">PLAYER</th>{table.columns.map((column) => <th key={column} className="cond num">{column}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.player_id} onClick={() => openWindow({ type: 'player', playerId: row.player_id, name: row.player_name, teamId: row.team_id })}>
                        <td className="truncate"><span className="player-cell"><PlayerAvatar playerId={row.player_id} team={team} size={22} /><span className="truncate">{row.player_name}</span></span></td>
                        {table.columns.map((column) => <td key={column} className="num">{row.stats[column] ?? '–'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })}
          </div>
        )
      })}
    </div>
  )

  return (
    <WindowFrame className="game-window" onClose={closeWindow} kicker={headerLine}>
      <div className="game-hero">
        {sides.map((side, index) => {
          const team = model.team(side.teamId)
          const rank = model.apRankAtKickoff(side.teamId, game)
          const seed = index ? game.home_seed : game.away_seed
          const lost = winner !== null && winner !== side.teamId
          const block = (
            <button type="button" className={`hero-team${index ? ' right' : ''}${lost ? ' lost' : ''}`} onClick={() => { closeWindow(); navigate(`/teams/${team?.slug}`) }}>
              <Plate team={team} size={mobile ? 44 : 64} />
              <span className="hero-copy">
                <strong className="cond">{seed ? <small className="muted">({seed}) </small> : rank ? <small className="muted">{rank} </small> : null}{(mobile ? abbr(team) : team?.school ?? 'TBD').toUpperCase()}</strong>
                <span className="muted small">{teamLabel(side.teamId)}</span>
              </span>
            </button>
          )
          return (
            <div key={side.teamId} className={`hero-side${index ? ' right' : ''}`}>
              {block}
              {game.status !== 'scheduled' && <span className={`hero-score cond num${lost ? ' lost' : ''}`}>{side.points}</span>}
            </div>
          )
        })}
        <div className="hero-center cond">
          <span>{game.status === 'scheduled' ? kickoff.time : gameStatusText(model, game, timeZone).split(' · ')[0]}</span>
          <span className="muted">{game.neutral_site ? 'vs' : '@'}</span>
          {upset && <span className={`stamp stamp--${upset.tier} stamp--hero cond`}>{UPSET_LABEL[upset.tier]}{upset.winnerSpread ? ` · +${formatSpread(upset.winnerSpread)}` : ''}</span>}
        </div>
      </div>
      <Tabs items={['SUMMARY', 'PLAYER STATS'] as const} value={tab} onChange={setTab} />
      <div className="window-scroll">
        {detail.error ? <ErrorBox message={(detail.error as Error).message} onRetry={() => void detail.refetch()} /> : tab === 'SUMMARY' ? summary : players.length ? playerTables : <Empty>Player stats appear after the game.</Empty>}
      </div>
    </WindowFrame>
  )
}
