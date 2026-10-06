import { useEffect, useState } from 'react'
import './App.css'

type TabName = 'Home' | 'Scores' | 'Rankings' | 'Standings' | 'Stats' | 'Teams' | "Pick'em" | 'Archive'
type WindowName = 'game' | 'player' | 'rankings' | 'gameday' | 'undefeated' | 'favorites' | 'search' | 'error' | 'settings' | null
type TeamFilter = 'Power 4' | 'Group of 6' | 'Independents' | 'My Teams' | 'All 138'

const desktopTabs: TabName[] = ['Home', 'Scores', 'Rankings', 'Standings', 'Stats', 'Teams', "Pick'em", 'Archive']
type MobileTab = 'Home' | 'Scores' | 'Rankings' | 'Standings' | 'More'
const mobileTabs: MobileTab[] = ['Home', 'Scores', 'Rankings', 'Standings', 'More']
type ScoresView = 'WEEK 6' | 'WEEK 7' | 'CONF CHAMP' | 'BOWLS' | 'CFP'
type RankingsView = 'AP POLL' | 'COACHES' | 'CFP' | 'PLAYOFF BRACKET'
type StatsView = 'PLAYERS' | 'TEAMS' | 'HEISMAN'
type ArchiveView = 'SEASONS' | 'ALL TIME' | 'GAMEDAY HISTORY'
type StatCategory = 'PASSING' | 'RUSHING' | 'RECEIVING' | 'DEFENSE'
type TeamPageView = 'OVERVIEW' | 'SCHEDULE' | 'STATS' | 'HISTORY'
type GameWindowView = 'SUMMARY' | 'PLAYER STATS'
type LiveUpdateState = 'healthy' | 'overdue' | 'failed' | 'running' | 'uninitialized' | 'unavailable'
type LiveUpdateSnapshot = {
  state: LiveUpdateState
  last_updated: string | null
  job: string | null
  current_week: number | null
  season_active: boolean
  overdue: boolean
}

const awardDetails = [
  { label: 'UPSET OF THE WEEK', bar: 'linear-gradient(90deg, #F08A3C 0, #F08A3C 100%)', result: 'TEX 31 — ALA 27', sub: 'Biggest spread win' },
  { label: 'GAME OF THE WEEK', bar: 'linear-gradient(90deg, #D9DCE0 0, #D9DCE0 100%)', result: 'MICH 24 — OSU 21', sub: 'Closest win' },
  { label: 'BLOWOUT', bar: 'linear-gradient(90deg, #4CC38A 0, #4CC38A 100%)', result: 'ND 38 — UGA 10', sub: 'Most decisive margin' },
  { label: 'PERFORMANCE', bar: 'linear-gradient(90deg, #D09B5A 0, #D09B5A 100%)', result: 'J. HART • QB • TCU', sub: 'Best individual line' },
]

const rankings = [
  { rank: 1, name: 'Texas', record: '12–1', badge: 'TEX', color: '#BF5700', hot: true, streak: '8' },
  { rank: 2, name: 'Georgia', record: '11–2', badge: 'UGA', color: '#BA0C2F', hot: false },
  { rank: 3, name: 'Ohio State', record: '11–2', badge: 'OSU', color: '#BB0000', hot: true, streak: '5' },
  { rank: 4, name: 'Ole Miss', record: '10–3', badge: 'OM', color: '#CE1126', hot: false },
  { rank: 5, name: 'Alabama', record: '10–3', badge: 'ALA', color: '#9E1B32', hot: false },
]

const apPoll = [
  { abbr: 'OSU', name: 'Ohio State', color: '#BB0000', record: '6–0', conf: 'B1G', points: '1,550 (58)', last: 'W 45–3 vs Wisconsin', next: '@ Illinois' },
  { abbr: 'IND', name: 'Indiana', color: '#990000', record: '6–0', conf: 'B1G', points: '1,481 (4)', last: 'W 38–24 vs #11 Penn St', next: '@ Northwestern' },
  { abbr: 'ORE', name: 'Oregon', color: '#154733', record: '6–0', conf: 'B1G', points: '1,420', last: 'W 31–17 @ Washington', next: '@ #9 USC' },
  { abbr: 'MIA', name: 'Miami', color: '#F47321', record: '6–0', conf: 'ACC', points: '1,352', last: 'W 35–14 vs Florida St', next: 'vs Louisville' },
  { abbr: 'TEX', name: 'Texas', color: '#BF5700', record: '5–1', conf: 'SEC', points: '1,290', last: 'W 27–20 vs #9 Oklahoma', next: 'vs #10 Alabama' },
  { abbr: 'ND', name: 'Notre Dame', color: '#0C2340', record: '5–0', conf: 'IND', points: '1,201', last: 'Bye', next: 'vs Stanford' },
  { abbr: 'BYU', name: 'BYU', color: '#002E5D', record: '6–0', conf: 'B12', points: '1,133', last: 'W 24–20 @ #24 Utah', next: 'vs Arizona' },
  { abbr: 'LSU', name: 'LSU', color: '#461D7C', record: '5–1', conf: 'SEC', points: '1,060', last: 'W 28–17 vs Auburn', next: '@ #12 Georgia' },
  { abbr: 'USC', name: 'USC', color: '#990000', record: '5–1', conf: 'B1G', points: '997', last: 'W 34–21 @ Illinois', next: 'vs #3 Oregon' },
  { abbr: 'ALA', name: 'Alabama', color: '#9E1B32', record: '5–1', conf: 'SEC', points: '941', last: 'W 31–10 vs S Carolina', next: '@ #5 Texas' },
  { abbr: 'TENN', name: 'Tennessee', color: '#FF8200', record: '5–1', conf: 'SEC', points: '880', last: 'W 41–13 vs Kentucky', next: 'vs Arkansas' },
  { abbr: 'UGA', name: 'Georgia', color: '#BA0C2F', record: '4–2', conf: 'SEC', points: '812', last: 'L 24–27 vs #14 Ole Miss', next: 'vs #8 LSU' },
  { abbr: 'MICH', name: 'Michigan', color: '#00274C', record: '5–1', conf: 'B1G', points: '760', last: 'L 24–27 vs Purdue', next: '@ Minnesota' },
  { abbr: 'MISS', name: 'Ole Miss', color: '#CE1126', record: '5–1', conf: 'SEC', points: '702', last: 'W 27–24 @ #7 Georgia', next: 'vs Kentucky' },
  { abbr: 'OU', name: 'Oklahoma', color: '#841617', record: '4–2', conf: 'SEC', points: '640', last: 'L 20–27 @ #5 Texas', next: 'vs Missouri' },
  { abbr: 'TTU', name: 'Texas Tech', color: '#CC0000', record: '5–1', conf: 'B12', points: '588', last: 'W 30–28 @ #16 K-State', next: 'vs Baylor' },
  { abbr: 'PSU', name: 'Penn State', color: '#041E42', record: '4–2', conf: 'B1G', points: '505', last: 'L 24–38 @ #2 Indiana', next: 'vs Iowa' },
  { abbr: 'VAN', name: 'Vanderbilt', color: '#866D4B', record: '6–0', conf: 'SEC', points: '441', last: 'W 35–31 vs Missouri', next: '@ Florida' },
  { abbr: 'ASU', name: 'Arizona State', color: '#8C1D40', record: '5–1', conf: 'B12', points: '380', last: 'W 28–14 vs Colorado', next: '@ Houston' },
  { abbr: 'SMU', name: 'SMU', color: '#0033A0', record: '5–1', conf: 'ACC', points: '322', last: 'W 38–20 vs Duke', next: '@ Clemson' },
  { abbr: 'PUR', name: 'Purdue', color: '#CEB888', record: '5–1', conf: 'B1G', points: '260', last: 'W 27–24 @ #4 Michigan', next: 'vs Nebraska' },
  { abbr: 'ISU', name: 'Iowa State', color: '#C8102E', record: '5–1', conf: 'B12', points: '211', last: 'W 17–16 vs Kansas', next: '@ Cincinnati' },
  { abbr: 'LOU', name: 'Louisville', color: '#AD0000', record: '5–1', conf: 'ACC', points: '170', last: 'W 30–24 @ NC State', next: '@ #4 Miami' },
  { abbr: 'UNLV', name: 'UNLV', color: '#CF0A2C', record: '6–0', conf: 'MW', points: '133', last: 'W 20–17 vs Boise St', next: '@ Fresno St' },
  { abbr: 'TAMU', name: 'Texas A&M', color: '#500000', record: '4–2', conf: 'SEC', points: '102', last: 'L 21–24 @ Arkansas', next: 'vs Florida' },
]

const myTeams = [
  { name: 'Indiana', rank: '#1', record: '13–0', result: 'W 27-21', last: 'vs. Michigan', badge: 'IND', color: '#990000', hot: true, streak: '11' },
  { name: 'Texas', rank: '#2', record: '12–1', result: 'W 31-17', last: 'at Alabama', badge: 'TEX', color: '#BF5700', hot: true, streak: '8' },
  { name: 'LSU', rank: '#7', record: '9–4', result: 'L 20-27', last: 'vs. Arkansas', badge: 'LSU', color: '#461D7C', hot: false },
]

const heisman = [
  { rank: 2, name: 'M. Williams', score: '94.1', badge: 'TEX', color: '#BF5700' },
  { rank: 3, name: 'K. Howard', score: '91.8', badge: 'IND', color: '#990000' },
  { rank: 4, name: 'T. Foster', score: '89.6', badge: 'LSU', color: '#461D7C' },
]

