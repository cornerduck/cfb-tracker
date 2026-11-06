import { useMemo, useState } from 'react'
import { useApp } from '../../app/context'
import { abbr } from '../../data/model'
import type { Game } from '../../data/types'
import { kickoffParts, longDay } from '../../shared/format'
import { Empty, Plate, Tile } from '../../shared/ui'
import { type RatedGame, WATCH_MIN, WATCH_RULES, WATCH_TIERS, rateGame, watchWindows } from './watch'

const recordText = (record: { w: number; l: number; t: number }) =>
  `${record.w}-${record.l}${record.t ? `-${record.t}` : ''}`

function TierTag({ tier }: { tier: string }) {
  return <span className={`watch-tier cond watch-tier--${tier.replace(/\s/g, '-').toLowerCase()}`}>{tier}</span>
}

// The Watch Guide in Scores: every game of the week rated, grouped by kickoff
// window, with the best game of each window on top.
export function WatchGuide({ games }: { games: Game[] }) {
  const { model, favorites, timeZone, openWindow, mobile } = useApp()
  const [showAll, setShowAll] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const windows = useMemo(() => {
    const week = games[0] ? games[0].week : null
    const gameday = model.bundle.gameday.find((row) => row.week === week && row.game_id !== null)?.game_id ?? null
    return watchWindows(games.map((game) => rateGame(model, game, favorites, gameday)))
  }, [games, model, favorites])

  const shown = windows.map((window) => ({
    ...window,
    visible: showAll ? window.games : window.games.filter((item) => item.score >= WATCH_MIN || item.mine),
  }))
  const hidden = shown.reduce((sum, window) => sum + window.games.length - window.visible.length, 0)
  const best = windows.map((window) => ({ start: window.start, top: window.games[0], second: window.games[1] }))
    .filter((item) => item.top && item.top.score >= WATCH_MIN)
  const weekend = best.every((item) => ['SATURDAY', 'SUNDAY'].includes(longDay(item.start, timeZone)))
  const open = (gameId: number) => openWindow({ type: 'game', gameId })

  const label = (item: RatedGame) => {
    const side = (teamId: number) => {
      const rank = model.rankAtKickoff(teamId, item.game)
      return `${rank ? `#${rank} ` : ''}${abbr(model.team(teamId))}`
    }
    return `${side(item.game.away_team_id)} ${item.game.neutral_site ? 'vs' : '@'} ${side(item.game.home_team_id)}`
  }

  const teamLine = (teamId: number, game: Game) => {
    const team = model.team(teamId)
    const rank = model.rankAtKickoff(teamId, game)
    return (
      <span className="watch-team">
        <Plate team={team} size={28} />
        <span className="watch-rank cond num">{rank ?? ''}</span>
        <span className="watch-name cond truncate">{(team?.school ?? 'TBD').toUpperCase()}</span>
        <span className="watch-record num">{recordText(model.record(teamId, model.gameOrder(game) - 0.5))}</span>
      </span>
    )
  }

  if (!windows.length) return <Empty>No kickoff times are set for this week yet.</Empty>

  return (
    <div className="watch-guide">
      {best.length > 0 && (
        <section className="watch-path tile" aria-label="Best game of every kickoff window">
          <div className="watch-path-head">
            <h2 className="section-title cond">{weekend ? 'YOUR SATURDAY' : 'YOUR WEEK'}</h2>
            {!mobile && <span className="muted small">The best game of every kickoff window</span>}
          </div>
          <div className="watch-path-grid">
            {best.map(({ start, top, second }) => (
              <button key={start} type="button" className="watch-path-item" onClick={() => open(top.game.id)}>
                <span className="watch-path-top">
                  <span className="cond num watch-path-time">{kickoffParts(start, timeZone).time}</span>
                  {mobile && <span className="watch-path-game cond truncate">{label(top)}</span>}
                  <TierTag tier={top.tier} />
                </span>
                {!mobile && <span className="watch-path-game cond truncate">{label(top)}</span>}
                <span className="watch-path-sub small muted truncate">
                  {[top.game.tv, top.reasons.find((reason) => reason.kind === 'gameday') ? 'College GameDay' : null,
                    second && second.score >= 75 ? `+ ${label(second)}` : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {shown.map((window) => window.visible.length > 0 && (
        <section key={window.start} className="slot">
          <h2 className="section-title cond watch-slot-title">
            {longDay(window.start, timeZone)} {kickoffParts(window.start, timeZone).date} · {kickoffParts(window.start, timeZone).time}
            <span className="small muted">{window.visible.length} of {window.games.length} games</span>
          </h2>
          <div className="watch-list">
            {window.visible.map((item) => (
              <button key={item.game.id} type="button" className={`watch-row${item.mine ? ' mine' : ''}`} onClick={() => open(item.game.id)}>
                <span className="watch-score">
                  <span className={`cond num watch-score-num watch-score-num--${item.tier.replace(/\s/g, '-').toLowerCase()}`}>{item.score}</span>
                  {!mobile && <span className="watch-bar"><span style={{ width: `${item.score}%` }} className={`watch-bar-fill--${item.tier.replace(/\s/g, '-').toLowerCase()}`} /></span>}
                </span>
                <TierTag tier={item.tier} />
                <span className="watch-teams">
                  {teamLine(item.game.away_team_id, item.game)}
                  {teamLine(item.game.home_team_id, item.game)}
                </span>
                <span className="watch-reasons">
                  {item.reasons.map((reason) => (
                    <span key={reason.label} className={`watch-reason cond${reason.kind ? ` watch-reason--${reason.kind}` : ''}`}>{reason.label}</span>
                  ))}
                </span>
                <span className="watch-meta">
                  <span className="cond watch-tv">{item.game.tv ?? 'TV TBA'}</span>
                  <span className="small muted num">{model.favoriteText(item.game) ?? ''}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {(hidden > 0 || showAll) && (
        <button type="button" className="outline-button cond watch-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'SHOW TOP GAMES ONLY' : `SHOW ${hidden} MORE ${hidden === 1 ? 'GAME' : 'GAMES'}`}
        </button>
      )}
      {mobile && (
        <button type="button" className="tile-link cond watch-rules-link" onClick={() => setRulesOpen((value) => !value)}>
          {rulesOpen ? 'HIDE RATING ×' : 'HOW GAMES ARE RATED ›'}
        </button>
      )}
      {mobile && rulesOpen && <WatchRules />}
    </div>
  )
}

export function WatchRules() {
  return (
    <>
      <Tile title="HOW GAMES ARE RATED">
        <div className="watch-rules">
          {WATCH_RULES.map((rule) => (
            <div key={rule.label} className="watch-rule"><span>{rule.label}</span><strong className="cond num">{rule.pts}</strong></div>
          ))}
        </div>
        <p className="muted small">Ranks from the AP Poll, from the CFP ranking once it is out. Your teams are always listed, whatever their rating.</p>
      </Tile>
      <Tile title="TIERS">
        <div className="watch-rules">
          {WATCH_TIERS.map((item) => (
            <div key={item.tier} className="watch-rule watch-rule--tier"><TierTag tier={item.tier} /><span className="muted num">{item.range}</span></div>
          ))}
        </div>
      </Tile>
    </>
  )
}
