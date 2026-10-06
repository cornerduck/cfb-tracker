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
| `awards` | 1 | Heisman winner, weekly tracker history, weekly awards, champion; marks the season archived |

Both game box-score endpoints require a week, team, or conference filter when
querying a season. The box-score stage requests team and player stats for each
regular/postseason week in the imported calendar (17 weeks for 2025). A clean
pass therefore uses 44 CFBD calls total (4.4% of the 1,000-call monthly limit),
run as six separate manual workflow runs. Each stage writes its own
`update_log` entry with its exact call count, endpoint names, and row counts.
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
uses 44 CFBD calls total; retries add their calls to the log. The values in
`details` provide the imported row counts and endpoint names for each stage.
