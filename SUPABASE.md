# Supabase setup and season imports

The Supabase workflow applies database migrations and deploys Edge Functions on
pushes to `main` that change `supabase/` or the workflow itself. It uses the
repository's existing GitHub Actions secrets `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD`, and variables `SUPABASE_PROJECT_REF`,
`VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. The CFBD key stays in
Supabase as the `CFBD_API_KEY` Edge Function secret.

## Run the 2026 test import

1. Merge the Phase 2 changes to `main` and wait for the **Supabase** workflow to
   finish successfully. This applies the schema and deploys the function.
2. In GitHub, open **Actions → Supabase → Run workflow**.
3. Select branch **main**, check **Import the 2026 FBS teams, conferences, and
   calendar after deployment**, then click **Run workflow**.
4. Open the new workflow run. The **Run selected manual import** job must finish
   successfully and its final step prints a JSON result with
   `"status":"success"` and import counts.

The workflow passes a GitHub Actions OIDC token to the function. The function
accepts only tokens issued for this repository's manual workflow run on `main`;
the public Supabase anon key by itself cannot trigger the import. The import
uses three CFBD requests and upserts the 2026 season, FBS teams, FBS conferences,
conference-season division metadata, and calendar. It does not delete existing
rows.

## Check the database result

In the Supabase dashboard, open **Table Editor** and check `teams`,
`conferences`, `calendar`, and `update_log`. The latest `update_log` row should
have `job = test-import-2026`, `trigger = manual`, `status = success`,
`api_calls_used = 3`, and nonzero counts in `details`.

You can also run this read-only query in **SQL Editor**:

```sql
select
  (select count(*) from public.teams where is_fbs) as fbs_teams,
  (select count(*) from public.conferences) as conferences,
  (select count(*) from public.calendar where season = 2026) as calendar_weeks;
```

For a failed run, inspect the latest `update_log.error`, then open the failed
workflow step for its HTTP response. Existing data is not deleted on failure.

## Import the archived 2025 season

Deploy the changes to `main` and wait for the **Supabase** workflow to finish,
so it deploys the `import-2025` Edge Function. No new secrets or migrations are
needed. In **Actions → Supabase → Run workflow**, keep the 2026 test-import
checkbox unchecked, choose one 2025 stage, and run the workflow. Repeat once
for each stage in this order, waiting for each workflow run to finish before
starting the next:

| Stage | CFBD calls | Imported data |
|---|---:|---|
| `setup` | 4 | 2025 teams (including FCS opponents), FBS classification, conferences, conference seasons, calendar |
| `games` | 2 | Games involving FBS teams, closing lines, final team records |
| `boxscores` | 34 | Team and player box scores requested week-by-week |
| `rankings` | 1 | AP, Coaches, and CFP rankings |
| `season-stats` | 2 | Player and team season statistics |
| `awards` | 0 | Heisman winner, weekly tracker history, weekly awards, champion; marks the season archived |

Both game box-score endpoints require a week, team, or conference filter when
querying a season. The box-score stage requests team and player stats for each
regular/postseason week in the imported calendar (17 weeks for 2025). A clean
pass therefore uses 43 CFBD calls total (4.3% of the 1,000-call monthly limit),
run as six separate manual workflow runs. Each stage writes its own
`update_log` entry with its exact call count, endpoint names, and row counts.
Poll rows are keyed by season, week, source, and team; equal rank positions
within a poll are accepted.
The 2025 Heisman winner (Fernando Mendoza, Indiana) is recorded directly because
CFBD's current API does not expose an awards endpoint. The awards stage therefore
makes no CFBD calls.
All stages are safe to rerun: imports upsert existing data and do not delete
it. Retries use additional calls. If a stage fails, fix the reported cause and
rerun that stage before continuing. Only run `awards` last; that final stage
marks 2025 as archived.

Heisman weekly ranks are reconstructed from cumulative player box-score
production and team results using the blueprint's 80% production / 20% team
success weighting; passing/rushing/receiving activity is used to infer a
player's position because the game-stat feed does not include position. The
database/API does not supply this app-specific weekly tracker history directly.
Weekly upset, game, blowout, and performance awards are likewise calculated
from imported results, lines, and player box scores.

## Verify the archived season

The final `awards` workflow job must return `"status":"success"` and
`"api_calls_used":1`. In Supabase **SQL Editor**, run:

```sql
select
  s.year,
  s.status,
  s.champion_team_id,
  s.title_game_id,
  s.heisman_winner,
  (select count(*) from public.calendar c where c.season = s.year) as calendar_weeks,
  (select count(*) from public.team_seasons ts where ts.season = s.year) as teams,
  (select count(*) from public.games g where g.season = s.year) as games,
  (select count(*) from public.lines l join public.games g on g.id = l.game_id where g.season = s.year) as games_with_lines,
  (select count(*) from public.game_team_stats t join public.games g on g.id = t.game_id where g.season = s.year) as team_boxscores,
  (select count(*) from public.game_player_stats p join public.games g on g.id = p.game_id where g.season = s.year) as player_boxscores,
  (select count(*) from public.polls p where p.season = s.year and p.source = 'AP') as ap_poll_rows,
  (select count(*) from public.polls p where p.season = s.year and p.source = 'Coaches') as coaches_poll_rows,
  (select count(*) from public.polls p where p.season = s.year and p.source = 'CFP') as cfp_poll_rows,
  (select count(*) from public.player_season_stats p where p.season = s.year) as player_season_stat_rows,
  (select count(*) from public.team_season_stats t where t.season = s.year) as team_season_stat_rows,
  (select count(*) from public.heisman_weekly h where h.season = s.year) as heisman_weekly_rows,
  (select count(*) from public.heisman_tracker h where h.season = s.year) as heisman_tracker_rows,
  (select count(*) from public.weekly_awards a where a.season = s.year) as weekly_award_rows
