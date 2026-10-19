import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from '../lib/supabase'
import type { LiveUpdateSnapshot } from '../types'

const PROFILE_FIELDS = 'user_id,display_name,favorite_team_ids,time_zone,recent_searches,updated_at'
const now = () => new Date().toISOString()

// Sign-in state, the owner profile (favorites, time zone, recent searches),
// the live-update status and the manual update. Synced across devices.
export function useAccount() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountNotice, setAccountNotice] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [favoriteSaving, setFavoriteSaving] = useState(false)
  const [manualUpdateBusy, setManualUpdateBusy] = useState(false)
  const [updateNowMessage, setUpdateNowMessage] = useState('')
  const [liveUpdate, setLiveUpdate] = useState<LiveUpdateSnapshot>({
    state: 'unavailable',
    last_updated: null,
    job: null,
    current_week: null,
    season_active: false,
    overdue: false,
  })

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
      setAuthError('')
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (!nextSession) {
        setProfile(null)
        setAccountError('')
      }
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthError(error.message)
      setSession(data.session)
      setAuthLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!supabase || !userId || !session) return
    const client = supabase
    let disposed = false
    const load = async () => {
      setProfileLoading(true)
      setAccountError('')
      try {
        const { data: existing, error } = await client.from('profiles').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle()
        if (error) throw error
        let loaded = existing as Profile | null
        if (!loaded) {
          const displayName = typeof session.user.user_metadata?.full_name === 'string'
            ? session.user.user_metadata.full_name
            : session.user.email?.split('@')[0] ?? null
          const { data, error: insertError } = await client.from('profiles')
            .insert({ user_id: userId, display_name: displayName }).select(PROFILE_FIELDS).single()
          if (insertError && insertError.code !== '23505') throw insertError
          if (insertError) {
            const { data: retried, error: retryError } = await client.from('profiles').select(PROFILE_FIELDS).eq('user_id', userId).single()
            if (retryError) throw retryError
            loaded = retried as Profile
          } else loaded = data as Profile
        }
        if (!disposed) setProfile(loaded)
      } catch (error) {
        if (!disposed) setAccountError(error instanceof Error ? error.message : 'Could not load your account profile.')
      } finally {
        if (!disposed) setProfileLoading(false)
      }
    }
    void load()
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Keep favorites and settings in sync with other devices.
  useEffect(() => {
    if (!supabase || !userId) return
    const client = supabase
    let disposed = false
    const sync = async () => {
      const { data, error } = await client.from('profiles').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle()
      if (!disposed && !error && data) setProfile(data as Profile)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    const interval = window.setInterval(() => void sync(), 30_000)
    window.addEventListener('focus', onVisibility)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onVisibility)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId])

  const supabaseBaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const refreshLiveStatus = useCallback(async () => {
    if (!supabaseBaseUrl || !supabaseAnonKey) return
    try {
      const response = await fetch(`${supabaseBaseUrl}/functions/v1/update-2026`, { headers: { apikey: supabaseAnonKey } })
      if (!response.ok) throw new Error(`Live update status request failed (${response.status})`)
      setLiveUpdate(await response.json() as LiveUpdateSnapshot)
    } catch {
      setLiveUpdate((current) => ({ ...current, state: 'unavailable' }))
    }
  }, [supabaseBaseUrl, supabaseAnonKey])

  useEffect(() => {
    void refreshLiveStatus()
    const interval = window.setInterval(() => void refreshLiveStatus(), 5 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [refreshLiveStatus])

  const run = async (busy: (value: boolean) => void, action: () => Promise<void>, fallback: string) => {
    busy(true)
    try {
      await action()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : fallback)
    } finally {
      busy(false)
    }
  }

  const signIn = (email: string, password: string) => run(setAuthBusy, async () => {
    if (!supabase) return
    setAuthError('')
    setAuthNotice('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
  }, 'Sign-in failed.')

  const sendPasswordReset = (email: string) => run(setAuthBusy, async () => {
    if (!supabase) return
    setAuthError('')
    setAuthNotice('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + import.meta.env.BASE_URL })
    if (error) setAuthError(error.message)
    else setAuthNotice('If an account exists for that email, a password reset link has been sent.')
  }, 'The password reset request failed.')

  const saveRecoveredPassword = (password: string) => run(setAuthBusy, async () => {
    if (!supabase) return
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setAuthError(error.message)
    else setPasswordRecovery(false)
  }, 'The password could not be updated.')

  const signOut = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setAccountError(error.message)
  }

  const updateProfile = async (patch: Partial<Pick<Profile, 'display_name' | 'time_zone' | 'recent_searches'>>, notice?: string) => {
    if (!supabase || !userId) return
    setProfileSaving(true)
    setAccountError('')
    setAccountNotice('')
    try {
      const { data, error } = await supabase.from('profiles').update({ ...patch, updated_at: now() })
        .eq('user_id', userId).select(PROFILE_FIELDS).single()
      if (error) throw error
      setProfile(data as Profile)
      if (notice) setAccountNotice(notice)
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Could not save your profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const saveProfile = (displayName: string, timeZone: string) =>
    updateProfile({ display_name: displayName || null, time_zone: timeZone }, 'Profile saved and synced.')

  const saveRecentSearch = (search: string) => {
    if (!profile) return Promise.resolve()
    const recent = [search, ...profile.recent_searches.filter((item) => item.toLowerCase() !== search.toLowerCase())].slice(0, 8)
    return updateProfile({ recent_searches: recent })
  }

  const toggleFavorite = async (teamId: number) => {
    if (!supabase || !profile || favoriteSaving) return
    setFavoriteSaving(true)
    setAccountError('')
    try {
      const { data, error } = await supabase.rpc('toggle_favorite_team', { p_team_id: teamId })
      if (error) throw error
      setProfile((current) => current ? { ...current, favorite_team_ids: data as number[], updated_at: now() } : current)
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Could not update favorite teams.')
    } finally {
      setFavoriteSaving(false)
    }
  }

  const updateNow = async () => {
    if (!supabase || manualUpdateBusy) return false
    setManualUpdateBusy(true)
    setUpdateNowMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('update-2026', { body: {} })
      if (error) {
        const context = (error as { context?: Response }).context
        const body = context ? await context.json().catch(() => null) : null
        setUpdateNowMessage(typeof body?.error === 'string' ? body.error : error.message)
        return false
      }
      if (data?.status !== 'success') {
        setUpdateNowMessage(typeof data?.error === 'string' ? data.error : 'The update did not complete successfully.')
        return false
      }
      setUpdateNowMessage(`Update complete · ${data.api_calls_used ?? 0} API calls used.`)
      void refreshLiveStatus()
      return true
    } catch (error) {
      setUpdateNowMessage(error instanceof Error ? error.message : 'The live-season update failed.')
      return false
    } finally {
      setManualUpdateBusy(false)
    }
  }

  const deleteAccount = async () => {
    if (!supabase) return
    setAccountError('')
    const { error } = await supabase.functions.invoke('delete-account', { body: {} })
    if (error) {
      setAccountError(error.message)
      return
    }
    setSession(null)
    setProfile(null)
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) setAuthError('Account deleted, but this device could not clear the saved session. Sign out manually.')
  }

  return {
    session,
    authLoading,
    authBusy,
    authError,
    authNotice,
    passwordRecovery,
    profile,
    profileLoading,
    accountError,
    setAccountError,
    accountNotice,
    profileSaving,
    favoriteSaving,
    manualUpdateBusy,
    updateNowMessage,
    liveUpdate,
    signIn,
    sendPasswordReset,
    saveRecoveredPassword,
    signOut,
    saveProfile,
    saveRecentSearch,
    toggleFavorite,
    updateNow,
    deleteAccount,
  }
}

export type Account = ReturnType<typeof useAccount>
