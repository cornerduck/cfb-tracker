# STRDYS – Blueprint (v3, final design)

STRDYS is a private web app that follows the real NCAA college football season (FBS) automatically.
This file is the single source of truth. Every agent session must follow it.

**Rules for the agent**
- Work strictly phase by phase (section 17). Do only the phase you are asked to do.
- If something is unclear or seems technically impossible, stop and ask. Never change scope on your own.
- The screens in `design/` are the visual reference. Rebuild them as closely as possible (section 8).
- Never write secrets into code, config, commits or logs (section 3).

---

## 1. Vision

- First archived season: **2025**. First live season: **2026**. Then every following year.
  Earlier seasons (2024 and older) can be imported later with the same import script.
- The app always opens on **today's date**: current season, current week.
- **Offseason mode** (from the day after the national title game until the first game of the next season):
  Home shows the offseason screen.
- Interface language: **English**. Only user is the owner (single account, no invites).
- After setup the app runs **fully automatically**. The owner only adds image files to the repository (section 14).
- Name: **STRDYS**. App icon: varsity "S", white on black with a white border (design/AppIcon, option B).

---

## 2. Tech stack

| Part | Choice |
|---|---|
| Frontend | Vite + React + TypeScript (strict) |
| Routing | HashRouter (required for GitHub Pages) |
| Hosting | GitHub Pages, deployed by GitHub Actions on every push to `main` |
| Installable app | PWA (vite-plugin-pwa), installable on macOS, iOS and Android |
| Backend | Supabase (free tier): Auth, Postgres, Edge Functions, pg_cron |
| Data source | CollegeFootballData API v2 (`https://api.collegefootballdata.com`), free tier, 1,000 calls/month |
| GameDay data | Wikipedia article listing College GameDay broadcast locations, via the MediaWiki API |
| Charts | Lightweight React chart library (e.g. Recharts) or hand-written SVG |
| Map | d3-geo with bundled US TopoJSON (no external map service) |
| Fonts | Barlow, Barlow Condensed, Graduate (Google Fonts, self-hosted in the build) |

---

## 3. Secrets and deployment of the backend

- The CFBD API key exists **only** as a Supabase Edge Function secret named `CFBD_API_KEY`
  (set by the owner in the Supabase dashboard). Only Edge Functions call CFBD.
- The frontend uses only the Supabase project URL and **anon/public key**. These are not secret;
  store them as GitHub Actions **variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Database migrations and Edge Functions are deployed by a GitHub Actions workflow
  (`supabase db push`, `supabase functions deploy`) using GitHub Actions **secrets**
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and the variable `SUPABASE_PROJECT_REF`.
  The agent references these names only. It never asks for their values.
- Row Level Security on every table. Football data: readable by the signed-in user. Personal data: only by its owner.

---

## 4. Data architecture

All football data lives in Supabase, organized by season. The frontend only reads from the database,
so app usage never costs API calls. A completed season is never rewritten unless the owner asks for a re-import.

| Table | Contents |
|---|---|
| seasons | year, status (archived / live), champion, title game, Heisman winner and finalists, last unbeaten team |
| calendar | season, week, season type, start/end date (from CFBD calendar) |
| conferences | id, slug, name, short name, group (Power 4 / Group of 6 / Independent), divisions per season |
| teams | id, slug, school, mascot, abbreviation, colors, location, venue, capacity, FBS flag |
| team_seasons | per team and season: conference, division, record, final ranking, postseason result |
| games | every game with an FBS team: week, away/home, neutral site, scores by quarter, kickoff (UTC), TV, venue, rankings at kickoff, conference game, status, title game / bowl / CFP round labels, bowl name |
| lines | per game: closing spread per provider, consensus spread, over/under |
| game_team_stats | per game and team: yards, passing, rushing, first downs, 3rd down, turnovers, penalties, possession |
| game_player_stats | per game and player: every stat line in every category |
| polls | per season and week: AP, Coaches, CFP (rank, team, points, first-place votes) |
| player_season_stats | season stats per player (FBS) |
| team_season_stats | season stats per team with national ranks |
| heisman_tracker | current tracker scores per player |
| heisman_weekly | per week: tracker top 10 with ranks (for the Season Field) |
| weekly_awards | per week: upset, game, blowout, performance of the week |
| gameday | per season and week: campus, featured game, guest picker, guest pick, result |
| coaches | head coach per team and season with record |
| head_to_head | all-time series between two teams (computed on demand, cached) |
| pickem_picks | per user and game: pick, mode (straight up / against the spread), locked, correct |
| profiles | per user: display name, favorite team ids, time zone, recent searches |
| update_log | every run: time, job, trigger (schedule / manual), status, API calls used, error |