from public.seasons s
where s.year = 2025;
```

The season is complete when it reports `status = archived`, a champion, title
game, and Heisman winner, and nonzero counts for games, both box-score tables,
AP and Coaches polls, season-stat tables, tracker history, and weekly awards.
CFP poll rows are nonzero only for weeks when the CFP committee published a
ranking. Check the per-stage call log and status with:

```sql
select job, status, api_calls_used, details, error, started_at
from public.update_log
where job like 'import-2025-%'
order by started_at;
```

The latest entry for each of the six stages should be successful. A clean pass
uses 43 CFBD calls total; retries add their calls to the log. The values in
`details` provide the imported row counts and endpoint names for each stage.

## Enable 2026 live-season updates

The live updater uses the CFBD key already configured as the `CFBD_API_KEY`
Edge Function secret. It reads the imported 2026 calendar to select the current
week, upserts games and scores, closing lines, box scores, rankings and season
statistics, computes weekly awards and Heisman tracker scores, and recomputes
current team records. Failed runs leave existing data intact and are recorded
in `update_log`.

After the Phase 5 changes are deployed:

1. Run **Actions → Supabase → Run workflow** on `main` with **Import the 2026
   FBS teams, conferences, and calendar after deployment** checked. This is
   safe to repeat; the import preserves existing 2026 records and now seeds
   season-specific conference membership.
2. In Supabase **SQL Editor**, create the two Vault entries using the existing
   public values from the repository's Actions variables. Store the project
   root URL (not its `/rest/v1/` suffix) as `strdys_project_url`, and the
   publishable/anon key as `strdys_publishable_key`:

   ```sql
   select vault.create_secret(
     'https://<project-ref>.supabase.co',
     'strdys_project_url'
   );
   select vault.create_secret(
     '<VITE_SUPABASE_ANON_KEY>',
     'strdys_publishable_key'
   );
   ```

   The database migration creates the separate random scheduler token in Vault.
   Do not put the CFBD API key or Supabase service-role key in these entries.
   Create each named entry only once.
3. Import 2026 results through the current week, including box scores, and
   refresh current polls and season stats:

   ```sql
   select public.invoke_live_update('bootstrap');
   ```

   This queues the protected Edge Function through `pg_net`. Confirm it
   completes before proceeding:

   ```sql
   select job, trigger, status, api_calls_used, error, started_at
   from public.update_log
   where job = 'live-2026-bootstrap'
   order by started_at desc
   limit 1;
   ```

   The initial backfill uses four CFBD requests per elapsed calendar week plus
   three current-season polls/stat requests. Re-running it is safe but makes
   additional CFBD calls.
4. Register the schedules (cron is left on its managed UTC default; the
   updater checks `Europe/Berlin` local time and ignores the alternate UTC
   hour, so the schedule remains correct across daylight-saving changes):

   ```sql
   select public.schedule_strdys_live_updates();
   select jobname, schedule
   from cron.job
   where jobname like 'strdys-live-2026-%'
   order by jobname;
   ```

   There should be eight jobs: Saturday 18:00–23:00 and Sunday 00:00–08:00
   every two hours for live scores; 08:00 Friday/Saturday results; Sunday
   10:00 box scores and lines; Monday 06:00 polls and season stats; Wednesday
   06:00 CFP rankings in November/December; and daily 08:00 postseason refreshes
   in December and January. All target times are interpreted as
   `Europe/Berlin`. Out-of-season runs skip CFBD calls.
5. Check that scheduled runs create successful `live-2026-*` entries:

   ```sql
   select job, trigger, status, api_calls_used, error, started_at
   from public.update_log
   where job like 'live-2026-%'
   order by started_at desc
   limit 20;
   ```

The 15-minute server-enforced cooldown is implemented for manual updates. The
Edge Function requires an authenticated owner session for that route. The
scheduled route uses its Vault token and does not depend on client
authentication. The app status indicator reads only the latest update state
and polls every five minutes.

The routine schedule is expected to remain below the 400-call monthly target:
the two-hour score pulls use one CFBD request each, with weekly box scores,
polls and season stats fetched only on their scheduled jobs.

## Phase 6 owner account

The app uses the existing Supabase Auth owner account with email and password;
it has no in-app registration. Before deploying the account UI:

1. The **Deploy app to GitHub Pages** workflow publishes the frontend after
   changes reach `main`. It requires the repository Actions variables
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. After the first successful
   deployment, the app is available at
   `https://cornerduck.github.io/cfb-tracker/`.
