# STRDYS

A private web app that follows the real FBS college football season automatically.
`BLUEPRINT.md` is the specification; `design/` holds the visual reference for every screen.

## Structure

```
src/
  app/          sign-in, profile sync, season loading, shared app state
  data/         Supabase queries, SeasonModel (records, polls, upsets), standings and CFP field
  features/     one folder per tab: home, scores, rankings, standings, teams, account
  windows/      game, player, Top 25, Undefeated Watch, search, favorites, account menu
  shared/       logo plates, game tiles, formatting, small UI parts
  styles/       design tokens, app styles, sign-in and settings styles
supabase/
  migrations/   database schema
  functions/    Edge Functions (CFBD imports and live updates) and _shared logic
```

All screens read from the database only. Nothing about teams, scores or names is hardcoded.
Images live in `public/images/` (see BLUEPRINT section 14); a missing logo falls back to a monogram.

## Development

```
npm ci
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run dev
npm run build
npm run lint
```

Backend setup and season imports are described in `SUPABASE.md`.
