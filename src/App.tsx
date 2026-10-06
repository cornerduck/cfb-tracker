import { useState } from 'react'
import './App.css'

const desktopTabs = ['Home', 'Scores', 'Rankings', 'Standings', 'Stats', 'Teams', 'Pick\'em', 'Archive']
const mobileTabs = ['Home', 'Scores', 'Rankings', 'Standings', 'More']

const awardDetails = [
  { label: 'UPSET OF THE WEEK', bar: 'linear-gradient(90deg, #F08A3C 0, #F08A3C 100%)', result: 'TEX 31 — ALA 27', sub: 'Biggest spread win', accent: 'upset' },
  { label: 'GAME OF THE WEEK', bar: 'linear-gradient(90deg, #D9DCE0 0, #D9DCE0 100%)', result: 'MICH 24 — OSU 21', sub: 'Closest win', accent: 'neutral' },
  { label: 'BLOWOUT', bar: 'linear-gradient(90deg, #4CC38A 0, #4CC38A 100%)', result: 'ND 38 — UGA 10', sub: 'Most decisive margin', accent: 'win' },
  { label: 'PERFORMANCE', bar: 'linear-gradient(90deg, #D09B5A 0, #D09B5A 100%)', result: 'J. HART • QB • TCU', sub: 'Best individual line', accent: 'player' },
]

const rankings = [
  { rank: 1, name: 'Texas', record: '6–0', badge: 'TEX', color: '#BF5700', hot: true, streak: '4' },
  { rank: 2, name: 'Georgia', record: '5–1', badge: 'UGA', color: '#BA0C2F', hot: false },
  { rank: 3, name: 'Ohio State', record: '5–1', badge: 'OSU', color: '#BB0000', hot: true, streak: '1' },
  { rank: 4, name: 'Ole Miss', record: '5–1', badge: 'OM', color: '#CE1126', hot: false },
  { rank: 5, name: 'Alabama', record: '5–1', badge: 'ALA', color: '#9E1B32', hot: false },
]

const myTeams = [
  { name: 'Texas', rank: '#5', record: '6–0', result: 'W 41-17', last: 'vs. Oklahoma', badge: 'TEX', color: '#BF5700', hot: true, streak: '5' },
  { name: 'Indiana', rank: '#10', record: '5–1', result: 'W 38-24', last: 'at Purdue', badge: 'IND', color: '#7D110C', hot: false },
  { name: 'LSU', rank: '#17', record: '4–2', result: 'L 20-27', last: 'vs. Arkansas', badge: 'LSU', color: '#461D7C', hot: true, streak: '2' },
]

const heisman = [
  { rank: 2, name: 'M. Williams', score: '91.3', badge: 'TEX', color: '#BF5700' },
  { rank: 3, name: 'K. Howard', score: '89.5', badge: 'IND', color: '#7D110C' },
  { rank: 4, name: 'T. Foster', score: '88.7', badge: 'LSU', color: '#461D7C' },
]

const games = [
  { away: { abbr: 'TEX', rank: '#5', name: 'Longhorns', score: 38, color: '#BF5700', hot: true, streak: '4' }, home: { abbr: 'BAMA', rank: '#10', name: 'Crimson Tide', score: 24, color: '#9E1B32', hot: false }, status: 'FINAL', upset: true },
  { away: { abbr: 'MICH', rank: '#3', name: 'Wolverines', score: 24, color: '#00274C', hot: true, streak: '5' }, home: { abbr: 'OSU', rank: '#2', name: 'Buckeyes', score: 21, color: '#BB0000', hot: false }, status: 'FINAL', upset: false },
  { away: { abbr: 'LSU', rank: '#12', name: 'Tigers', score: 41, color: '#461D7C', hot: false }, home: { abbr: 'MISS', rank: '#9', name: 'Rebels', score: 28, color: '#CE1126', hot: true, streak: '3' }, status: 'FINAL', upset: false },
  { away: { abbr: 'IND', rank: '#11', name: 'Hoosiers', score: 27, color: '#7D110C', hot: false }, home: { abbr: 'PENN', rank: '#15', name: 'Nittany Lions', score: 17, color: '#001E44', hot: false }, status: 'FINAL', upset: false },
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
  letterSpacing: 0,
})

