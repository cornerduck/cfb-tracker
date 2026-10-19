import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import AccountSettings from '../../AccountSettings'
import { useApp } from '../../app/context'
import { supabase } from '../../lib/supabase'

const loadApiCalls = async () => {
  if (!supabase) return null
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabase.from('update_log').select('api_calls_used').gte('started_at', monthStart.toISOString())
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((sum, row) => sum + (row.api_calls_used as number), 0)
}

export function SettingsPage() {
  const { account, model } = useApp()
  const navigate = useNavigate()
  const calls = useQuery({ queryKey: ['api-calls'], queryFn: loadApiCalls, staleTime: 60_000 })
  if (!account.profile || !account.session) return null
  const teams = [...model.teams.values()].filter((team) => model.fbsIds.has(team.id))
    .map((team) => ({ id: team.id, school: team.school, abbreviation: team.abbreviation, color: team.color }))
    .sort((a, b) => a.school.localeCompare(b.school))
  return (
    <AccountSettings
      profile={account.profile}
      email={account.session.user.email ?? ''}
      teams={teams}
      liveUpdate={account.liveUpdate}
      apiCallsThisMonth={calls.data ?? null}
      saving={account.profileSaving}
      favoriteSaving={account.favoriteSaving}
      updating={account.manualUpdateBusy}
      notice={account.accountNotice || account.updateNowMessage}
      error={account.accountError}
      onBack={() => navigate(-1)}
      onGoTeams={() => navigate('/teams')}
      onSave={account.saveProfile}
      onToggleFavorite={account.toggleFavorite}
      onUpdateNow={async () => {
        await account.updateNow()
        void calls.refetch()
      }}
      onSignOut={account.signOut}
      onDeleteAccount={account.deleteAccount}
    />
  )
}