2. In GitHub, open **Settings → Pages** and verify the build and deployment
   source is **GitHub Actions**.
3. In **Authentication → Providers**, enable the Email provider and keep
   password sign-in enabled.
4. In **Authentication → Settings**, turn off **Allow new users to sign up**
   to keep this a single-owner app. The existing owner can still sign in and
   request password resets.
5. In **Authentication → URL Configuration**, set the deployed app URL as the
   Site URL and add it to the allowed redirect URLs. Password-reset links
   return to this URL.
   These are the public project URL and publishable/anon key; never use a
   service-role key in browser configuration.

The Supabase workflow deploys the `delete-account` Edge Function together with
the other functions. It verifies the caller's bearer token and deletes only
that caller through Supabase Auth Admin; profile and pick'em data are removed
by their `auth.users` foreign-key cascades. The browser asks the owner to
retype their email before calling the function.

The app creates the owner profile on first sign-in and stores the display
name, time zone, favorite team IDs, and recent team/player searches in the
existing owner-only `profiles` row. Those values are shared across devices.
Favorite changes are applied atomically by the `toggle_favorite_team` database
function, and the app refreshes the signed-in profile when a tab becomes
visible, when the window regains focus, and every 30 seconds while open.
Settings also reads the update log for the current month's CFBD request total.
Manual **Update now** uses the signed-in session and the existing server
cooldown.

Phase 6 connects the account and favorites, not the 2025/2026 football screens:
those still need a separate data-wiring pass before the imported seasons are
shown in place of the clearly labeled preview content.

## Data fixes (October 2026)

A review of the stored data found several import bugs. They are fixed in the
shared modules under `supabase/functions/_shared/` (used by both `import-2025`
and `update-2026`) and covered by `supabase/functions/_shared/shared_test.ts`.

| Problem | Fix |
|---|---|
| FCS and Division II/III coaches polls were stored as the FBS Coaches Poll; the CFP committee rankings ("Playoff Committee Rankings") were not recognised | Exact poll classification |
| The final postseason poll (CFBD week 1) overwrote the preseason poll | `polls.season_type` is part of the key |
| Team box-score keys were stored as `category_value` | Keys are the category; the migration repairs stored rows |
| Player season statistics stored the value as the name, so every row was empty | Rows are read from `statType`/`stat` and keep the player's position |
| Upset detection was inverted (favorites were counted as upsets) | Uses the home-perspective consensus spread; tiers Upset ≥ 7, Big upset ≥ 14, Stunner ≥ 21; FCS wins over FBS count |
| Performance of the Week could go to a punter | Points formula over passing, rushing, receiving and defense, per player and game |
| Game of the Week ignored overtime | Overtime breaks margin ties |
| Team venue and alternate color were never stored | Read from `location.name` and `alternateColor` |
| Games had no TV outlet, notes, CFP seeds or live clock | Stored from `/games/media`, `notes`, `playoff` and `/scoreboard` |
| Head coaches were never imported | `/coaches` is imported with season stats |