const scores = [
  { away: { abbr: 'IND', rank: '#1', name: 'Hoosiers', score: 27, color: '#990000', hot: true, streak: '11', conf: 'B1G' }, home: { abbr: 'MIA', rank: '#4', name: 'Hurricanes', score: 21, color: '#F47321', hot: false, conf: 'ACC' }, status: 'FINAL', upset: false },
  { away: { abbr: 'MICH', rank: '#3', name: 'Wolverines', score: 24, color: '#00274C', hot: true, streak: '5', conf: 'B1G' }, home: { abbr: 'OSU', rank: '#2', name: 'Buckeyes', score: 21, color: '#BB0000', hot: false, conf: 'B1G' }, status: 'FINAL', upset: true },
  { away: { abbr: 'LSU', rank: '#8', name: 'Tigers', score: 41, color: '#461D7C', hot: false, conf: 'SEC' }, home: { abbr: 'MISS', rank: '#6', name: 'Rebels', score: 28, color: '#CE1126', hot: true, streak: '3', conf: 'SEC' }, status: 'FINAL', upset: false },
  { away: { abbr: 'TEX', rank: '#2', name: 'Longhorns', score: 31, color: '#BF5700', hot: true, streak: '8', conf: 'SEC' }, home: { abbr: 'ALA', rank: '#10', name: 'Crimson Tide', score: 17, color: '#9E1B32', hot: false, conf: 'SEC' }, status: 'FINAL', upset: true },
]

const badgeStyle = (color: string, size = 24) => ({
  width: `${size}px`,
  height: `${size}px`,
  borderRadius: '4px',
  background: color,
  color: '#FFFFFF',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: size > 30 ? '13px' : '11px',
  fontWeight: 700,
  letterSpacing: 0
})

const conferenceLeaderRows = [
  { short: 'B1G', name: 'Big Ten', leader: 'Indiana', style: 'active' },
  { short: 'SEC', name: 'SEC', leader: 'Texas', style: '' },
  { short: 'ACC', name: 'ACC', leader: 'Miami', style: '' },
  { short: 'B12', name: 'Big 12', leader: 'Texas Tech', style: '' },
  { short: 'AAC', name: 'American', leader: 'Memphis', style: '' },
  { short: 'CUSA', name: 'Conference USA', leader: 'Liberty', style: '' },
  { short: 'MAC', name: 'Mid-American', leader: 'Toledo', style: '' },
  { short: 'MW', name: 'Mountain West', leader: 'UNLV', style: '' },
  { short: 'PAC', name: 'Pac-12', leader: 'Oregon State', style: '' },
  { short: 'SUN', name: 'Sun Belt', leader: 'James Madison', style: '' },
  { short: 'IND', name: 'Independent', leader: 'Notre Dame', style: '' },
]

const standingsRows = [
  { pos: 1, team: 'Indiana', abbr: 'IND', color: '#990000', rank: '#1', conf: '3–0', gb: '—', ovr: '12–0', vsRanked: '4–0', streak: 'W11', status: 'Title spot', chip: 'title' },
  { pos: 2, team: 'Ohio State', abbr: 'OSU', color: '#BB0000', rank: '#2', conf: '3–0', gb: '0.5', ovr: '11–1', vsRanked: '3–1', streak: 'W5', status: 'Alive', chip: 'alive' },
  { pos: 3, team: 'Oregon', abbr: 'ORE', color: '#154733', rank: '#3', conf: '2–1', gb: '1', ovr: '10–2', vsRanked: '2–1', streak: 'W6', status: 'Alive', chip: 'alive' },
  { pos: 4, team: 'Purdue', abbr: 'PUR', color: '#CEB888', rank: '#20', conf: '2–2', gb: '1.5', ovr: '9–3', vsRanked: '2–1', streak: 'W3', status: 'Alive', chip: 'alive' },
  { pos: 5, team: 'Michigan', abbr: 'MICH', color: '#00274C', rank: '#7', conf: '2–1', gb: '2', ovr: '9–3', vsRanked: '2–1', streak: 'L1', status: 'Alive', chip: 'alive' },
  { pos: 6, team: 'USC', abbr: 'USC', color: '#990000', rank: '#12', conf: '2–1', gb: '2.5', ovr: '9–3', vsRanked: '1–2', streak: 'W2', status: 'Alive', chip: 'alive' },
  { pos: 7, team: 'Iowa', abbr: 'IOWA', color: '#FFCD00', rank: '#18', conf: '2–1', gb: '3', ovr: '7–5', vsRanked: '1–2', streak: 'W1', status: 'Alive', chip: 'alive' },
  { pos: 8, team: 'Penn State', abbr: 'PSU', color: '#041E42', rank: '#8', conf: '1–2', gb: '3.5', ovr: '8–4', vsRanked: '1–2', streak: 'L2', status: 'Alive', chip: 'alive' },
  { pos: 9, team: 'Washington', abbr: 'WASH', color: '#4B2E83', rank: '#17', conf: '1–2', gb: '4', ovr: '7–5', vsRanked: '1–2', streak: 'L1', status: 'Alive', chip: 'alive' },
  { pos: 10, team: 'Nebraska', abbr: 'NEB', color: '#E41C38', rank: '#24', conf: '1–2', gb: '4.5', ovr: '7–5', vsRanked: '0–2', streak: 'W1', status: 'Alive', chip: 'alive' },
]

const statsRows = [
  { rank: 1, name: 'Fernando Mendoza', team: 'Indiana', conf: 'B1G', pct: '67.8', yds: '1866', ya: '8.8', td: '16', int: '1', sack: '12', rtg: '171.7', abbr: 'IND', color: '#990000' },
  { rank: 2, name: 'Jalen Milroe', team: 'Alabama', conf: 'SEC', pct: '65.1', yds: '1810', ya: '8.3', td: '15', int: '3', sack: '11', rtg: '169.2', abbr: 'ALA', color: '#9E1B32' },
  { rank: 3, name: 'Will Howard', team: 'Ohio State', conf: 'B1G', pct: '66.4', yds: '1775', ya: '8.6', td: '14', int: '2', sack: '10', rtg: '168.9', abbr: 'OSU', color: '#BB0000' },
  { rank: 4, name: 'Cameron Ward', team: 'Miami', conf: 'ACC', pct: '64.9', yds: '1721', ya: '8.2', td: '13', int: '2', sack: '9', rtg: '164.3', abbr: 'MIA', color: '#F47321' },
  { rank: 5, name: 'Dillon Gabriel', team: 'Oregon', conf: 'B1G', pct: '66.8', yds: '1684', ya: '8.7', td: '17', int: '4', sack: '8', rtg: '167.1', abbr: 'ORE', color: '#154733' },
  { rank: 6, name: 'Behren Morton', team: 'Texas Tech', conf: 'B12', pct: '61.7', yds: '1640', ya: '7.9', td: '12', int: '5', sack: '13', rtg: '158.1', abbr: 'TTU', color: '#CC0000' },
]

