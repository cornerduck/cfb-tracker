import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Profile = {
  user_id: string
  display_name: string | null
  favorite_team_ids: number[]
  time_zone: string
  recent_searches: string[]
  updated_at: string
}

export type TeamRecord = {
  id: number
  school: string
  abbreviation: string | null
  color: string | null
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  ?.replace(/\/rest\/v1\/?$/, '')
  .replace(/\/+$/, '')
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  })
  : null

export const supabaseConfigurationError = !supabase
  ? 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the app build environment.'
  : null
