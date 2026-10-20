import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AuthScreen from './AuthScreen'
import PasswordRecoveryScreen from './PasswordRecoveryScreen'
import { AppContext, type AppState, type WindowSpec, useApp } from './app/context'
import { useAccount } from './app/useAccount'
import { useSeasonModel, useSeasons } from './app/useSeasonData'
import { SeasonScope } from './app/SeasonScope'
import { supabaseConfigurationError } from './lib/supabase'
import { Home } from './features/home/Home'
import { ErrorBox, Loading } from './shared/ui'
import { shortDateTime } from './shared/format'
import { AccountWindow, ErrorWindow, FavoritesWindow, SearchWindow, Top25Window, UndefeatedWindow } from './windows/SmallWindows'
import { GameDayWindow } from './features/gameday/GameDayWindow'

// Every screen except Home loads on first use.
const Scores = lazy(() => import('./features/scores/Scores').then((module) => ({ default: module.Scores })))
const Rankings = lazy(() => import('./features/rankings/Rankings').then((module) => ({ default: module.Rankings })))
const Standings = lazy(() => import('./features/standings/Standings').then((module) => ({ default: module.Standings })))
const Teams = lazy(() => import('./features/teams/Teams').then((module) => ({ default: module.Teams })))
const SettingsPage = lazy(() => import('./features/account/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const GameWindow = lazy(() => import('./windows/GameWindow').then((module) => ({ default: module.GameWindow })))
const PlayerWindow = lazy(() => import('./windows/PlayerWindow').then((module) => ({ default: module.PlayerWindow })))
const Stats = lazy(() => import('./features/stats/Stats').then((module) => ({ default: module.Stats })))
const Archive = lazy(() => import('./features/archive/Archive').then((module) => ({ default: module.Archive })))
const Pickem = lazy(() => import('./features/pickem/Pickem').then((module) => ({ default: module.Pickem })))

const TABS: Array<{ path: string; label: string }> = [
  { path: '/', label: 'HOME' },
  { path: '/scores', label: 'SCORES' },
  { path: '/rankings', label: 'RANKINGS' },
  { path: '/standings', label: 'STANDINGS' },
  { path: '/stats', label: 'STATS' },
  { path: '/teams', label: 'TEAMS' },
  { path: '/pickem', label: "PICK'EM" },
  { path: '/archive', label: 'ARCHIVE' },
]

const MOBILE_TABS: Array<{ path: string; label: string; icon: string }> = [
  { path: '/', label: 'HOME', icon: 'M3 11l9-7 9 7M5 9v11h14V9M10 20v-6h4v6' },
  { path: '/scores', label: 'SCORES', icon: 'M3 6h18v12H3zM12 6v12M7 10v4M17 10v4' },
  { path: '/rankings', label: 'RANKINGS', icon: 'M5 20V12M12 20V5M19 20v-5M3 20h18' },
  { path: '/standings', label: 'STANDINGS', icon: 'M4 6h16M4 12h16M4 18h16M8 4v16' },
]

const MORE_ITEMS: Array<{ path: string; label: string; icon: string }> = [
  { path: '/stats', label: 'Stats', icon: 'M4 20V10M10 20V4M16 20v-7' },
  { path: '/teams', label: 'Teams', icon: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z' },
  { path: '/pickem', label: "Pick'em", icon: 'M5 12l4 4 10-10' },
  { path: '/archive', label: 'Archive', icon: 'M3 5h18v4H3zM5 9v11h14V9M10 13h4' },
  { path: '/settings', label: 'Settings', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1' },
]

function useIsMobile() {
  const query = '(max-width: 1023px)'
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return mobile
}

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="STRDYS home">
      <span className="brand-mark varsity">S</span>
      <span className="brand-name cond">STRDYS</span>
    </NavLink>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const app = useApp()
  const { account, mobile, model, period, setPeriodKey, openWindow } = app
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => setMoreOpen(false), [location.pathname])
  const live = account.liveUpdate
  const name = account.profile?.display_name || account.session?.user.email || 'S'
  const banner = live.state === 'failed'
    ? `The last data update${live.last_updated ? ` after ${shortDateTime(live.last_updated, app.timeZone)}` : ''} failed. You're seeing the data from the last successful update.`
    : live.state === 'overdue' ? 'A scheduled data update is overdue.' : null
  const weekSelect = (
    <select className="week-select cond" aria-label="Week" value={period?.key ?? ''} onChange={(event) => setPeriodKey(event.target.value)}>
      {model.periods.map((item) => <option key={item.key} value={item.key}>{item.label.toUpperCase()}</option>)}
    </select>
  )
  const statusDot = (
    <button type="button" className={`status-dot status-dot--${live.state}`} title={live.last_updated ? `Last update ${shortDateTime(live.last_updated, app.timeZone)}` : 'Live data status'} aria-label="Data update status" onClick={() => openWindow({ type: 'error' })}><span /></button>
  )
  const bannerNode = banner && (
    <div className={`update-banner update-banner--${live.state}`} role="status">
      <span className="dot" />{banner}
      <button type="button" className="cond" onClick={() => openWindow({ type: 'error' })}>UPDATE NOW</button>
    </div>
  )

  if (mobile) {
    const homeRoute = location.pathname === '/'
    const index = model.periods.findIndex((item) => item.key === period?.key)
    return (
      <div className="shell shell--mobile">
        <header className="m-topbar">
          <Brand />
          <span className="grow" />
          <button type="button" className="icon-button" aria-label="Search" onClick={() => openWindow({ type: 'search' })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          </button>
          <button type="button" className="avatar" aria-label="Account" onClick={() => openWindow({ type: 'account' })}>{name.slice(0, 1).toUpperCase()}</button>
        </header>
        {bannerNode}
        {homeRoute && (
          <div className="m-week">
            <button type="button" className="icon-button" aria-label="Previous week" disabled={index <= 0} onClick={() => setPeriodKey(model.periods[index - 1].key)}>‹</button>
            <label className="m-week-label cond">{period?.label.toUpperCase()} ▾{weekSelect}</label>
            <button type="button" className="icon-button" aria-label="Next week" disabled={index >= model.periods.length - 1} onClick={() => setPeriodKey(model.periods[index + 1].key)}>›</button>
            <span className="grow" />
            <span className="updated small muted"><span className={`dot dot--${live.state}`} />{live.last_updated ? `Updated ${shortDateTime(live.last_updated, app.timeZone)}` : 'Live data'}</span>
          </div>
        )}
        <main className="m-main">{children}</main>
        <nav className="m-nav" aria-label="Main">
          {MOBILE_TABS.map((tab) => (
            <NavLink key={tab.path} to={tab.path} end={tab.path === '/'} className={({ isActive }) => `m-tab${isActive && !moreOpen ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={tab.icon} /></svg><span className="cond">{tab.label}</span>
            </NavLink>
          ))}
          <button type="button" className={`m-tab${moreOpen || MORE_ITEMS.some((item) => location.pathname.startsWith(item.path)) ? ' active' : ''}`} onClick={() => setMoreOpen(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg><span className="cond">MORE</span>
          </button>
        </nav>
        {moreOpen && (
          <div className="window-backdrop" onClick={() => setMoreOpen(false)}>
            <section className="window more-sheet" role="dialog" aria-label="More" onClick={(event) => event.stopPropagation()}>
              <span className="sheet-handle" />
              {MORE_ITEMS.map((item) => (
                <button key={item.path} type="button" className="more-item" onClick={() => { setMoreOpen(false); navigate(item.path) }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg><span className="cond">{item.label.toUpperCase()}</span><span className="grow" /><span className="muted">›</span>
                </button>
              ))}
              <div className="more-account">
                <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
                <span className="grow"><strong>{name}</strong><small className="muted"> · {app.favorites.size} favorite teams</small></span>
                <button type="button" className="outline-button cond" onClick={() => void account.signOut()}>SIGN OUT</button>
              </div>
            </section>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <nav className="topnav" aria-label="Main">
          {TABS.map((tab) => (
            <NavLink key={tab.path} to={tab.path} end={tab.path === '/'} className={({ isActive }) => `topnav-link cond${isActive ? ' active' : ''}`}>{tab.label}</NavLink>
          ))}
        </nav>
        <span className="grow" />
        <button type="button" className="search-box" onClick={() => openWindow({ type: 'search' })}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <span>Search</span>
        </button>
        {weekSelect}
        <button type="button" className="icon-button" aria-label="Favorite teams" onClick={() => openWindow({ type: 'favorites' })}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg>
        </button>
        {statusDot}
        <button type="button" className="avatar" aria-label="Account" onClick={() => openWindow({ type: 'account' })}>{name.slice(0, 1).toUpperCase()}</button>
      </header>
      {bannerNode}
      <main className={`main${location.pathname.startsWith('/settings') || location.pathname.startsWith('/teams/') ? ' main--scroll' : ''}`}>{children}</main>
    </div>
  )
}

function Windows({ spec }: { spec: WindowSpec | null }) {
  if (!spec) return null
  switch (spec.type) {
    case 'game': return <SeasonScope year={spec.season}><GameWindow gameId={spec.gameId} /></SeasonScope>
    case 'player': return <SeasonScope year={spec.season}><PlayerWindow playerId={spec.playerId} name={spec.name} teamId={spec.teamId} /></SeasonScope>
    case 'top25': return <Top25Window />
    case 'undefeated': return <UndefeatedWindow />
    case 'search': return <SearchWindow />
    case 'favorites': return <FavoritesWindow />
    case 'account': return <AccountWindow />
    case 'error': return <ErrorWindow />
    case 'gameday': return <SeasonScope year={spec.season}><GameDayWindow week={spec.week} /></SeasonScope>
  }
}

function SignedInApp({ account }: { account: ReturnType<typeof useAccount> }) {
  const mobile = useIsMobile()
  const seasons = useSeasons(true)
  const liveYear = useMemo(() => {
    const list = seasons.data ?? []
    return list.find((season) => season.status === 'live')?.year ?? list[0]?.year ?? null
  }, [seasons.data])
  const season = useSeasonModel(liveYear, true)
  const model = season.model
  const [periodKey, setPeriodKey] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('strdys-period')
    } catch {
      return null
    }
  })
  const [windowSpec, setWindowSpec] = useState<WindowSpec | null>(null)
  const closeWindow = useCallback(() => setWindowSpec(null), [])
  const location = useLocation()
  useEffect(() => setWindowSpec(null), [location.pathname])
  // A new browser session always opens on Home, even when the address still
  // holds the last page (for example a bookmark saved on Rankings).
  const navigate = useNavigate()
  useEffect(() => {
    try {
      if (sessionStorage.getItem('strdys-booted')) return
      sessionStorage.setItem('strdys-booted', '1')
    } catch {
      return
    }
    if (location.pathname !== '/') navigate('/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (seasons.error || season.error) {
    return <main className="center-screen"><ErrorBox message={((seasons.error ?? season.error) as Error).message} onRetry={() => { void seasons.refetch(); void season.refetch() }} /></main>
  }
  if (!seasons.data || (liveYear !== null && !model)) return <main className="center-screen"><Loading label="Loading the season…" /></main>
  if (!model) return <main className="center-screen"><p className="muted">No season has been imported yet.</p></main>

  const currentPeriod = model.currentPeriod()
  const period = (periodKey && model.periodByKey.get(periodKey)) || currentPeriod
  const favorites = new Set(account.profile?.favorite_team_ids ?? [])
  const state: AppState = {
    account,
    timeZone: account.profile?.time_zone || 'Europe/Berlin',
    favorites,
    model,
    liveYear: model.year,
    seasons: seasons.data,
    period,
    currentPeriod,
    setPeriodKey: (key) => {
      setPeriodKey(key)
      try {
        sessionStorage.setItem('strdys-period', key)
      } catch {
        // Session storage is optional.
      }
    },
    openWindow: setWindowSpec,
    closeWindow,
    mobile,
  }

  return (
    <AppContext.Provider value={state}>
      <Shell>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/scores" element={<Scores />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:slug" element={<Teams />} />
          <Route path="/pickem" element={<Pickem />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Shell>
      <Suspense fallback={null}><Windows spec={windowSpec} /></Suspense>
    </AppContext.Provider>
  )
}

function App() {
  const account = useAccount()
  if (account.authLoading) return <main className="auth-screen"><p className="auth-loading">Checking sign-in…</p></main>
  if (!account.session) {
    return <AuthScreen configured={!supabaseConfigurationError} loading={account.authBusy} error={supabaseConfigurationError ?? account.authError} notice={account.authNotice} onSignIn={account.signIn} onForgotPassword={account.sendPasswordReset} />
  }
  if (account.passwordRecovery) return <PasswordRecoveryScreen loading={account.authBusy} error={account.authError} onSave={account.saveRecoveredPassword} />
  if (account.profileLoading && !account.profile) return <main className="auth-screen"><p className="auth-loading">Loading your account…</p></main>
  if (!account.profile && account.accountError) {
    return (
      <main className="auth-screen">
        <section className="auth-card auth-card--error">
          <h1 className="cond">ACCOUNT UNAVAILABLE</h1>
          <p className="form-notice form-notice--error" role="alert">{account.accountError}</p>
          <button className="auth-submit cond" type="button" onClick={() => window.location.reload()}>RETRY</button>
          <button className="auth-link" type="button" onClick={() => void account.signOut()}>Sign out</button>
        </section>
      </main>
    )
  }
  return <SignedInApp account={account} />
}

export default App
