import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { seasonConfig } from '../../data/config'
import type { SeasonModel } from '../../data/model'
import { projectField } from '../../data/standings'
import type { Game } from '../../data/types'
import { dayMonth } from '../../shared/format'
import { Empty, Plate, Tile } from '../../shared/ui'

type Slot = { seed: number | null; teamId: number | null; label: string; score: number | null; won: boolean }
type Matchup = { key: string; top: Slot; bottom: Slot; homeBottom: boolean; footer: string; game: Game | null }

const FIRST_ROUND: Array<[number, number]> = [[8, 9], [5, 12], [6, 11], [7, 10]]
const QF_SEEDS = [1, 4, 3, 2]

function slotFrom(model: SeasonModel, game: Game | null, teamId: number | null, seed: number | null, fallback: string): Slot {
  if (teamId === null) return { seed, teamId, label: fallback, score: null, won: false }
  if (!game) return { seed, teamId, label: model.team(teamId)?.school ?? fallback, score: null, won: false }
  const home = game.home_team_id === teamId
  const score = home ? game.home_points : game.away_points
  return { seed, teamId, label: model.team(teamId)?.school ?? fallback, score: game.status === 'scheduled' ? null : score, won: model.winnerId(game) === teamId }
}

// A click on a team opens its page, a click anywhere else on the card opens the game.
function BracketCard({ matchup }: { matchup: Matchup }) {
  const { model, openWindow } = useApp()
  const navigate = useNavigate()
  const openGame = () => { if (matchup.game) openWindow({ type: 'game', gameId: matchup.game.id }) }
  return (
    <div role="button" tabIndex={matchup.game ? 0 : -1} aria-disabled={!matchup.game} className={`bracket-card${matchup.game ? '' : ' disabled'}`}
      onClick={openGame} onKeyDown={(event) => { if (event.key === 'Enter') openGame() }}>
      {[matchup.top, matchup.bottom].map((slot, index) => {
        const team = slot.teamId !== null ? model.team(slot.teamId) : undefined
        return (
          <span key={index} className={`bracket-slot${slot.won ? ' won' : ''}${slot.teamId === null ? ' tbd' : ''}${team ? ' linked' : ''}`}
            onClick={team ? (event) => { event.stopPropagation(); navigate(`/teams/${team.slug}`) } : undefined}>
            <span className="at-slot cond">{index === 1 && matchup.homeBottom ? '@' : ''}</span>
            <span className="muted num seed">{slot.seed ?? ''}</span>
            {slot.teamId !== null ? <Plate team={team} size={22} /> : <span className="plate-empty" />}
            <span className="grow truncate">{slot.label}</span>
            {slot.score !== null && <strong className="cond num">{slot.score}</strong>}
          </span>
        )
      })}
      <span className="bracket-foot cond">{matchup.footer}</span>
    </div>
  )
}