const teamDir = [
  { short: 'ACC', name: 'ACC', teams: ['Boston College', 'California', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech', 'Louisville', 'Miami', 'NC State', 'North Carolina', 'Pittsburgh', 'SMU', 'Stanford', 'Syracuse', 'Virginia', 'Virginia Tech', 'Wake Forest'] },
  { short: 'B1G', name: 'Big Ten', teams: ['Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Oregon', 'Penn State', 'Purdue', 'Rutgers', 'UCLA', 'USC', 'Washington', 'Wisconsin'] },
  { short: 'B12', name: 'Big 12', teams: ['Arizona', 'Arizona State', 'Baylor', 'BYU', 'Cincinnati', 'Colorado', 'Houston', 'Iowa State', 'Kansas', 'Kansas State', 'Oklahoma State', 'TCU', 'Texas Tech', 'UCF', 'Utah', 'West Virginia'] },
  { short: 'SEC', name: 'SEC', teams: ['Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 'Mississippi State', 'Missouri', 'Ole Miss', 'Oklahoma', 'South Carolina', 'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt'] },
  { short: 'AAC', name: 'American', teams: ['Army', 'Charlotte', 'East Carolina', 'Florida Atlantic', 'Memphis', 'Navy', 'North Texas', 'Rice', 'South Florida', 'Temple', 'Tulane', 'Tulsa', 'UAB', 'UTSA'] },
  { short: 'CUSA', name: 'Conference USA', teams: ['Delaware', 'FIU', 'Jacksonville State', 'Kennesaw State', 'Liberty', 'Louisiana Tech', 'Middle Tennessee', 'Missouri State', 'New Mexico State', 'Sam Houston', 'UTEP', 'Western Kentucky'] },
  { short: 'MAC', name: 'Mid-American', teams: ['Akron', 'Ball State', 'Bowling Green', 'Buffalo', 'Central Michigan', 'Eastern Michigan', 'Kent State', 'Miami (OH)', 'Northern Illinois', 'Ohio', 'Toledo', 'UMass', 'Western Michigan'] },
  { short: 'MW', name: 'Mountain West', teams: ['Air Force', 'Boise State', 'Colorado State', 'Fresno State', 'Hawaii', 'Nevada', 'New Mexico', 'San Diego State', 'San Jose State', 'UNLV', 'Utah State', 'Wyoming'] },
  { short: 'PAC', name: 'Pac-12', teams: ['Oregon State', 'Washington State'] },
  { short: 'SUN', name: 'Sun Belt', teams: ['Appalachian State', 'Arkansas State', 'Coastal Carolina', 'Georgia Southern', 'Georgia State', 'James Madison', 'Louisiana', 'Marshall', 'Old Dominion', 'South Alabama', 'Southern Miss', 'Texas State', 'Troy', 'UL Monroe'] },
  { short: 'IND', name: 'Independents', teams: ['Notre Dame', 'UConn'] },
]

const archiveRows = [
  { name: 'Indiana', title: 'NATIONAL CHAMPIONS', record: '13–0', trophy: 'Heisman winner', badge: 'IND', color: '#990000' },
  { name: 'Miami', title: 'FINAL AP #2', record: '12–1', trophy: 'CFP semis', badge: 'MIA', color: '#F47321' },
  { name: 'Texas', title: 'FINAL AP #3', record: '12–1', trophy: 'SEC runner-up', badge: 'TEX', color: '#BF5700' },
  { name: 'Georgia', title: 'FINAL AP #4', record: '11–2', trophy: 'Sugar Bowl', badge: 'UGA', color: '#BA0C2F' },
]

function App() {
  const [activeTab, setActiveTab] = useState<TabName>('Home')
  const [activeWindow, setActiveWindow] = useState<WindowName>(null)
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('Power 4')
  const [favoriteTeams, setFavoriteTeams] = useState<string[]>(['Indiana', 'Texas', 'LSU'])
  const [moreOpen, setMoreOpen] = useState(false)
  const [scoresView, setScoresView] = useState<ScoresView>('WEEK 6')
  const [scoreFilter, setScoreFilter] = useState('ALL FBS')
  const [scoreConference, setScoreConference] = useState('B1G')
  const [rankingsView, setRankingsView] = useState<RankingsView>('AP POLL')
  const [selectedConference, setSelectedConference] = useState('B1G')
  const [statsView, setStatsView] = useState<StatsView>('PLAYERS')
  const [statCategory, setStatCategory] = useState<StatCategory>('PASSING')
  const [archiveView, setArchiveView] = useState<ArchiveView>('SEASONS')
  const [teamSearch, setTeamSearch] = useState('')
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [teamPageView, setTeamPageView] = useState<TeamPageView>('OVERVIEW')
  const [gameWindowView, setGameWindowView] = useState<GameWindowView>('SUMMARY')
  const [playerWindowView, setPlayerWindowView] = useState<'THIS WEEK' | 'SEASON'>('THIS WEEK')
  const [searchQuery, setSearchQuery] = useState('')
  const [playerSearch, setPlayerSearch] = useState('')
  const [teamStatCategory, setTeamStatCategory] = useState('OFFENSE')
  const [homeWeek, setHomeWeek] = useState(6)
  const [liveUpdate, setLiveUpdate] = useState<LiveUpdateSnapshot>({
    state: 'unavailable',
    last_updated: null,
    job: null,
    current_week: null,
    season_active: false,
    overdue: false,
  })
  const [updateNowMessage, setUpdateNowMessage] = useState('')
  const supabaseBaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  useEffect(() => {
    if (!supabaseBaseUrl || !supabaseAnonKey) return
    let disposed = false

    const refreshLiveStatus = async () => {
      try {
        const response = await fetch(`${supabaseBaseUrl}/functions/v1/update-2026`, {
          headers: { apikey: supabaseAnonKey },
        })
        if (!response.ok) throw new Error(`Live update status request failed (${response.status})`)
        const data = await response.json() as LiveUpdateSnapshot
        if (!disposed) setLiveUpdate(data)
      } catch (error) {
        if (!disposed) {
          console.error('Could not refresh live update status:', error)
          setLiveUpdate((current) => ({ ...current, state: 'unavailable' }))
        }
      }
    }

    void refreshLiveStatus()
    const interval = window.setInterval(() => void refreshLiveStatus(), 5 * 60 * 1000)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [supabaseBaseUrl, supabaseAnonKey])

  const liveUpdateMessage = liveUpdate.state === 'failed'
    ? 'The last 2026 data update failed.'
    : liveUpdate.state === 'overdue' || liveUpdate.state === 'uninitialized'
    ? 'The next 2026 data update is overdue.'
    : liveUpdate.state === 'running'
    ? 'A 2026 data update is in progress.'
    : ''
  const liveUpdateTitle = liveUpdate.last_updated
    ? `Live data ${liveUpdate.state} · updated ${new Date(liveUpdate.last_updated).toLocaleString()}`
    : `Live data ${liveUpdate.state}`

  const teamGroups: Record<TeamFilter, string[]> = {
    'Power 4': ['ACC', 'B1G', 'B12', 'SEC'],
    'Group of 6': ['AAC', 'CUSA', 'MAC', 'MW', 'PAC', 'SUN'],
    Independents: ['IND'],
    'My Teams': teamDir.map((conference) => conference.short),
    'All 138': teamDir.map((conference) => conference.short),
  }

  const visibleTeamConferences = teamDir.filter((conference) => {
    if (teamFilter === 'My Teams') return conference.teams.some((team) => favoriteTeams.includes(team))
    return teamGroups[teamFilter].includes(conference.short)
  }).map((conference) => ({
    ...conference,
    teams: teamFilter === 'My Teams'
      ? conference.teams.filter((team) => favoriteTeams.includes(team))
      : conference.teams,
  }))

  const toggleFavorite = (team: string) => {
    setFavoriteTeams((current) => current.includes(team)
      ? current.filter((favorite) => favorite !== team)
      : [...current, team])
  }

  const renderHome = (mobile = false) => (
    <>
      {!mobile && (
        <>
          <div className="page-header">
            <h1 className="cond">WEEK {homeWeek}</h1>
            <button type="button" className="header-pill" onClick={() => setActiveWindow('undefeated')}>
              <span className="cond">UNDEFEATED WATCH</span>
              <span className="cond num">14</span>
              <span>teams left</span>
            </button>
          </div>

          <section className="award-grid" aria-label="Weekly awards">
            {awardDetails.map((award, index) => (
              <article key={index} className="award-card">
                <span className="award-bar" style={{ background: award.bar }} />
                <div className="award-header">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></svg>
                  <span className="cond award-label">{award.label}</span>
                </div>
                <div className="cond num award-result">{award.result}</div>
                <span className="award-sub">{award.sub}</span>
              </article>
            ))}
          </section>
        </>
      )}

      {mobile && (
        <>
          <div className="mobile-week-header">
            <div className="week-arrows">
              <button type="button" className="week-arrow" aria-label="Previous week" onClick={() => setHomeWeek((week) => Math.max(1, week - 1))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
              <button type="button" className="cond week-label">WEEK {homeWeek} <span>⌄</span></button>
              <button type="button" className="week-arrow" aria-label="Next week" onClick={() => setHomeWeek((week) => Math.min(17, week + 1))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
            </div>
            <span className="updated-pill"><span className="dot" />Updated Mon 06:02</span>
          </div>

          <section className="mobile-section">
            <h2 className="cond">WEEKLY AWARDS</h2>
            <div className="mobile-awards">
              {awardDetails.slice(0, 2).map((award, index) => (
                <article key={index} className="award-card award-card--mobile">
                  <span className="award-bar" style={{ background: award.bar }} />
                  <span className="cond award-label">{award.label}</span>
                  <span className="cond num award-result">{award.result}</span>
                  <span className="award-sub">{award.sub}</span>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <div className={mobile ? 'mobile-grid' : 'dashboard-grid'}>
        <section className={mobile ? 'panel panel--mobile' : 'panel panel--wide'}>
          <div className="panel-header">
            <h2 className="cond">AP TOP 5</h2>
            <button type="button" className="panel-link" onClick={() => setActiveTab('Rankings')}>Full rankings →</button>
          </div>
          <div className="rank-list">
            {rankings.map((item) => (
              <button key={item.rank} type="button" className={mobile ? 'rank-row rank-row--mobile' : 'rank-row'} onClick={() => setActiveWindow('rankings')}>
                <span className="cond num rank-num">{item.rank}</span>
                <span className="cond badge" style={badgeStyle(item.color, mobile ? 22 : 24)}>{item.badge}</span>
                <span className="cond team-name">{item.name}</span>
                {item.hot ? <span className="cond num hot"> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2-1-3 3 1 5 4 5 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" /></svg>{item.streak}</span> : null}
                <span style={{ flex: 1 }} />
                <span className="cond num record">{item.record}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={mobile ? 'panel panel--mobile' : 'panel panel--wide'}>
          <div className="panel-header">
            <h2 className="cond">HEISMAN RACE</h2>
            <button type="button" className="panel-link" onClick={() => setActiveTab('Stats')}>Full tracker →</button>
          </div>
          <button type="button" className={mobile ? 'heisman-leader heisman-leader--mobile' : 'heisman-leader'} onClick={() => setActiveWindow('player')}>
            <span className="cond num rank">1</span>
            <span className="cond badge badge--large" style={badgeStyle('#990000', mobile ? 42 : 46)}>IND</span>
            <span className="leader-copy">
              <span className="cond leader-name">[QB NAME]</span>
              <span className="leader-meta">QB · Indiana · 1,742 yds · 19 TD · 2 INT</span>
            </span>
            <span className="cond num leader-score">94.2</span>
          </button>
          {(mobile ? heisman.slice(0, 2) : heisman).map((player) => (
            <button key={player.rank} type="button" className="heisman-row" onClick={() => setActiveWindow('player')}>
              <span className="cond num player-rank">{player.rank}</span>
              <span className="cond badge" style={badgeStyle(player.color, mobile ? 22 : 24)}>{player.badge}</span>
              <span className="player-name">{player.name}</span>
              <span className="cond num player-score">{player.score}</span>
            </button>
          ))}
        </section>

        <section className={mobile ? 'panel panel--mobile' : 'panel panel--large'}>
          <div className="panel-header">
            <h2 className="cond">BIGGEST RESULTS</h2>
            <button type="button" className="panel-link" onClick={() => setActiveTab('Scores')}>All scores →</button>
          </div>
          <div className={mobile ? 'mobile-results' : 'result-grid'}>
            {(mobile ? scores.slice(0, 3) : scores).map((game, index) => (
              <button key={index} type="button" className={mobile ? 'result-card result-card--mobile' : 'result-card'} onClick={() => setActiveWindow('game')}>
                <div className="result-line">
                  <span className="cond badge" style={badgeStyle(game.away.color, mobile ? 18 : 20)}>{game.away.abbr}</span>
                  <span className="cond num result-rank">{game.away.rank}</span>
                  <span className="result-team">{game.away.name}</span>
                  <span style={{ flex: 1 }} />
                  <span className="cond num result-score">{game.away.score}</span>
                </div>
                <div className="result-line">
                  <span className="cond small-at">@</span>
                  <span className="cond badge" style={badgeStyle(game.home.color, mobile ? 18 : 20)}>{game.home.abbr}</span>
                  <span className="cond num result-rank">{game.home.rank}</span>
                  <span className="result-team">{game.home.name}</span>
                  <span style={{ flex: 1 }} />
                  <span className="cond num result-score">{game.home.score}</span>
                </div>
                <span className="cond result-status">{game.status}</span>
                {game.upset ? <span className="upset-badge cond">UPSET</span> : null}
              </button>
            ))}
          </div>
        </section>

        <section className={mobile ? 'panel panel--mobile' : 'panel panel--wide'}>
          <div className="panel-header">
            <h2 className="cond">MY TEAMS</h2>
            <button type="button" className="panel-link" onClick={() => setActiveWindow('favorites')}>Edit</button>
          </div>
          {myTeams.map((team) => (
            <button key={team.name} type="button" className={mobile ? 'team-row team-row--mobile' : 'team-row'} onClick={() => setActiveTab('Teams')}>
              <span className="cond badge badge--team" style={badgeStyle(team.color, mobile ? 28 : 32)}>{team.badge}</span>
              <div className="team-copy">
                <div className="team-topline">
                  <span className="cond team-name">{team.name}</span>
                  <span className="cond num team-rank">{team.rank}</span>
                  {team.hot ? <span className="cond num hot hot--small"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2-1-3 3 1 5 4 5 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" /></svg>{team.streak}</span> : null}
                </div>
                <span className="team-meta"><span className="team-result">{team.result}</span> {team.last}</span>
              </div>
            </button>
          ))}
        </section>

        {!mobile && (
          <aside className="gameday-card" aria-label="College GameDay" onClick={() => setActiveWindow('gameday')}>
            <div className="gameday-photo">
              <span className="gameday-kicker">IMAGE SLOT · CAMPUS PHOTO</span>
              <span className="varsity gameday-city">AUSTIN</span>
              <span className="varsity gameday-state">TEXAS</span>
            </div>
            <div className="gameday-body">
              <div className="gameday-matchups">
                <div className="matchup">
                  <svg viewBox="0 0 74 40" aria-hidden="true"><path d="M2 2 L72 20 L2 38 Z" fill="#9E1B32" stroke="#F2F3F5" strokeWidth="2" /><circle cx="20" cy="20" r="14" fill="#D9DCE0" /><text x="20" y="23.6" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="700" fontSize="10" fill="#111214">ALA</text></svg>
                  <span className="cond">#10 · 5–1</span>
                </div>
                <span className="varsity at-sign">@</span>
                <div className="matchup">
                  <svg viewBox="0 0 74 40" aria-hidden="true"><path d="M72 2 L2 20 L72 38 Z" fill="#BF5700" stroke="#F2F3F5" strokeWidth="2" /><circle cx="54" cy="20" r="14" fill="#D9DCE0" /><text x="54" y="23.6" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="700" fontSize="10" fill="#111214">TEX</text></svg>
                  <span className="cond">#5 · 5–1 · HOME</span>
                </div>
              </div>
              <div className="gameday-meta">
                <span className="cond">SHOW STARTS IN</span>
                <span className="varsity num">4D 22H 10M</span>
                <span className="cond">KICKOFF SUN 01:30 · ABC · TEX −3.5</span>
              </div>
              <div className="gameday-grid">
                <div className="mini-panel"><span>Guest picker</span><strong className="cond">TBA</strong></div>
                <div className="mini-panel"><span>Texas w/ GameDay</span><strong className="cond num">9–4</strong></div>
              </div>
              <div className="recent-stops">
                <span className="varsity">RECENT STOPS</span>
                <a href="#"><span className="cond">WK 6</span><span>Bloomington</span><span className="cond status-up">W 38–24</span></a>
                <a href="#"><span className="cond">WK 5</span><span>Ann Arbor</span><span className="cond status-up">W 27–20</span></a>
                <a href="#"><span className="cond">WK 4</span><span>Oxford</span><span className="cond status-down">L 21–24</span></a>
              </div>
              <span className="gameday-link varsity">ALL GAMEDAY STOPS</span>
            </div>
          </aside>
        )}

        {mobile && (
          <section className="mobile-gameday" onClick={() => setActiveWindow('gameday')}>
            <div className="gameday-photo gameday-photo--mobile">
              <span className="gameday-kicker">IMAGE SLOT · CAMPUS PHOTO</span>
              <span className="varsity gameday-city">AUSTIN</span>
              <span className="varsity gameday-state">TEXAS</span>
            </div>
            <div className="gameday-body gameday-body--mobile">
              <span className="cond gameday-tiny">WEEK 7 · SUN 01:30 · ABC</span>
              <div className="gameday-matchups gameday-matchups--mobile">
                <div className="matchup"><svg viewBox="0 0 74 40" aria-hidden="true"><path d="M2 2 L72 20 L2 38 Z" fill="#9E1B32" stroke="#F2F3F5" strokeWidth="2" /><circle cx="20" cy="20" r="14" fill="#D9DCE0" /><text x="20" y="23.6" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="700" fontSize="10" fill="#111214">ALA</text></svg><span className="cond">#10 · 5–1</span></div>
                <span className="varsity at-sign">@</span>
                <div className="matchup"><svg viewBox="0 0 74 40" aria-hidden="true"><path d="M72 2 L2 20 L72 38 Z" fill="#BF5700" stroke="#F2F3F5" strokeWidth="2" /><circle cx="54" cy="20" r="14" fill="#D9DCE0" /><text x="54" y="23.6" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="700" fontSize="10" fill="#111214">TEX</text></svg><span className="cond">#5 · 5–1 · HOME</span></div>
              </div>
              <div className="gameday-meta gameday-meta--mobile">
                <div><span>Spread</span><span className="cond num">TEX −3.5</span></div>
                <div><span>Guest picker</span><span className="cond">TBA</span></div>
                <div><span>Texas with GameDay in town</span><span className="cond num">9–4</span></div>
              </div>
              <span className="gameday-link varsity">ALL GAMEDAY STOPS</span>
            </div>
          </section>
        )}

        {mobile && (
          <section className="panel panel--mobile">
            <div className="panel-header">
              <h2 className="cond">UNDEFEATED WATCH</h2>
              <button type="button" className="panel-link" onClick={() => setActiveWindow('undefeated')}>Timeline →</button>
            </div>
            <div className="unbeaten-header">
              <span className="cond num">14</span>
              <span>unbeaten teams left</span>
            </div>
            <div className="unbeaten-badges">
              {['TEX', 'UGA', 'MICH', 'OM', 'BAMA', 'FSU', 'OHST', 'MIA'].map((abbr) => (
                <span key={abbr} className="cond badge" style={badgeStyle('#23262B', 22)}>{abbr}</span>
              ))}
              <span className="cond badge badge--meta">+8</span>
            </div>
          </section>
        )}
      </div>
    </>
  )

  const renderScores = () => (
    <>
      <div className="section-tabs">
        {(['WEEK 6', 'WEEK 7', 'CONF CHAMP', 'BOWLS', 'CFP'] as ScoresView[]).map((view) => (
          <button key={view} type="button" className={scoresView === view ? 'section-tab active' : 'section-tab'} onClick={() => setScoresView(view)}>{view}</button>
        ))}
      </div>
      <div className="score-filters">
        {['ALL FBS', 'TOP 25', 'MY TEAMS', 'CONFERENCE'].map((filter) => (
          <button key={filter} type="button" className={scoreFilter === filter ? 'filter-pill active' : 'filter-pill'} onClick={() => setScoreFilter(filter)}>{filter}{filter === 'CONFERENCE' ? ' ▾' : ''}</button>
        ))}
        {scoreFilter === 'CONFERENCE' && <select className="conference-select" aria-label="Choose conference" value={scoreConference} onChange={(event) => setScoreConference(event.target.value)}>{conferenceLeaderRows.map((conference) => <option key={conference.short} value={conference.short}>{conference.name}</option>)}</select>}
      </div>
      <div className="scores-layout">
        <div className="scores-panel">
          {(scoresView === 'BOWLS'
            ? [{ label: 'BOWL SEASON · DECEMBER', games: scores }]
            : scoresView === 'CFP'
            ? [{ label: 'CFP · FIRST ROUND', games: scores.slice(0, 2) }, { label: 'CFP · QUARTERFINALS', games: scores.slice(2) }]
            : scoresView === 'CONF CHAMP'
            ? [{ label: 'CONFERENCE CHAMPIONSHIP WEEKEND', games: scores }]
            : [{ label: `${scoresView === 'WEEK 6' ? 'SATURDAY 3 OCT' : 'SATURDAY 10 OCT'} · 18:00`, games: scores }, { label: 'SATURDAY · 21:30', games: scores.slice(0, 2) }, { label: 'SUNDAY · 01:30', games: scores.slice(1) }]
          ).map((slot) => (
            <section key={slot.label} className="slot-section">
              <h2 className="cond">{slot.label}</h2>
              <div className="slot-grid">
                {slot.games.filter((game) => scoreFilter !== 'TOP 25' || Boolean(game.away.rank || game.home.rank)).filter((game) => scoreFilter !== 'MY TEAMS' || myTeams.some((team) => team.badge === game.away.abbr || team.badge === game.home.abbr)).filter((game) => scoreFilter !== 'CONFERENCE' || game.away.conf === scoreConference || game.home.conf === scoreConference).map((game, idx) => (
                  <button key={`${slot.label}-${idx}`} type="button" className="score-card" onClick={() => setActiveWindow('game')}>
                    <div className="score-row">
                      <span className="cond badge" style={badgeStyle(game.away.color, 24)}>{game.away.abbr}</span>
                      <span className="cond num result-rank">{game.away.rank}</span>
                      <span className="team-text">{game.away.name}</span>
                      <span className="cond num result-score">{game.away.score}</span>
                    </div>
                    <div className="score-row">
                      <span className="cond small-at">@</span>
                      <span className="cond badge" style={badgeStyle(game.home.color, 24)}>{game.home.abbr}</span>
                      <span className="cond num result-rank">{game.home.rank}</span>
                      <span className="team-text">{game.home.name}</span>
                      <span className="cond num result-score">{game.home.score}</span>
                    </div>
                    <div className="score-foot">
                      <span>{game.status} · ABC</span>
                      <span className="cond num">TEX −3.5</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="side-stack">
          <section className="side-panel">
            <h2 className="cond">WEEK 6 IN NUMBERS</h2>
            <div className="mini-stats">
              <div><span>Ranked teams lost</span><strong className="cond num">6</strong></div>
              <div><span>Upsets</span><strong className="cond num">3</strong></div>
              <div><span>Overtime</span><strong className="cond num">2</strong></div>
              <div><span>Avg. points</span><strong className="cond num">52.4</strong></div>
            </div>
          </section>
          <section className="side-panel">
            <h2 className="cond">UPSETS THIS WEEK</h2>
            <div className="upset-list">
              <button type="button" onClick={() => setActiveWindow('game')}><span className="upset-tag stunner">STUNNER</span><span className="upset-copy"><strong className="cond num">PUR 27 @ MICH 24</strong><small className="num">Purdue +22.5</small></span></button>
              <button type="button" onClick={() => setActiveWindow('game')}><span className="upset-tag big">BIG UPSET</span><span className="upset-copy"><strong className="cond num">MISS 27 @ UGA 24</strong><small className="num">Ole Miss +7.5</small></span></button>
              <button type="button" onClick={() => setActiveWindow('game')}><span className="upset-tag">UPSET</span><span className="upset-copy"><strong className="cond num">TEX 31 @ ALA 17</strong><small className="num">Texas +3.5</small></span></button>
            </div>
          </section>
          <section className="side-panel">
            <h2 className="cond">RANKED TEAMS THAT LOST</h2>
            <div className="loser-list"><span>#3 MICH</span><span>#7 UGA</span><span>#10 ALA</span><span>#12 LSU</span></div>
          </section>
        </aside>
      </div>
    </>
  )

  const renderRankings = () => (
    <>
      <div className="section-tabs">
        {(['AP POLL', 'COACHES', 'CFP', 'PLAYOFF BRACKET'] as RankingsView[]).map((view) => (
          <button key={view} type="button" className={rankingsView === view ? 'section-tab active' : 'section-tab'} onClick={() => setRankingsView(view)}>{view}</button>
        ))}
      </div>
      {rankingsView === 'PLAYOFF BRACKET' ? (
        <section className="bracket-panel"><h1 className="cond">PLAYOFF BRACKET</h1><p>Bracket details are unavailable until the 2025 playoff data is connected.</p></section>
      ) : (
      <div className="rankings-layout">
        <section className="rankings-table-panel">
          <div className="rankings-title">
            <h1 className="cond">{rankingsView === 'CFP' ? 'CFP RANKINGS' : rankingsView === 'COACHES' ? 'COACHES POLL' : 'AP TOP 25'}</h1>
            <span>2025</span>
          </div>
          {rankingsView !== 'AP POLL' ? <p className="data-unavailable">This poll will be available when authenticated 2025 data is connected in Phase 6.</p> : <>
          <div className="ranking-header row">
            <span>#</span><span>TEAM</span><span>REC</span><span>CONF</span><span>POINTS</span><span>LAST</span><span>NEXT</span>
          </div>
          {apPoll.map((team, index) => {
            const rank = index + 1
            const darkBadge = team.color === '#CEB888' || team.color === '#FF8200'
            return (
            <button key={rank} type="button" className="ranking-row row" onClick={() => setActiveWindow('rankings')}>
              <span className="cond num">{rank}</span>
              <span className="team-cell"><span className="cond badge" style={{ ...badgeStyle(team.color, 22), color: darkBadge ? '#111214' : '#FFFFFF' }}>{team.abbr}</span><span className="cond team-name">{team.name}</span></span>
              <span className="cond num record">{team.record}</span>
              <span className="cond">{team.conf}</span>
              <span className="cond num points">{team.points}</span>
              <span className="team-note">{team.last}</span>
              <span className="team-note subtle">{team.next}</span>
            </button>
            )
          })}
          </>}
        </section>
        {rankingsView === 'AP POLL' && <aside className="side-stack">
          <section className="side-panel">
            <h2 className="cond">TOP 25 BY CONFERENCE</h2>
            {conferenceLeaderRows.map((item) => (
              <div key={item.short} className="conference-meter">
                <span className="cond badge conftag">{item.short}</span>
                <div className="meter"><span style={{ width: `${item.short === 'B1G' ? 76 : item.short === 'SEC' ? 68 : item.short === 'ACC' ? 54 : item.short === 'B12' ? 52 : item.short === 'AAC' ? 32 : 26}%` }} /></div>
                <strong className="cond num">{item.short === 'B1G' ? 7 : item.short === 'SEC' ? 6 : 5}</strong>
              </div>
            ))}
          </section>
          <section className="side-panel">
            <h2 className="cond">BIGGEST MOVERS</h2>
            <div className="movers-list">
              <div><span>Ole Miss</span><strong className="cond up">▲7</strong></div>
              <div><span>Texas Tech</span><strong className="cond up">▲6</strong></div>
              <div><span>Michigan</span><strong className="cond down">▼5</strong></div>
              <div><span>Texas A&M</span><strong className="cond down">▼8</strong></div>
            </div>
          </section>
          <section className="side-panel">
            <h2 className="cond">IN AND OUT</h2>
            <div className="inline-stat"><strong className="cond up">NEW</strong> Purdue, UNLV</div>
            <div className="inline-stat"><strong className="cond down">OUT</strong> Kansas State, Utah</div>
          </section>
        </aside>}
      </div>
      )}
    </>
  )

  const renderStandings = () => (
    <>
      <div className="standings-layout">
        <aside className="conference-nav">
          <span className="nav-small">POWER 4</span>
          {conferenceLeaderRows.slice(0, 4).map((conference) => (
            <button key={conference.short} type="button" className={selectedConference === conference.short ? 'conf-link active' : 'conf-link'} onClick={() => setSelectedConference(conference.short)}>
              <span className="cond badge conf-badge">{conference.short}</span>
              <span>
                <strong className="cond">{conference.name}</strong>
                <small>Leader {conference.leader}</small>
              </span>
            </button>
          ))}
          <span className="nav-small">GROUP OF 6</span>
          {conferenceLeaderRows.slice(4, 10).map((conference) => (
            <button key={conference.short} type="button" className={selectedConference === conference.short ? 'conf-link active' : 'conf-link'} onClick={() => setSelectedConference(conference.short)}>
              <span className="cond badge conf-badge">{conference.short}</span>
              <span>
                <strong className="cond">{conference.name}</strong>
                <small>Leader {conference.leader}</small>
              </span>
            </button>
          ))}
          <span className="nav-small">OTHER</span>
          {conferenceLeaderRows.slice(10).map((conference) => (
            <button key={conference.short} type="button" className={selectedConference === conference.short ? 'conf-link active' : 'conf-link'} onClick={() => setSelectedConference(conference.short)}>
              <span className="cond badge conf-badge">{conference.short}</span>
              <span>
                <strong className="cond">{conference.name}</strong>
                <small>Leader {conference.leader}</small>
              </span>
            </button>
          ))}
        </aside>
        {selectedConference === 'B1G' ? <section className="standings-main">
          <div className="standings-header">
            <span className="cond badge conf-badge-lg">{selectedConference}</span>
            <h1 className="cond">{conferenceLeaderRows.find(({ short }) => short === selectedConference)?.name}</h1>
            <span className="muted">2025 conference standings</span>
          </div>
          <div className="standings-table">
            <div className="standings-row header-row">
              <span>#</span>
              <span>TEAM</span>
              <span>CONF</span>
              <span>GB</span>
              <span>OVERALL</span>
              <span>VS RANKED</span>
              <span>STREAK</span>
              <span>STATUS</span>
            </div>
            {standingsRows.map((row) => (
              <div key={row.team} className={row.chip === 'title' ? 'standings-row title-row' : 'standings-row'}>
                <span className="cond num">{row.pos}</span>
                <span className="team-inline"><span className="cond badge" style={badgeStyle(row.color, 24)}>{row.abbr}</span><span className="cond team-name">{row.team}</span><span className="cond num rank-tag">{row.rank}</span></span>
                <span className="cond num">{row.conf}</span>
                <span className="cond num">{row.gb}</span>
                <span className="cond num">{row.ovr}</span>
                <span className="cond num">{row.vsRanked}</span>
                <span className="cond num streak-pill">{row.streak}</span>
                <span className={row.chip === 'title' ? 'status-pill title' : 'status-pill'}>{row.status}</span>
              </div>
            ))}
          </div>
        </section> : <section className="team-page-content"><h2 className="cond">2025 {conferenceLeaderRows.find(({ short }) => short === selectedConference)?.name.toUpperCase()} STANDINGS</h2><p>Standings will be available when authenticated 2025 data is connected in Phase 6.</p></section>}
        {selectedConference === 'B1G' && <aside className="side-stack">
          <section className="side-panel">
            <h2 className="cond">PROJECTED TITLE GAME</h2>
            <div className="projected-game">
              <div><span className="cond badge big-badge" style={badgeStyle('#BB0000', 52)}>OSU</span><small>#1 · 12–0</small></div>
              <span className="cond at-sign">VS</span>
              <div><span className="cond badge big-badge" style={badgeStyle('#990000', 52)}>IND</span><small>#2 · 13–0</small></div>
            </div>
            <p>Sat 5 Dec · Lucas Oil Stadium</p>
          </section>
          <section className="side-panel">
            <h2 className="cond">GAME TO WATCH</h2>
            <button type="button" className="watch-card" onClick={() => setActiveWindow('game')}>
              <span className="cond badge" style={badgeStyle('#154733', 22)}>ORE</span>
              <strong className="cond">#3 OREGON</strong>
              <span className="cond at-sign small">@</span>
              <span className="cond badge" style={badgeStyle('#990000', 22)}>USC</span>
              <strong className="cond">#9 USC</strong>
            </button>
          </section>
        </aside>}
      </div>
    </>
  )

  const renderStats = () => (
    <>
      <div className="section-tabs">
        {(['PLAYERS', 'TEAMS', 'HEISMAN'] as StatsView[]).map((view) => (
          <button key={view} type="button" className={statsView === view ? 'section-tab active' : 'section-tab'} onClick={() => setStatsView(view)}>{view}</button>
        ))}
      </div>
      {statsView === 'PLAYERS' && <div className="stats-topbar">
        <div className="filter-chips">
          {(['PASSING', 'RUSHING', 'RECEIVING', 'DEFENSE'] as StatCategory[]).map((category) => (
            <button key={category} type="button" className={statCategory === category ? 'filter-pill active' : 'filter-pill'} onClick={() => setStatCategory(category)}>{category}</button>
          ))}
        </div>
        <input className="stats-search" aria-label="Find a player" placeholder="Find a player" value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} />
      </div>}
      {statsView === 'HEISMAN' ? (
        <section className="heisman-tracker-panel">
          <header><h1 className="cond">HEISMAN TRACKER</h1><span>Top candidates · 2025</span></header>
          {[{ name: 'Fernando Mendoza', team: 'Indiana', score: '94.2', badge: 'IND', color: '#990000' }, ...heisman.map((player) => ({ name: player.name, team: player.badge, score: player.score, badge: player.badge, color: player.color }))].map((player, index) => (
            <button key={player.name} type="button" className="heisman-tracker-row" onClick={() => setActiveWindow('player')}>
              <span className="cond num">{index + 1}</span><span className="cond badge" style={badgeStyle(player.color, 26)}>{player.badge}</span>
              <span className="heisman-tracker-name"><strong>{player.name}</strong><small>{player.team}</small></span>
              <span className="heisman-score-track"><span style={{ width: `${Number(player.score)}%` }} /></span><strong className="cond num">{player.score}</strong>
            </button>
          ))}
          <section className="season-field"><h2 className="cond">SEASON FIELD</h2><p>Players who appeared in the weekly top 10 during the 2025 season are included here.</p></section>
        </section>
      ) : statsView === 'TEAMS' ? (
        <section className="team-page-content stats-team-empty"><h2 className="cond">TEAM STATISTICS</h2><div className="filter-chips">{['OFFENSE', 'DEFENSE', 'SPECIAL TEAMS'].map((category) => <button key={category} type="button" className={teamStatCategory === category ? 'filter-pill active' : 'filter-pill'} onClick={() => setTeamStatCategory(category)}>{category}</button>)}</div><p>{teamStatCategory} statistics will be available when authenticated 2025 data is connected in Phase 6.</p></section>
      ) : statCategory !== 'PASSING' ? (
        <section className="team-page-content stats-team-empty"><h2 className="cond">{statCategory} LEADERS</h2><p>These player statistics will be available when authenticated 2025 data is connected in Phase 6.</p></section>
      ) : (
      <div className="stats-layout">
        <section className="stats-table-panel">
          <div className="stats-header row">
            <span>RK</span>
            <span>PLAYER</span>
            <span>CONF</span>
            <span>COMP%</span>
            <span>YDS</span>
            <span>Y/A</span>
            <span>TD</span>
            <span>INT</span>
            <span>SACK</span>
            <span>RTG</span>
          </div>
          {statsRows.filter((row) => `${row.name} ${row.team}`.toLowerCase().includes(playerSearch.toLowerCase())).map((row) => (
            <button key={row.rank} type="button" className="stats-row row" onClick={() => setActiveWindow('player')}>
              <span className="cond num">{row.rank}</span>
              <span className="player-cell"><span className="cond badge" style={badgeStyle(row.color, 22)}>{row.abbr}</span><span className="player-meta"><strong>{row.name}</strong><small>{row.team}</small></span></span>
              <span className="cond badge conf-mini">{row.conf}</span>
              <span className="cond num">{row.pct}</span>
              <span className="cond num">{row.yds}</span>
              <span className="cond num">{row.ya}</span>
              <span className="cond num">{row.td}</span>
              <span className="cond num muted">{row.int}</span>
              <span className="cond num muted">{row.sack}</span>
              <span className="cond num">{row.rtg}</span>
            </button>
          ))}
        </section>
        <aside className="side-stack">
          <section className="side-panel">
            <h2 className="cond">NATIONAL LEADERS</h2>
            <div className="leader-list">
              {['Passing yards', 'Rushing yards', 'Receiving yards', 'Tackles'].map((cat, idx) => (
                <button key={cat} type="button" className="leader-item" onClick={() => setActiveWindow('player')}>
                  <span className="cond badge" style={badgeStyle(['#BB0000','#BF5700','#F47321','#CEB888'][idx], 22)}>{['OSU','TEX','MIA','PUR'][idx]}</span>
                  <span><strong>{['Fernando Mendoza','[RB Name]','[WR Name]','[LB Name]'][idx]}</strong><small>{cat}</small></span>
                  <span className="cond num">{['1866','912','788','71'][idx]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="side-panel quote-box">
            <h2 className="cond">QUALIFYING</h2>
            <p>Percentages and averages only rank players with at least 15 pass attempts per team game. Totals like yards and touchdowns have no minimum.</p>
          </section>
        </aside>
      </div>
      )}
    </>
  )

  const renderTeams = () => (
    <>
      {selectedTeam ? (
        <section className="team-page">
          <button type="button" className="team-back" onClick={() => setSelectedTeam(null)}>← ALL TEAMS</button>
          <header className="team-page-header">
            <span className="cond badge team-page-badge" style={badgeStyle('#23262B', 52)}>{selectedTeam.slice(0, 3).toUpperCase()}</span>
            <div><span className="muted">{teamDir.find((conference) => conference.teams.includes(selectedTeam))?.name}</span><h1 className="cond">{selectedTeam}</h1></div>
            <button type="button" className={favoriteTeams.includes(selectedTeam) ? 'star favorited' : 'star'} onClick={() => toggleFavorite(selectedTeam)} aria-label={favoriteTeams.includes(selectedTeam) ? 'Remove from favorites' : 'Add to favorites'}>{favoriteTeams.includes(selectedTeam) ? '★' : '☆'}</button>
          </header>
          <div className="section-tabs">
            {(['OVERVIEW', 'SCHEDULE', 'STATS', 'HISTORY'] as TeamPageView[]).map((view) => (
              <button key={view} type="button" className={teamPageView === view ? 'section-tab active' : 'section-tab'} onClick={() => setTeamPageView(view)}>{view}</button>
            ))}
          </div>
          <section className="team-page-content">
            <h2 className="cond">{teamPageView}</h2>
            <p>Team information and 2025 {teamPageView.toLowerCase()} will display here when the authenticated 2025 data connection is added in Phase 6.</p>
          </section>
        </section>
      ) : (
      <>
      <div className="section-tabs">
        <button type="button" className="section-tab active">DIRECTORY</button>
        <button type="button" className="section-tab" disabled title="Compare is planned for Phase 7">COMPARE</button>
      </div>
      <div className="teams-topbar">
        {(['Power 4', 'Group of 6', 'Independents', 'My Teams', 'All 138'] as TeamFilter[]).map((filter) => (
          <button key={filter} type="button" className={teamFilter === filter ? 'filter-pill active' : 'filter-pill'} onClick={() => setTeamFilter(filter)}>
            {filter.toUpperCase()}
          </button>
        ))}
        <span className="spacer" />
      </div>
      <input className="stats-search" aria-label="Find a team" placeholder="Find a team" value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} />
      <div className="team-directory">
        {visibleTeamConferences.map((conference) => ({
          ...conference,
          teams: conference.teams.filter((team) => team.toLowerCase().includes(teamSearch.toLowerCase())),
        })).filter((conference) => conference.teams.length > 0).map((conference) => (
          <section key={conference.short} className="directory-card">
            <div className="directory-header">
              <span className="cond badge conf-badge">{conference.short}</span>
              <h2 className="cond">{conference.name}</h2>
              <span className="muted">{conference.teams.length} teams</span>
            </div>
            <div className="directory-list">
              {conference.teams.map((team) => (
                <div key={`${conference.short}-${team}`} className="dir-item">
                  <button type="button" className="dir-team-button" onClick={() => setSelectedTeam(team)}>
                    <span className="cond badge" style={badgeStyle(['#BF5700','#BB0000','#F47321','#990000','#461D7C','#002E5D'][Math.abs(team.length) % 6], 24)}>{team.slice(0, 3).toUpperCase()}</span>
                    <span className="dir-team">{team}</span>
                  </button>
                  <button type="button" className={favoriteTeams.includes(team) ? 'star favorited' : 'star'} aria-label={favoriteTeams.includes(team) ? `Remove ${team} from favorites` : `Add ${team} to favorites`} aria-pressed={favoriteTeams.includes(team)} onClick={() => toggleFavorite(team)}>★</button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      </>
      )}
    </>
  )

  const renderArchive = () => (
    <>
      <div className="archive-header">
        <h1 className="cond">ARCHIVE</h1>
        <div className="archive-tabs">
          {(['SEASONS', 'ALL TIME', 'GAMEDAY HISTORY'] as ArchiveView[]).map((view) => (
            <button key={view} type="button" className={archiveView === view ? 'section-tab active' : 'section-tab'} onClick={() => setArchiveView(view)}>{view}</button>
          ))}
        </div>
      </div>
      {archiveView === 'SEASONS' ? (
      <div className="archive-grid">
        <section className="archive-hero">
          <div className="hero-copy">
            <span className="varsity kicker">2025 NATIONAL CHAMPIONS</span>
            <h2 className="varsity">INDIANA</h2>
            <small className="varsity">HOOSIERS</small>
            <div className="hero-score">TITLE GAME · IND 27 · MIA 21</div>
            <button type="button" className="archive-link">EVERY 2025 GAME AND BOX SCORE →</button>
          </div>
          <div className="hero-art">IMAGE SLOT · CHAMPION PHOTO</div>
        </section>
        <section className="archive-card">
          <h3 className="cond">HEISMAN TROPHY</h3>
          {archiveRows.map((team) => (
            <div key={team.name} className="archive-team-row">
              <span className="cond badge" style={badgeStyle(team.color, 22)}>{team.badge}</span>
              <div><strong>{team.name}</strong><small>{team.title}</small></div>
              <span className="cond num">{team.record}</span>
            </div>
          ))}
        </section>
        <section className="archive-card">
          <h3 className="cond">FINAL AP TOP 10</h3>
          {[1,2,3,4,5,6,7,8,9,10].map((rank) => (
            <div key={rank} className="list-row">
              <span className="cond num">{rank}</span>
              <span className="cond badge" style={badgeStyle(['#990000','#F47321','#BF5700','#BA0C2F','#0C2340','#002E5D','#461D7C','#154733','#BB0000','#9E1B32'][rank - 1], 20)}>{['IND','MIA','TEX','UGA','ND','BYU','LSU','ORE','OSU','ALA'][rank - 1].slice(0, 3).toUpperCase()}</span>
              <span>{['Indiana','Miami','Texas','Georgia','Notre Dame','BYU','LSU','Oregon','Ohio State','Alabama'][rank - 1]}</span>
            </div>
          ))}
        </section>
        <section className="archive-card">
          <h3 className="cond">BIGGEST UPSETS</h3>
          {['+21.5','+14.5','+7.5','+6.0'].map((spread) => (
            <div key={spread} className="list-row tiny-gap">
              <span className="cond num upset-span">{spread}</span>
              <span>Underdog over favorite</span>
            </div>
          ))}
        </section>
        <section className="archive-card">
          <h3 className="cond">CONFERENCE CHAMPIONS</h3>
          {['B1G • Indiana','SEC • Texas','ACC • Miami','B12 • Texas Tech','AAC • Memphis','MW • UNLV'].map((entry) => (
            <div key={entry} className="list-row compact"><span className="cond badge conf-mini">{entry.split(' • ')[0]}</span><span>{entry.split(' • ')[1]}</span></div>
          ))}
        </section>
      </div>
      ) : archiveView === 'ALL TIME' ? (
        <section className="archive-card archive-full-panel"><h2 className="cond">ALL-TIME RECORDS</h2><p>All-time leaderboards become available when historical seasons are imported.</p></section>
      ) : (
        <section className="archive-card archive-full-panel"><h2 className="cond">GAMEDAY HISTORY</h2><p>College GameDay history is not part of the archived 2025 import and will be available after the dedicated GameDay phase.</p></section>
      )}
    </>
  )

  const renderWindow = () => {
    if (!activeWindow) return null

    const inner = (() => {
      switch (activeWindow) {
        case 'game':
          return (
            <div className="window-panel game-window">
              <div className="window-header">
                <h2 className="cond">GAME</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <div className="game-window-body">
                <div className="game-side">
                  <span className="cond badge" style={badgeStyle('#BF5700', 30)}>TEX</span>
                  <strong className="cond">TEXAS</strong>
                  <span className="num large-score">31</span>
                </div>
                <div className="game-center">
                  <span className="cond">FINAL</span>
                  <span className="cond num">TEX −3.5</span>
                  <span className="cond muted">ABC</span>
                </div>
                <div className="game-side right-side">
                  <span className="cond badge" style={badgeStyle('#9E1B32', 30)}>ALA</span>
                  <strong className="cond">ALABAMA</strong>
                  <span className="num large-score">17</span>
                </div>
              </div>
              <div className="section-tabs window-tabs">
                {(['SUMMARY', 'PLAYER STATS'] as GameWindowView[]).map((view) => <button key={view} type="button" className={gameWindowView === view ? 'section-tab active' : 'section-tab'} onClick={() => setGameWindowView(view)}>{view}</button>)}
              </div>
              {gameWindowView === 'SUMMARY' ? <>
              <div className="stat-box-grid">
                <div><span>Passing</span><strong>273 / 197</strong></div>
                <div><span>Rushing</span><strong>172 / 104</strong></div>
                <div><span>First downs</span><strong>23 / 21</strong></div>
                <div><span>Turnovers</span><strong>1 / 2</strong></div>
              </div>
              <div className="game-leaders"><h3 className="cond">TOP PERFORMERS</h3><p>Passing · Rushing · Receiving · Tackles</p><span>Player leaders appear here with 2025 box-score data.</span></div>
              </> : <div className="game-player-stats"><h3 className="cond">PLAYER STATS</h3><p>Player box scores will appear here after 2025 data is connected.</p></div>}
            </div>
          )
        case 'player':
          return (
            <div className="window-panel player-window">
              <div className="window-header">
                <h2 className="cond">PLAYER</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <div className="player-banner">
                <span className="cond badge player-badge" style={badgeStyle('#990000', 54)}>IND</span>
                <div>
                  <h3 className="cond">FERNANDO MENDOZA</h3>
                  <p>QB · Indiana · 2025</p>
                </div>
                <strong className="cond num">94.2</strong>
              </div>
              <div className="section-tabs window-tabs">
                {(['THIS WEEK', 'SEASON'] as const).map((view) => <button key={view} type="button" className={playerWindowView === view ? 'section-tab active' : 'section-tab'} onClick={() => setPlayerWindowView(view)}>{view}</button>)}
              </div>
              <div className="player-season-stats"><h3 className="cond">{playerWindowView} STATS</h3><p>Passing yards · Touchdowns · Completions · Interceptions</p></div>
              <div className="chart-box">
                <span className="cond">PASSING BY GAME</span>
                <div className="mini-chart">
                  <span style={{ height: '30%' }} />
                  <span style={{ height: '55%' }} />
                  <span style={{ height: '75%' }} />
                  <span style={{ height: '95%' }} />
                  <span style={{ height: '80%' }} />
                  <span style={{ height: '100%' }} />
                </div>
              </div>
            </div>
          )
        case 'rankings':
          return (
            <div className="window-panel standings-window">
              <div className="window-header">
                <h2 className="cond">TOP 25</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <div className="window-list">
                {apPoll.map((team, idx) => (
                  <div key={team.name} className="window-row">
                    <span className="cond num">{idx + 1}</span>
                    <span className="cond badge" style={badgeStyle(team.color, 20)}>{team.abbr.slice(0, 3)}</span>
                    <span>{team.name}</span><span className="window-record">{team.record}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        case 'gameday':
          return (
            <div className="window-panel gameday-window">
              <div className="window-header">
                <h2 className="cond">GAMEDAY</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <div className="gameday-window-hero">
                <span className="varsity">AUSTIN</span>
                <span className="varsity smaller">TEXAS</span>
              </div>
              <div className="gameday-window-body">
                <div className="two-teams"><span>TEX 31</span><span>@</span><span>ALA 17</span></div>
                <div className="mini-panel-grid">
                  <div><span>Guest picker</span><strong className="cond">TBA</strong></div>
                  <div><span>Texas w/ GameDay</span><strong className="cond num">9–4</strong></div>
                </div>
              </div>
            </div>
          )
        case 'undefeated':
          return (
            <div className="window-panel undefeated-window">
              <div className="window-header">
                <h2 className="cond">UNDEFEATED WATCH</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <div className="undefeated-grid">
                {['IND','TEX','GEORGIA','MSU','MIA','FSU','BYU','UNC'].map((team) => (
                  <span key={team} className="cond badge" style={badgeStyle('#23262B', 26)}>{team}</span>
                ))}
              </div>
            </div>
          )
        case 'favorites':
          return (
            <div className="window-panel small-window">
              <div className="window-header">
                <h2 className="cond">FAVORITES</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <div className="favorites-list">
                {favoriteTeams.map((team) => (
                  <button key={team} type="button" className="favorite-row" onClick={() => toggleFavorite(team)}><span>{team}</span><span>★</span></button>
                ))}
                {favoriteTeams.length === 0 && <p className="data-unavailable">No favorite teams yet.</p>}
              </div>
            </div>
          )
        case 'search':
          return (
            <div className="window-panel small-window">
              <div className="window-header">
                <h2 className="cond">SEARCH</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <input className="search-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Find a team or player" />
              <div className="window-list">
                {teamDir.flatMap((conference) => conference.teams).filter((team) => searchQuery && team.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 8).map((team) => <button key={team} type="button" className="window-row search-result" onClick={() => { setSelectedTeam(team); setActiveTab('Teams'); setActiveWindow(null) }}><span>{team}</span><span className="muted">Team</span></button>)}
                {searchQuery && 'Fernando Mendoza'.toLowerCase().includes(searchQuery.toLowerCase()) && <button type="button" className="window-row search-result" onClick={() => setActiveWindow('player')}><span>Fernando Mendoza</span><span className="muted">Player</span></button>}
                {!searchQuery && <p className="data-unavailable">Search FBS teams and players.</p>}
              </div>
            </div>
          )
        case 'error':
          return (
            <div className="window-panel small-window error-window">
              <div className="window-header">
                <h2 className="cond">UPDATE FAILED</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <p>{liveUpdate.state === 'failed' ? 'The most recent scheduled data refresh failed.' : 'Update the 2026 live-season data now.'}</p>
              {updateNowMessage && <p className="manual-update-notice" role="status">{updateNowMessage}</p>}
              <button type="button" className="primary-button" onClick={() => setUpdateNowMessage('Manual updates require account sign-in, which is planned for Phase 6.')}>UPDATE NOW</button>
            </div>
          )
        case 'settings':
          return (
            <div className="window-panel small-window">
              <div className="window-header">
                <h2 className="cond">SETTINGS</h2>
                <button type="button" className="close-button" onClick={() => setActiveWindow(null)}>×</button>
              </div>
              <div className="settings-preview">
                <strong>Account settings</strong>
                <span>Profile, time zone, favorites, and data updates will be available with account setup.</span>
              </div>
            </div>
          )
        default:
          return null
      }
    })()

    return <div className="window-backdrop" onClick={() => setActiveWindow(null)}>{<div onClick={(event) => event.stopPropagation()}>{inner}</div>}</div>
  }

  return (
    <div className="app-shell">
      <div className="desktop-shell">
        <header className="topbar" aria-label="Main navigation">
          <div className="brand" aria-label="STRDYS home">
            <span className="brand-mark">S</span>
            <span className="brand-name">STRDYS</span>
          </div>
          <nav className="desktop-nav" aria-label="Top navigation">
            {desktopTabs.map((tab) => (
              <button key={tab} type="button" className={activeTab === tab ? 'nav-btn active' : 'nav-btn'} onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
          </nav>
          <div className="topbar-actions">
            <button type="button" className="search-box" onClick={() => setActiveWindow('search')}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
              <span>Search</span>
            </button>
            <select className="week-button" aria-label="Select season week" value={homeWeek} onChange={(event) => setHomeWeek(Number(event.target.value))}>
              {Array.from({ length: 17 }, (_, index) => <option key={index + 1} value={index + 1}>2025 · WEEK {index + 1}</option>)}
            </select>
            <button type="button" className="icon-button" onClick={() => setActiveWindow('favorites')} aria-label="Favorite teams">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg>
            </button>
            <button type="button" className={`status-pill status-pill--${liveUpdate.state}`} aria-label={liveUpdateTitle} title={liveUpdateTitle} onClick={() => liveUpdateMessage && setActiveWindow('error')}><span /></button>
            <button type="button" className="avatar-button" aria-label="Account" onClick={() => setActiveWindow('error')}>B</button>
          </div>
        </header>
        <main className={activeTab === 'Home' ? 'desktop-main desktop-main--home' : 'desktop-main'}>
          {liveUpdateMessage && <div className={`live-update-banner live-update-banner--${liveUpdate.state}`} role="status"><span>{liveUpdateMessage}</span><button type="button" onClick={() => setActiveWindow('error')}>Update now</button></div>}
          <div className="data-preview-banner">Screen preview data only · live 2025 data is deferred until Phase 6 account sign-in.</div>
          {activeTab === 'Home' && renderHome(false)}
          {activeTab === 'Scores' && renderScores()}
          {activeTab === 'Rankings' && renderRankings()}
          {activeTab === 'Standings' && renderStandings()}
          {activeTab === 'Stats' && renderStats()}
          {activeTab === 'Teams' && renderTeams()}
          {activeTab === 'Archive' && renderArchive()}
          {activeTab === "Pick'em" && <section className="team-page-content"><h2 className="cond">PICK'EM</h2><p>This feature is planned for Phase 7.</p></section>}
        </main>
      </div>

      <div className="mobile-shell">
        <header className="mobile-topbar">
          <div className="brand brand--mobile" aria-label="STRDYS home">
            <span className="brand-mark">S</span>
            <span className="brand-name">STRDYS</span>
          </div>
          <button type="button" className="mobile-icon-button" onClick={() => setActiveWindow('search')} aria-label="Search teams or players">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          </button>
          <button type="button" className="avatar-button avatar-button--mobile" onClick={() => setActiveWindow('favorites')} aria-label="Account">B</button>
        </header>
        <main className="mobile-main">
          {liveUpdateMessage && <div className={`live-update-banner live-update-banner--${liveUpdate.state}`} role="status"><span>{liveUpdateMessage}</span><button type="button" onClick={() => setActiveWindow('error')}>Update now</button></div>}
          <div className="data-preview-banner">Screen preview data only · live 2025 data is deferred until Phase 6 account sign-in.</div>
          {activeTab === 'Home' && renderHome(true)}
          {activeTab === 'Scores' && renderScores()}
          {activeTab === 'Rankings' && renderRankings()}
          {activeTab === 'Standings' && renderStandings()}
          {activeTab === 'Stats' && renderStats()}
          {activeTab === 'Teams' && renderTeams()}
          {activeTab === 'Archive' && renderArchive()}
          {activeTab === "Pick'em" && <section className="team-page-content"><h2 className="cond">PICK'EM</h2><p>This feature is planned for Phase 7.</p></section>}
        </main>
        <nav className="mobile-nav" aria-label="Main mobile navigation">
          {mobileTabs.map((tab) => {
            const iconPaths: Record<MobileTab, string> = {
            Home: 'M3 11l9-7 9 7M5 9v11h14V9M10 20v-6h4v6',
            Scores: 'M3 6h18v12H3zM12 6v12M7 10v4M17 10v4',
            Rankings: 'M5 20V12M12 20V5M19 20v-5M3 20h18',
            Standings: 'M4 6h16M4 12h16M4 18h16M8 4v16',
            More: 'M5 12h.01M12 12h.01M19 12h.01',
            }
            const isActive = tab === 'More' ? moreOpen : activeTab === tab
            return (
            <button
              key={tab}
              type="button"
              className={isActive ? 'mobile-tab active' : 'mobile-tab'}
              aria-current={tab !== 'More' && activeTab === tab ? 'page' : undefined}
              aria-expanded={tab === 'More' ? moreOpen : undefined}
              onClick={() => tab === 'More' ? setMoreOpen(true) : setActiveTab(tab)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={iconPaths[tab]} /></svg>
              <span className="cond">{tab}</span>
            </button>
            )
          })}
        </nav>
        {moreOpen && (
          <div className="more-overlay" onClick={() => setMoreOpen(false)}>
            <section className="more-sheet" role="dialog" aria-label="More menu" onClick={(event) => event.stopPropagation()}>
            <span className="sheet-handle" />
            {([
              { label: 'Stats', tab: 'Stats' as TabName, icon: 'M4 20V10M10 20V4M16 20v-7' },
              { label: 'Teams', tab: 'Teams' as TabName, icon: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z' },
              { label: "Pick'em", tab: "Pick'em" as TabName, icon: 'M5 12l4 4 10-10' },
              { label: 'Archive', tab: 'Archive' as TabName, icon: 'M3 5h18v4H3zM5 9v11h14V9M10 13h4' },
            ]).map((item) => (
              <button key={item.label} type="button" className="more-item" onClick={() => { setActiveTab(item.tab); setMoreOpen(false) }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg>
                <span className="cond">{item.label}</span>
                <span className="more-chevron">›</span>
              </button>
            ))}
            <button type="button" className="more-item more-item--settings" onClick={() => { setMoreOpen(false); setActiveWindow('settings') }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
              <span>Settings</span>
              <span className="more-chevron">›</span>
            </button>
            <div className="more-account">
              <span className="more-avatar">B</span>
              <span className="more-account-copy"><strong>Bent</strong><small>{favoriteTeams.length} favorite teams</small></span>
              <button type="button" className="sign-out-button" disabled title="Sign-in is not enabled in this preview">Sign out</button>
            </div>
            </section>
          </div>
        )}
      </div>

      {renderWindow()}
    </div>
  )
}

export default App