The near-live Saturday job now reads `/scoreboard` (one call) for in-progress
scores, clock and TV, and falls back to `/games` if the scoreboard is not
available for the API key.

### Repair the stored seasons

After this change is merged and the **Supabase** workflow has applied the
migration and deployed the functions:

1. Run **Actions → Supabase → Run workflow** on `main` five times, one 2025
   stage per run, in this order: `setup` (4 calls), `games` (3), `rankings`
   (1), `season-stats` (3), `awards` (0). The `awards` stage rebuilds the
   weekly awards, the Heisman tracker and the season summary from the stored
   data and records the 2025 Heisman winner and finalists. Total: 11 calls.
2. For 2026, press **Update now** once in the app (Settings → Data and
   updates). It refreshes all 2026 polls, season statistics, coaches, TV for
   the current week, weekly awards for every completed week and the Heisman
   tracker (about 9 calls).
3. Optional: to backfill TV outlets and notes for earlier 2026 weeks, run
   `select public.invoke_live_update('bootstrap');` in the SQL Editor (about
   five calls per elapsed week).

The `recompute` stage rebuilds awards, Heisman and the season summary of a
season without any CFBD calls and does not change the season status. The
workflow's **import_season** field imports an earlier season (2014 or later)
with the same stages.

## Pick'em and Compare (October 2026)

- Migration `20261020120000_pickem_compare.sql` enforces the Pick'em rules in the database: picks can only be
  saved or removed before kickoff, only for one of the two teams, and against-the-spread picks store the line
  they were made against. Every update job locks started games and grades finished picks (`grade_pickem_picks`,
  no API calls).
- Edge Function `head-to-head` returns the all-time series for the Compare screen. It caches the result in
  `head_to_head` and only asks CFBD again after the two teams have played a new game (one call per refresh,
  at most 20 per day). Every call is logged in `update_log` and counts toward the monthly budget.

## Draft Big Board (October 2026)

- Migration `20261023120000_big_board.sql` adds `big_boards` (user, draft year, player id as text, rank).
  Like the Pick'em picks it is read directly (row level security: only your own rows) and written through one
  function, `save_big_board(year, player_ids)`. The function replaces the whole board of that year in the given
  order, so ranks never duplicate or leave gaps. It rejects empty or duplicate ids, more than 100 players and
  anonymous callers.
- The player id is the CFBD athlete id, the same id `roster` and `player_season_stats` use.
- The Supabase workflow applies the migration when the change reaches `main`; nothing has to be run by hand.

## Draft pick order (October 2026)

- Migration `20261023140000_pick_order.sql` adds `nfl_teams` (32 teams, color, wins, losses, ties, season of the
  record; readable for signed-in users, written only by the Edge Function) and `pick_orders` (per user and draft
  year: own team order and a list of changed picks). Like the Big Board, `pick_orders` is read directly and written
  through one function, `save_pick_order(year, team_order, exceptions)`, which checks that the order lists all
  32 known teams once, that only rounds 1 and 2 are used and that owners are known teams. Sending no order and
  no exceptions removes the row.
- Edge Function `nfl-standings` (no API key, unofficial ESPN endpoints) fills `nfl_teams`: teams and colors from
  the ESPN teams list, records from the ESPN standings (with the conference standings of the core API as
  fallback). It answers only signed-in users and calls ESPN at most every three hours, however many people open
  the tab. The Draft tab calls it when the stored records are older than two hours or missing.
- ESPN answers requests without browser-like headers with 403, so the function sends them. If the teams list is
  still refused, the team names and abbreviations are taken from the standings and the stored colors are kept.
- No scheduled job is needed. The migration and the function are deployed by the Supabase workflow when the change
  reaches `main`. The first signed-in visit of the Pick Order tab fills the table.
- If ESPN changes its format, the function answers with an error that says how many teams had no record; the
  tab then shows the last stored records, or an error message when nothing is stored yet.

## Draft mock drafts (October 2026)

- Migration `20261023160000_mock_drafts.sql` adds `mock_drafts` (id, user, draft year, name, `slots` and `picks`
  as JSON). `slots` is the pick order at the start of the mock (64 entries with team, owner and forfeited), so a
  mock stays complete when the pick order is changed later. `picks` are the players chosen so far.
- Read directly (row level security: only your own rows), written through `save_mock_draft(...)` and
  `delete_mock_draft(id)`. The save function creates or updates by id (the app chooses the id), checks the 64
  slots, known teams, no player or pick twice, no pick for a forfeited slot, a name of 1 to 60 characters and a
  limit of 100 mocks per account. Other accounts' mocks cannot be changed or deleted.
