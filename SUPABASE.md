# Supabase setup and Phase 2 test import

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
4. Open the new workflow run. The **Run 2026 test import** job must finish
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
