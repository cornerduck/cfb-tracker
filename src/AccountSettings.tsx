import { useState } from 'react'
import type { LiveUpdateSnapshot } from './types'
import type { Profile, TeamRecord } from './lib/supabase'

const timeZones = [
  'Europe/Berlin',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
]

type AccountSettingsProps = {
  profile: Profile
  email: string
  teams: TeamRecord[]
  liveUpdate: LiveUpdateSnapshot
  apiCallsThisMonth: number | null
  saving: boolean
  favoriteSaving: boolean
  updating: boolean
  notice: string
  error: string
  onClose: () => void
  onGoTeams: () => void
  onSave: (displayName: string, timeZone: string) => Promise<void>
  onToggleFavorite: (teamId: number) => Promise<void>
  onUpdateNow: () => Promise<void>
  onSignOut: () => Promise<void>
  onDeleteAccount: () => Promise<void>
}

function formatDate(value: string | null, timeZone: string) {
  if (!value) return 'Not yet updated'
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value))
}

function AccountSettings({
  profile,
  email,
  teams,
  liveUpdate,
  apiCallsThisMonth,
  saving,
  favoriteSaving,
  updating,
  notice,
  error,
  onClose,
  onGoTeams,
  onSave,
  onToggleFavorite,
  onUpdateNow,
  onSignOut,
  onDeleteAccount,
}: AccountSettingsProps) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? '')
  const [timeZone, setTimeZone] = useState(profile.time_zone || 'Europe/Berlin')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const favorites = teams.filter((team) => profile.favorite_team_ids.includes(team.id))
  const usagePercent = apiCallsThisMonth === null ? 0 : Math.min(apiCallsThisMonth / 10, 100)

  return (
    <div className="window-panel settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
      <div className="window-header settings-header">
        <h2 id="settings-heading" className="cond">SETTINGS</h2>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close settings">×</button>
      </div>
      <div className="settings-grid">
        <div className="settings-column">
          <section className="settings-card">
            <h3 className="cond">PROFILE</h3>
            <label className="form-label">Display name
              <input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label className="form-label">Email
              <input type="email" value={email} readOnly aria-readonly="true" />
            </label>
            <button className="outline-button cond" type="button" disabled={saving} onClick={() => void onSave(displayName.trim(), timeZone)}>
              {saving ? 'SAVING…' : 'SAVE PROFILE'}
            </button>
          </section>
          <section className="settings-card">
            <h3 className="cond">TIME ZONE</h3>
            <p>All kickoff times are shown in this time zone.</p>
            <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
              {!timeZones.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}
              {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </section>
          <section className="settings-card settings-account-card">
            <h3 className="cond">ACCOUNT</h3>
            <button className="outline-button cond" type="button" onClick={() => void onSignOut()}>SIGN OUT</button>
            <button className="danger-button cond" type="button" onClick={() => { setDeleteOpen((current) => !current); setDeleteConfirmation('') }}>
              {deleteOpen ? 'CANCEL DELETE' : 'DELETE ACCOUNT'}
            </button>
            {deleteOpen && (
              <div className="delete-confirm">
                <p>This permanently deletes your account, profile, favorites, and picks. Enter your email address to confirm.</p>
                <input aria-label="Confirm account email" type="email" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
                <button className="danger-button cond" type="button" disabled={deleteConfirmation.trim().toLowerCase() !== email.toLowerCase()} onClick={() => void onDeleteAccount()}>
                  DELETE PERMANENTLY
                </button>
              </div>
            )}
          </section>
        </div>
        <div className="settings-column">
          <section className="settings-card">
            <div className="settings-card-heading">
              <h3 className="cond">FAVORITE TEAMS</h3>
              <button type="button" className="text-button" onClick={onGoTeams}>Manage in Teams →</button>
            </div>
            {favorites.map((team) => (
              <div key={team.id} className="settings-favorite-row">
                <span className="cond badge" style={{ background: team.color ?? '#2A2E34' }}>{team.abbreviation ?? team.school.slice(0, 3).toUpperCase()}</span>
                <span>{team.school}</span>
                <button type="button" className="outline-button" disabled={favoriteSaving} onClick={() => void onToggleFavorite(team.id)}>Remove</button>
              </div>
            ))}
            {!favorites.length && <p>No favorite teams yet. Add a team with the star in Teams.</p>}
          </section>
        </div>
        <div className="settings-column">
          <section className="settings-card">
            <h3 className="cond">DATA AND UPDATES</h3>
            <div className="settings-data-row"><span>Last update</span><strong>{formatDate(liveUpdate.last_updated, timeZone)}</strong></div>
            <div className="settings-data-row"><span>Next update</span><strong>Automatic · game days</strong></div>
            <div className="settings-data-usage">
              <div className="settings-data-row"><span>API calls this month</span><strong>{apiCallsThisMonth === null ? 'Loading…' : `${apiCallsThisMonth} / 1,000`}</strong></div>
              <div className="usage-track"><span style={{ width: `${usagePercent}%` }} /></div>
            </div>
            <div className="settings-data-row"><span>Data source</span><strong>CollegeFootballData</strong></div>
            <button type="button" className="primary-button cond" disabled={updating} onClick={() => void onUpdateNow()}>
              {updating ? 'UPDATING…' : 'UPDATE NOW'}
            </button>
            <p>Runs a manual refresh of 2026 live-season data. Available again 15 minutes after each use.</p>
          </section>
        </div>
      </div>
      {(error || notice) && <p className={`settings-notice${error ? ' settings-notice--error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    </div>
  )
}

export default AccountSettings