---

## 5. Automatic updates

Scheduled Supabase jobs. All times **Europe/Berlin**.

| When | Job |
|---|---|
| Saturday 18:00 to Sunday 08:00, every 2 hours | Near-live scores (in progress and final) |
| 08:00 the morning after Thursday and Friday games | Results of those games |
| Sunday 10:00 | Final scores, box scores, player stats, closing lines, upsets, Undefeated Watch, weekly awards, GameDay result |
| Monday 06:00 | AP and Coaches Poll, season stats, standings and race status, Heisman tracker, next week's games and lines, GameDay location, Pick'em slate |
| Wednesday 06:00 (November and December) | CFP ranking |
| Daily 08:00 (1 December to the national title game) | Results, bracket, polls |

- Each run writes to `update_log`. Target: under 400 API calls per month.
- The current week always comes from the CFBD calendar, never hardcoded.
- A failed run never deletes existing data.
- **Update now** (manual): button in the failed-update banner and in Settings. Calls an Edge Function that runs
  the full update. Allowed again 15 minutes after each use (enforced server-side).
- **Update indicator** in the top bar: green dot = last run fine, yellow = a run is overdue, red = last run failed.

---

## 6. Rules and calculations

- **Away @ Home:** away team first, home team second with "@". In stacked layouts the "@" sits at the start
  of the home row in a fixed-width slot; the away row has an empty slot of the same width so logos align.
  Neutral sites use "vs".
- **Upsets** use the consensus closing spread (CFBD consensus, else the average of providers).
  Tiers by the winner's spread: **Upset** +7 to +13.5, **Big upset** +14 to +20.5, **Stunner** +21 or more.
  FCS wins over FBS teams count.
- **Streak flame:** win streak of 5 or more, shown with the number.
- **Conference race status:** "Title spot" (currently holds a title game spot; "Leader" in divisions), "Alive", "Eliminated".
  Tiebreakers are not simulated. Eliminated only when a team can no longer reach a spot even winning out.
  **Conferences with divisions** (e.g. Sun Belt East/West): separate tables, games back and status per division;
  division winners meet in the title game.
- **CFP rules 2026** (stored per season): champions of ACC, Big 12, Big Ten, SEC get automatic bids;
  highest-ranked champion of American, CUSA, MAC, Mountain West, Pac-12, Sun Belt gets one; Notre Dame qualifies
  if ranked in the top 12; the rest at-large. Straight seeding, seeds 1–4 get a bye, no re-seeding.
  Before the first CFP ranking the bracket is **projected** from the AP Poll and current conference leaders.
- **Weekly awards** (Sunday): Upset of the Week (biggest spread won by an underdog), Game of the Week
  (closest margin, overtime breaks ties), Blowout of the Week (largest margin between FBS teams),
  Performance of the Week (best individual line by a defined points formula).
- **Top performers** in the game window: per team, the leader in passing yards, rushing yards,
  receiving yards and tackles (sacks, then interceptions break ties) – eight rows.
- **Heisman tracker:** stat-based only. QB, RB, WR. Score = 70 % production (percentile vs same position:
  yards, TDs, efficiency, turnovers) + 30 % team success (win % plus a bonus for the AP ranking).
  Season Field = everyone ever in the weekly top 10. The real winner is added in December.
- **Stats qualifying:** rate stats need a minimum (e.g. 15 pass attempts per team game, similar NCAA-style rules
  elsewhere); totals have no minimum.
- **Pick'em slate** (Monday): every game with an AP Top 25 team, the GameDay game, and every game of a favorite team.
  Picks lock at kickoff. Modes: straight up and against the spread.
- **Search** finds FBS teams and players only (no FCS team pages). Recent searches show only before typing.

---

## 7. Accounts

