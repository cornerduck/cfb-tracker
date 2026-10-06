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
production and team results using the blueprint's 70% production / 30% team
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

1. In **Authentication → Providers**, enable the Email provider and keep
   password sign-in enabled.
2. In **Authentication → Settings**, turn off **Allow new users to sign up**
   to keep this a single-owner app. The existing owner can still sign in and
   request password resets.
3. In **Authentication → URL Configuration**, set the deployed app URL as the
   Site URL and add it to the allowed redirect URLs. Password-reset links
   return to this URL.
4. Ensure the GitHub Actions variables `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` are available to the static app build. These are
   the public project URL and publishable/anon key; never use a service-role
   key in browser configuration.

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