function Bracket12() {
  const { model, period, timeZone, mobile } = useApp()
  const order = period?.order ?? 0
  const projection = useMemo(() => projectField(model, order), [model, order])
  const cfpGames = model.games.filter((game) => game.cfp_round)
  const actual = cfpGames.length > 0
  const seedTeam = new Map<number, number>()
  if (actual) {
    for (const game of cfpGames) {
      if (game.home_seed) seedTeam.set(game.home_seed, game.home_team_id)
      if (game.away_seed) seedTeam.set(game.away_seed, game.away_team_id)
    }
  } else for (const entry of projection.field) seedTeam.set(entry.seed, entry.teamId)

  const teamOf = (seed: number) => seedTeam.get(seed) ?? null
  const findGame = (round: string, teamIds: Array<number | null>) =>
    cfpGames.find((game) => game.cfp_round === round && teamIds.some((id) => id !== null && (game.home_team_id === id || game.away_team_id === id))) ?? null
  const footer = (game: Game | null, fallback: string) =>
    game ? [game.bowl_name && !/first round/i.test(game.bowl_name) ? game.bowl_name : null, dayMonth(game.start_time, timeZone)].filter(Boolean).join(' · ').toUpperCase() || fallback : fallback

  const firstRound: Matchup[] = FIRST_ROUND.map(([high, low]) => {
    const game = actual ? findGame('First Round', [teamOf(high), teamOf(low)]) : null
    return {
      key: `fr-${high}`,
      top: slotFrom(model, game, teamOf(low), low, 'TBD'),
      bottom: slotFrom(model, game, teamOf(high), high, 'TBD'),
      homeBottom: true,
      footer: footer(game, 'ON CAMPUS'),
      game,
    }
  })
  const winnerOf = (matchup: Matchup) => matchup.game ? model.winnerId(matchup.game) : null
  const quarterfinals: Matchup[] = QF_SEEDS.map((seed, index) => {
    const fr = firstRound[index]
    const frWinner = winnerOf(fr)
    const game = actual ? findGame('Quarterfinal', [teamOf(seed), frWinner]) : null
    const lowLabel = `${fr.bottom.seed} / ${fr.top.seed} winner`
    const opponent = game ? (game.home_team_id === teamOf(seed) ? game.away_team_id : game.home_team_id) : frWinner
    const opponentSeed = opponent === null ? null : [...seedTeam].find(([, id]) => id === opponent)?.[0] ?? null
    return {
      key: `qf-${seed}`,
      top: slotFrom(model, game, teamOf(seed), seed, 'TBD'),
      bottom: opponent !== null ? slotFrom(model, game, opponent, opponentSeed, lowLabel) : { seed: null, teamId: null, label: lowLabel, score: null, won: false },
      homeBottom: false,
      footer: footer(game, 'BOWL TBA'),
      game,
    }
  })
  const semi = (a: number, b: number): Matchup => {
    const ids = [winnerOf(quarterfinals[a]), winnerOf(quarterfinals[b])]
    const game = actual ? findGame('Semifinal', ids) : null
    return {
      key: `sf-${a}`,
      top: ids[0] !== null ? slotFrom(model, game, ids[0], null, 'QF winner') : { seed: null, teamId: null, label: 'QF winner', score: null, won: false },
      bottom: ids[1] !== null ? slotFrom(model, game, ids[1], null, 'QF winner') : { seed: null, teamId: null, label: 'QF winner', score: null, won: false },
      homeBottom: false,
      footer: footer(game, 'BOWL TBA'),
      game,
    }
  }
  const semis = [semi(0, 1), semi(2, 3)]
  const titleIds = semis.map(winnerOf)
  const titleGame = actual ? findGame('National Championship', titleIds) ?? cfpGames.find((game) => game.cfp_round === 'National Championship') ?? null : null
  const final: Matchup = {
    key: 'final',
    top: titleGame ? slotFrom(model, titleGame, titleGame.away_team_id, titleGame.away_seed, 'Semifinal winner') : { seed: null, teamId: titleIds[0], label: titleIds[0] ? model.team(titleIds[0])?.school ?? '' : 'Semifinal winner', score: null, won: false },
    bottom: titleGame ? slotFrom(model, titleGame, titleGame.home_team_id, titleGame.home_seed, 'Semifinal winner') : { seed: null, teamId: titleIds[1], label: titleIds[1] ? model.team(titleIds[1])?.school ?? '' : 'Semifinal winner', score: null, won: false },
    homeBottom: false,
    footer: titleGame ? footer(titleGame, '') : (seasonConfig(model.year).titleGameVenue ?? 'NATIONAL CHAMPIONSHIP').toUpperCase(),
    game: titleGame,
  }

  if (!seedTeam.size) return <Empty>The bracket appears once the first poll is released.</Empty>

  return (
    <div className={mobile ? 'bracket-mobile' : 'rankings-layout'}>
      <section className="tile bracket">
        {!actual && <p className="projected-note"><span className="pill-tag cond">PROJECTED</span> Built from the {projection.source === 'CFP' ? 'latest CFP ranking' : 'AP Poll'} and current conference leaders{projection.source === 'AP' ? ' until the first CFP ranking' : ''}.</p>}
        <div className="bracket-grid">
          <div className="bracket-col"><h3 className="cond">FIRST ROUND</h3><div className="bracket-col-body">{firstRound.map((matchup) => <BracketCard key={matchup.key} matchup={matchup} />)}</div></div>
          <div className="bracket-col"><h3 className="cond">QUARTERFINALS</h3><div className="bracket-col-body">{quarterfinals.map((matchup) => <BracketCard key={matchup.key} matchup={matchup} />)}</div></div>
          <div className="bracket-col bracket-col--semis"><h3 className="cond">SEMIFINALS</h3><div className="bracket-col-body">{semis.map((matchup) => <BracketCard key={matchup.key} matchup={matchup} />)}</div></div>
          <div className="bracket-col bracket-col--final"><h3 className="cond">NATIONAL TITLE</h3><div className="bracket-col-body"><BracketCard matchup={final} /></div></div>
        </div>
      </section>
      <aside className="side-stack scroll-y">
        <Tile title="AUTOMATIC BIDS">
          {projection.autoBids.map((bid) => (
            <div key={bid.label} className="bid-row"><span className="muted">{bid.label}</span><strong>{bid.teamId ? model.team(bid.teamId)?.school : 'TBD'}</strong></div>
          ))}
        </Tile>
        <Tile title="FIRST FOUR OUT">
          {projection.firstFourOut.length ? projection.firstFourOut.map((item) => (
            <div key={item.teamId} className="out-row"><Plate team={model.team(item.teamId)} size={24} /><span className="grow">{model.team(item.teamId)?.school}</span><span className="muted num">#{item.rank}</span></div>
          )) : <Empty>—</Empty>}
        </Tile>
        <Tile title="HOW THE FIELD IS BUILT">
          <p className="muted small">Power 4 champions get in automatically, plus the best Group of 6 champion and Notre Dame if ranked in the top 12. The remaining at-large spots go to the next highest-ranked teams. Seeds follow the ranking; seeds 1 to 4 get a bye.</p>
        </Tile>
      </aside>
    </div>
  )
}