function App() {
  const [activeTab, setActiveTab] = useState('Home')

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
              <button
                key={tab}
                type="button"
                className={activeTab === tab ? 'nav-btn active' : 'nav-btn'}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>

          <div className="topbar-actions">
            <label className="search-box" aria-label="Search teams or players">
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
              <input type="text" placeholder="Search" aria-label="Search" />
            </label>
            <button type="button" className="week-button">WEEK 6 <span>▾</span></button>
            <button type="button" className="icon-button" aria-label="Favorite teams">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg>
            </button>
            <div className="status-pill" aria-label="Updated Monday 06:02"><span /></div>
            <button type="button" className="avatar-button" aria-label="Account">B</button>
          </div>
        </header>

        <main className="desktop-main">
          <div className="page-header">
            <h1 className="cond">WEEK 6</h1>
            <button type="button" className="header-pill">
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

          <div className="dashboard-grid">
            <section className="panel panel--wide">
              <div className="panel-header">
                <h2 className="cond">AP TOP 5</h2>
                <a href="#">Full rankings →</a>
              </div>
              <div className="rank-list">
                {rankings.map((item) => (
                  <button key={item.rank} type="button" className="rank-row">
                    <span className="cond num rank-num">{item.rank}</span>
                    <span className="cond badge" style={badgeStyle(item.color, 24)}>{item.badge}</span>
                    <span className="cond team-name">{item.name}</span>
                    {item.hot ? <span className="cond num hot"> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2-1-3 3 1 5 4 5 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" /></svg>{item.streak}</span> : null}
                    <span style={{ flex: 1 }} />
                    <span className="cond num record">{item.record}</span>
                    <span className="cond num move">{item.rank === 1 ? '▲' : '•'}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel panel--wide">
              <div className="panel-header">
                <h2 className="cond">HEISMAN RACE</h2>
                <a href="#">Full tracker →</a>
              </div>
              <button type="button" className="heisman-leader">
                <span className="cond num rank">1</span>
                <span className="cond badge badge--large" style={badgeStyle('#990000', 46)}>IND</span>
                <span className="leader-copy">
                  <span className="cond leader-name">[QB NAME]</span>
                  <span className="leader-meta">QB · Indiana · 1,742 yds · 19 TD · 2 INT</span>
                </span>
                <span className="cond num leader-score">94.2</span>
              </button>
              {heisman.map((player) => (
                <button key={player.rank} type="button" className="heisman-row">
                  <span className="cond num player-rank">{player.rank}</span>
                  <span className="cond badge" style={badgeStyle(player.color, 24)}>{player.badge}</span>
                  <span className="player-name">{player.name}</span>
                  <span className="cond num player-score">{player.score}</span>
                </button>
              ))}
            </section>

            <section className="panel panel--large">
              <div className="panel-header">
                <h2 className="cond">BIGGEST RESULTS</h2>
                <a href="#">All scores →</a>
              </div>
              <div className="result-grid">
                {games.map((game, index) => (
                  <button key={index} type="button" className="result-card">
                    <div className="result-line">
                      <span className="cond badge" style={badgeStyle(game.away.color, 20)}>{game.away.abbr}</span>
                      <span className="cond num result-rank">{game.away.rank}</span>
                      <span className="result-team">{game.away.name}</span>
                      <span style={{ flex: 1 }} />
                      <span className="cond num result-score">{game.away.score}</span>
                    </div>
                    <div className="result-line">
                      <span className="cond small-at">@</span>
                      <span className="cond badge" style={badgeStyle(game.home.color, 20)}>{game.home.abbr}</span>
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

            <section className="panel panel--wide">
              <div className="panel-header">
                <h2 className="cond">MY TEAMS</h2>
                <a href="#">Edit</a>
              </div>
              {myTeams.map((team) => (
                <a href="#" key={team.name} className="team-row">
                  <span className="cond badge badge--team" style={badgeStyle(team.color, 32)}>{team.badge}</span>
                  <div className="team-copy">
                    <div className="team-topline">
                      <span className="cond team-name">{team.name}</span>
                      <span className="cond num team-rank">{team.rank}</span>
                      {team.hot ? <span className="cond num hot hot--small"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2-1-3 3 1 5 4 5 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" /></svg>{team.streak}</span> : null}
                    </div>
                    <span className="team-meta"><span className="team-result">{team.result}</span> {team.last}</span>
                  </div>
                </a>
              ))}
            </section>

            <aside className="gameday-card" aria-label="College GameDay">
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
                <a href="#" className="gameday-link varsity">ALL GAMEDAY STOPS</a>
              </div>
            </aside>
          </div>
        </main>
      </div>

      <div className="mobile-shell">
        <header className="mobile-topbar">
          <div className="brand brand--mobile" aria-label="STRDYS home">
            <span className="brand-mark">S</span>
            <span className="brand-name">STRDYS</span>
          </div>
          <button type="button" className="mobile-icon-button" aria-label="Search teams or players">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          </button>
          <button type="button" className="avatar-button avatar-button--mobile" aria-label="Account">B</button>
        </header>

        <main className="mobile-main">
          <div className="mobile-week-header">
            <div className="week-arrows">
              <button type="button" aria-label="Previous week">←</button>
              <button type="button" className="cond week-label">WEEK 6 <span>▾</span></button>
              <button type="button" aria-label="Next week">→</button>
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

          <section className="mobile-gameday">
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
              <a href="#" className="gameday-link varsity">ALL GAMEDAY STOPS</a>
            </div>
          </section>

          <section className="panel panel--mobile">
            <div className="panel-header">
              <h2 className="cond">AP TOP 5</h2>
              <a href="#">Full rankings →</a>
            </div>
            {rankings.map((item) => (
              <button key={item.rank} type="button" className="rank-row rank-row--mobile">
                <span className="cond num rank-num">{item.rank}</span>
                <span className="cond badge" style={badgeStyle(item.color, 22)}>{item.badge}</span>
                <span className="cond team-name">{item.name}</span>
                <span style={{ flex: 1 }} />
                <span className="cond num record">{item.record}</span>
              </button>
            ))}
          </section>

          <section className="panel panel--mobile">
            <div className="panel-header">
              <h2 className="cond">BIGGEST RESULTS</h2>
              <a href="#">All →</a>
            </div>
            <div className="mobile-results">
              {games.slice(0, 3).map((game, index) => (
                <button key={index} type="button" className="result-card result-card--mobile">
                  <span className="result-line">
                    <span className="cond badge" style={badgeStyle(game.away.color, 18)}>{game.away.abbr}</span>
                    <span className="cond num result-rank">{game.away.rank}</span>
                    <span className="result-team">{game.away.name}</span>
                    <span style={{ flex: 1 }} />
                    <span className="cond num result-score">{game.away.score}</span>
                  </span>
                  <span className="result-line">
                    <span className="cond small-at">@</span>
                    <span className="cond badge" style={badgeStyle(game.home.color, 18)}>{game.home.abbr}</span>
                    <span className="cond num result-rank">{game.home.rank}</span>
                    <span className="result-team">{game.home.name}</span>
                    <span style={{ flex: 1 }} />
                    <span className="cond num result-score">{game.home.score}</span>
                  </span>
                  <span className="cond result-status">FINAL</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel panel--mobile">
            <div className="panel-header">
              <h2 className="cond">MY TEAMS</h2>
              <a href="#">Edit</a>
            </div>
            {myTeams.map((team) => (
              <button key={team.name} type="button" className="team-row team-row--mobile">
                <span className="cond badge badge--team" style={badgeStyle(team.color, 28)}>{team.badge}</span>
                <div className="team-copy">
                  <div className="team-topline">
                    <span className="cond team-name">{team.name}</span>
                    {team.hot ? <span className="cond num hot hot--small"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2-1-3 3 1 5 4 5 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" /></svg>{team.streak}</span> : null}
                  </div>
                  <span className="team-meta"><span className="team-result">{team.result}</span> {team.last}</span>
                </div>
                <span className="cond num team-rank">{team.rank}</span>
              </button>
            ))}
          </section>

          <section className="panel panel--mobile">
            <div className="panel-header">
              <h2 className="cond">HEISMAN RACE</h2>
              <a href="#">Full tracker →</a>
            </div>
            <button type="button" className="heisman-leader heisman-leader--mobile">
              <span className="cond num rank">1</span>
              <span className="cond badge badge--large" style={badgeStyle('#990000', 42)}>IND</span>
              <span className="leader-copy">
                <span className="cond leader-name">[QB NAME]</span>
                <span className="leader-meta">QB · 1,742 yds · 19 TD</span>
              </span>
              <span className="cond num leader-score">94.2</span>
            </button>
            {heisman.slice(0, 2).map((player) => (
              <button key={player.rank} type="button" className="heisman-row">
                <span className="cond num player-rank">{player.rank}</span>
                <span className="cond badge" style={badgeStyle(player.color, 22)}>{player.badge}</span>
                <span className="player-name">{player.name}</span>
                <span className="cond num player-score">{player.score}</span>
              </button>
            ))}
          </section>

          <section className="panel panel--mobile">
            <div className="panel-header">
              <h2 className="cond">UNDEFEATED WATCH</h2>
              <a href="#">Timeline →</a>
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
        </main>

        <nav className="mobile-nav" aria-label="Main mobile navigation">
          {mobileTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? 'mobile-tab active' : 'mobile-tab'}
              onClick={() => setActiveTab(tab)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5L12 5l8 7.5M6 10.5V19h12v-8.5" /></svg>
              <span className="cond">{tab}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

export default App