- The migration is applied by the Supabase workflow after the merge. No Edge Function changes.

## Real NFL drafts in the archive (October 2026)

- Migration `20261023170000_nfl_draft_picks.sql` adds `nfl_draft_picks` (draft year, overall pick, NFL team and
  its ESPN abbreviation, player, position, college team and id, CFBD athlete id). Signed-in users can read it.
- Edge Function `import-draft` reads `/draft/picks` from CFBD (one call per draft year) and keeps the first
  round. The draft after a season is held in the following spring, so season 2025 gives the 2026 draft. Without a
  season it imports every archived season. Existing rows are updated, nothing is deleted.
- To fill it: after the merge and a successful deploy, open **Actions → Supabase → Run workflow**, select branch
  **main**, check **Import the first round of the real NFL drafts**, leave the other options as they are and run
  it. The last step prints the number of picks per draft year. Run it again after a new season is archived.
- CFBD often names the team of a pick only by its city ("Tennessee", "New York"). The import therefore also
  reads `/draft/teams` and resolves the team by `nflTeamId`, else by a unique city, else by the nickname ("Las
  Vegas Raiders" and "Oakland Raiders" both give LV). A bare "New York" or "Los Angeles" without a team id stays
  without abbreviation. The app resolves a missing abbreviation against `nfl_teams` as well, so a repeated import
  only improves the stored data.

## Recruiting and transfer portal (October 2026)

- Migration `20261026130000_recruiting.sql` adds `recruiting_teams` (class rank and points per team and class year,
  plus commits, average rating and five, four and three star counts), `recruits` (high school recruits of a class
  with national, position and state rank) and `portal_entries` (transfer portal moves per season). Signed-in users
  can read all three.
- CFBD only delivers the national rank of a recruit and the rank and points of a team class. Position rank, state
  rank, commits, average rating and star counts are computed by the import from the recruits of the class.
  Only high school recruits are imported (junior college and prep school recruits are left out).
- Edge Function `import-recruiting` takes a mode and a year. **class** reads `/recruiting/players` and
  `/recruiting/teams` (2 CFBD calls), **portal** reads `/player/portal` (1 call, data exists from 2021 on),
  **both** does all three. Existing rows are updated, nothing is deleted.
- How to run it, step by step:
  1. Merge the pull request and wait until the Supabase workflow of the merge on `main` has finished (it applies
     the migration and deploys the function).
  2. Open the repository on GitHub, then **Actions**, then **Supabase** in the list on the left.
  3. Click **Run workflow** (right side). Select branch **main**.
  4. Leave every old option as it is (test import unchecked, stage `skip`, roster `skip`, draft unchecked).
  5. Set **import_recruiting** to the mode and **recruiting_year** to the year, then click the green
     **Run workflow** button.
  6. Open the new run, then the job **Run selected manual import**, then the step
     **Import recruiting and transfer portal**. It prints a JSON result.
- Suggested order for the first import:
  1. `portal` with year `2026`. Check `portal_first_transfer_date` and `portal_last_transfer_date`. If they lie
     around December 2025 to spring 2026, CFBD names the portal season after the season that just ended, and the
     app shows "Portal 2026" for that window. Then run `portal` for `2025`, `2024`, `2023`, `2022` and `2021` if
     the history is wanted.
  2. `class` with year `2027` (the class that is recruited now), then `2026`, `2025`, `2024` and so on.
  3. `unmatched_commit_schools` and `unmatched_portal_schools` list school names that are not in the `teams`
     table with their number of entries, the most frequent first (mostly junior colleges and FCS schools). An FBS
     team with many entries in this list is a naming problem to report. For the portal, `portal_by_month` shows
     how many entries each month of the transfer date has.
- The result shows `api_calls_used`, the number of rows and, for the portal, how many entries have a destination.
  The same run is written to `update_log` with the job name `import-recruiting`.

## GameDay (October 2026)

- Migration `20261020140000_gameday_history.sql` adds `gameday_stops`: every College GameDay show since 1993.
- The Sunday, Monday and manual update jobs read the Wikipedia list
  "List of College GameDay (football TV program) locations" through the MediaWiki API (no CFBD calls),
  store every show, link shows of tracked seasons to their games and fill `gameday` per week.
  A GameDay failure never fails the update job; the job details show `gameday_error` instead.
- The first import happens with the next Sunday or Monday run, or right away with Update now in Settings.