- Single owner account. Sign in with email + password (Google sign-in optional, see TUTORIAL).
- No sign-up screen in the app; the owner account is created once in the Supabase dashboard.
- Favorites, time zone, Pick'em picks and recent searches are stored in `profiles` / `pickem_picks`
  and sync across all devices.
- Settings: profile, time zone (default Europe/Berlin), favorite teams, data and updates
  (last/next update, API calls this month, Update now), sign out, delete account.

---

## 8. Design reference (`design/`)

`design/` contains one HTML file per screen (desktop and mobile). They are design mockups written in a
template format (`{{ value }}`, `<sc-for>`, `<sc-if>`); they do not run on their own.
Use them as the exact visual specification: colors, spacing, font sizes, layout, components and copy.
All data in them is sample or placeholder data (`[QB Name]`, `[n]`). Never hardcode it.

`design/SCREENS.md` maps every file to its screen.

### Look
- Mix of broadcast and clean. Calm layout; broadcast energy in scores, game tiles and headings. Compact density.
- Dark theme only. App accent white/neutral. The only colors are team colors and signal colors.

### Tokens
| Token | Value |
|---|---|
| Background | #0B0C0E |
| Top bar | #0E1013 |
| Tile | #15171A |
| Inner tile | #0F1114 |
| Borders | #23262B, #2A2E34 |
| Text / secondary / muted | #F2F3F5 / #C9CDD3 / #8E949C |
| Win, up | #4CC38A |
| Loss, down | #F0645A |
| Upset orange | #F08A3C |
| Stunner red | #E5484D |
| Logo plate | #D9DCE0 |
| GameDay ground / accent | #14110E / #F2C79F (header in the host team's colors) |

### Typography
Barlow Condensed (bold, uppercase, letter-spaced) for scores, abbreviations, tabs and headings.
Barlow for body text. Graduate (varsity) only for College GameDay and national champion banners.
Tabular figures for all numbers.