// The 12 team playoff started with the 2024 season. Before that the College
// Football Playoff had four teams: two semifinals and the national title game.
const FIRST_12_TEAM_SEASON = 2024

function Bracket4() {
  const { model, timeZone, mobile } = useApp()
  const playoff = model.games.filter((game) => game.cfp_round)
  const byStart = (a: Game, b: Game) => Date.parse(a.start_time ?? '') - Date.parse(b.start_time ?? '')
  const semifinals = playoff.filter((game) => game.cfp_round === 'Semifinal').sort(byStart)
  const title = playoff.find((game) => game.cfp_round === 'National Championship') ?? null
  const footerOf = (game: Game) => [game.bowl_name && !/college football playoff/i.test(game.bowl_name) ? game.bowl_name : null, dayMonth(game.start_time, timeZone)].filter(Boolean).join(' · ').toUpperCase()
  const matchupOf = (key: string, game: Game): Matchup => ({
    key,
    top: slotFrom(model, game, game.away_team_id, game.away_seed, 'TBD'),
    bottom: slotFrom(model, game, game.home_team_id, game.home_seed, 'TBD'),
    homeBottom: false,
    footer: footerOf(game),
    game,
  })
  if (!semifinals.length && !title) return <Empty>No playoff games stored for {model.year}.</Empty>
  return (
    <div className={mobile ? 'bracket-mobile' : 'rankings-layout'}>
      <section className="tile bracket">
        <div className="bracket-grid bracket-grid--four">
          <div className="bracket-col"><h3 className="cond">SEMIFINALS</h3><div className="bracket-col-body">{semifinals.map((game) => <BracketCard key={game.id} matchup={matchupOf(`sf-${game.id}`, game)} />)}</div></div>
          <div className="bracket-col bracket-col--final"><h3 className="cond">NATIONAL TITLE</h3><div className="bracket-col-body">{title ? <BracketCard matchup={matchupOf('final', title)} /> : <Empty>—</Empty>}</div></div>
        </div>
      </section>
      <aside className="side-stack scroll-y">
        <Tile title="FOUR TEAM PLAYOFF">
          <p className="muted small">The College Football Playoff had four teams until the 2023 season. The 12 team format began in {FIRST_12_TEAM_SEASON}.</p>
        </Tile>
      </aside>
    </div>
  )
}

export function Bracket() {
  const { model } = useApp()
  return model.year < FIRST_12_TEAM_SEASON ? <Bracket4 /> : <Bracket12 />
}