### Layout
- **Desktop ≥ 1024 px:** top bar; the page itself never scrolls (100dvh); only content inside tiles scrolls. Target: 13" MacBook Air.
- **Mobile < 1024 px:** bottom bar, normal page scrolling, windows become bottom sheets
  (drag down to close only when the sheet's content is scrolled to the top).
- Touch targets on mobile at least 44 px.

---

## 9. Navigation

- **Desktop top bar:** STRDYS mark · tabs **Home, Scores, Rankings, Standings, Stats, Teams, Pick'em, Archive**
  · search · week selector (weeks of the current season only) · favorites star (menu) · update dot · account menu.
- **Mobile bottom bar:** Home, Scores, Rankings, Standings, More. **More** opens a sheet with
  Stats, Teams, Pick'em, Archive, Settings and sign out. Search and account at the top.
- Everything is clickable: team → team page; player → player window; game → game window;
  tile headings and "→" links → the full tab.

---

## 10. Screens (see `design/SCREENS.md` for the files)

**Home** – week title (mobile: arrows and dropdown to switch week), Undefeated pill (desktop) / tile at the bottom (mobile),
weekly awards (logo plates, Stunner stamp), AP Top 5, Heisman race, biggest results, My Teams,
College GameDay tile (campus photo, pennants with logo plates, countdown to the show, guest picker, host record,
recent stops). After the game the GameDay tile and window switch to the final state (score, cover, top performers,
guest pick result, box score link). Offseason Home: countdown in three boxes, champion banner, season recap,
My Teams final, offseason calendar.

**Windows** – Game (Summary: box score, line, eight top performers, team stats with team names left/right
of the centered heading; Player stats: both teams side by side, scroll together), Player (photo slot,
this week, season, passing-by-game chart, next game, clickable game log), Top 25 (AP/Coaches/CFP, no points),
College GameDay, Undefeated Watch, Favorites menu, Account menu, Search, failed-update banner.

**Scores** – week bar incl. Conf Champ, Bowls, CFP; filters All / Top 25 / My Teams / Conference; games by kickoff slot;
week in numbers, upsets, ranked losses. Conf Champ week: all title games in one grid with conference logos.
Bowls by date with bowl name. CFP by round with seeds.

**Rankings** – AP (with conference logos, Biggest Movers, In and out), Coaches (AP rank column, Biggest Disagreements),
CFP (seeds, byes, auto bids, cut line, first four out; before the first release: countdown with German time only),
Playoff Bracket (first round with "@" host, bowl line for later rounds; every game opens the game window).

**Standings** – conference list with logos and leaders; table #, Team, Conf, GB, Overall, vs Ranked, Streak, Status;
divisions split; projected title game, game to watch, conference at a glance.

**Stats** – Players (categories, search, conference and single-team filters, sortable headers, all players with
infinite scroll; passing columns Comp%, Yds, Y/A, TD, INT, Sacks taken, Rating), Teams (Offense / Defense /
Special Teams), Heisman Tracker (top 10 with split bar, Season Field).

**Teams** – Directory (no records; star toggles favorites), Compare (team pickers, head-to-head strip,
leaders of team A left, season comparison middle, leaders of team B right), Team page tabs
Overview (next game card), Schedule, Stats (incl. points by game), History (current season highlighted).

**Pick'em** – This Week (slate, picks, progress, mode switch, My Season, Week by Week) and My Results
(summary, week bars, picks of any week with week arrows).

**Archive** – Seasons (season switcher with every archived season; champion banner, Heisman with winner highlighted,
final Top 10, playoff, conference champions, upsets, facts, "Every game and box score" → Scores of that season),
All Time, GameDay History (US map with every stop).

**Login and Settings** – sign in; settings as in section 7.

---

## 11. Not included (can be added later)

Win probability and game flow, bowl tracker, coaching carousel, transfer portal, recruiting, NFL Draft,
rivalry trophies, other awards, advanced ratings, push notifications, chaos meter, shareable cards, multiple users.
The data model must allow adding these later without rebuilding.

---

## 12. Time and date

Store UTC, display in the user's time zone (default Europe/Berlin). "Today" is always the real date.

## 13. Quality

TypeScript strict. Error handling on every external call. Loading, empty and error states everywhere.
Accessible contrast. Real buttons and links. Code organized by feature
(home, scores, rankings, standings, stats, teams, pickem, archive, account, shared).

---

## 14. Images

The owner adds images only as files in the repository. They can be added at any time.

```
public/images/logos/<team-slug>.png
public/images/conferences/<conference-slug>.png
public/images/stadiums/<team-slug>.jpg
public/images/players/<cfbd-player-id>.jpg
public/images/champions/<year>.jpg
public/images/gameday/<team-slug>.jpg   (campus photo used when GameDay visits)
public/images/app/                       (app icon, PWA icons)
```

- Generate `IMAGES.md` listing every exact file name (all FBS teams and conferences).
- **Logo plate:** in lists, tiles and badges every logo sits on a rounded light plate (#D9DCE0), centered with padding.
  In large headers the logo plate sits on the team-colored background.
- Photos get a dark gradient at the bottom so text on top stays readable.
- Missing image → monogram (abbreviation) in team color on the plate; missing photo → neutral placeholder. Never a broken image.
- Remove white backgrounds is the owner's job; recommend transparent PNGs, square, at least 256 × 256 px.

## 15. API budget

About 25–35 calls per week in season plus manual updates. One-time imports are spread over phases.

## 16. Development data

Only real data from the database. No hardcoded teams, scores or names in components.

---

## 17. Build phases

Each phase ends with a short summary and exactly what the owner has to do next.

1. **Skeleton and deployment:** Vite + React + TS, folder structure, design tokens, fonts, desktop and mobile shell
   with all tabs (empty), PWA with the STRDYS icon, GitHub Pages workflow, `design/` untouched.
2. **Supabase and data pipeline:** schema and RLS as migrations, Supabase deploy workflow, Edge Function calling CFBD
   with `CFBD_API_KEY`, test import of 2026 teams, conferences and calendar, `update_log`.
3. **2025 import:** complete 2025 season (games, lines, box scores, player stats, polls, CFP, Heisman tracker history, awards).
4. **Core screens with 2025 data:** Home, Scores, Rankings, Standings, Stats, Teams, Archive and all windows.
5. **2026 live season:** import up to the current week, all scheduled jobs, near-live Saturday runs, update dot, Update now.
6. **Account:** login, profile, favorites everywhere, settings, sync.
7. **Pick'em and Compare.**
8. **GameDay:** weekly automation, full history import, maps; offseason Home.
9. **Polish:** compare every screen with `design/`, images and logo plates, mobile testing, performance.
