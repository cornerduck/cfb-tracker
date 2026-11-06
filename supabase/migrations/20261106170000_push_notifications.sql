-- Push notifications (kickoff and final of Top 25 games and favorite teams)
-- and the results watch that replaces the fixed Saturday night slots.

-- CFBD marks kickoffs without a set time; those never get a kickoff notification.
alter table public.games
  add column if not exists start_time_tbd boolean not null default false;

-- One row per device that allowed notifications.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "Own push subscriptions are readable"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Own push subscriptions can be added"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Own push subscriptions can be changed"
  on public.push_subscriptions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Own push subscriptions can be removed"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant all on table public.push_subscriptions to service_role;

-- The VAPID key pair, created by the push Edge Function on first use.
-- Only the service role can read it.
create table public.push_config (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

alter table public.push_config enable row level security;
revoke all on table public.push_config from public, anon, authenticated;
grant all on table public.push_config to service_role;

-- Every notification is sent once per game and kind.
create table public.push_sent (
  game_id bigint not null references public.games(id) on delete cascade,
  kind text not null check (kind in ('kickoff', 'final')),
  sent_at timestamptz not null default now(),
  primary key (game_id, kind)
);

alter table public.push_sent enable row level security;
revoke all on table public.push_sent from public, anon, authenticated;
grant all on table public.push_sent to service_role;

-- Calls any STRDYS Edge Function with the internal scheduler token.
create or replace function public.invoke_strdys_function(function_name text, payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  publishable_key text;
  scheduler_token text;
  request_id bigint;
begin
  if function_name not in ('update-2026', 'push') then
    raise exception 'Unknown STRDYS function %', function_name;
  end if;

  select decrypted_secret into project_url
  from vault.decrypted_secrets where name = 'strdys_project_url' limit 1;
  select decrypted_secret into publishable_key
  from vault.decrypted_secrets where name = 'strdys_publishable_key' limit 1;
  select decrypted_secret into scheduler_token
  from vault.decrypted_secrets where name = 'strdys_live_scheduler_token' limit 1;

  if coalesce(project_url, '') = '' or coalesce(publishable_key, '') = ''
    or coalesce(scheduler_token, '') = '' then
    raise exception 'Live update Vault configuration is incomplete';
  end if;

  select net.http_post(
    url := rtrim(regexp_replace(project_url, '/rest/v1/?$', ''), '/') ||
      '/functions/v1/' || function_name,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'x-live-scheduler-token', scheduler_token
    ),
    body := payload
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.invoke_strdys_function(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.invoke_strdys_function(text, jsonb) to postgres;

-- The fixed Saturday night slots are replaced by the results watch (every
-- 30 minutes, an API call only when a game should be over), and the push
-- check runs every 5 minutes (no API calls).
create or replace function public.schedule_strdys_live_updates()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job record;
  scheduled_jobs integer := 0;
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'strdys_project_url'
  ) or not exists (
    select 1 from vault.decrypted_secrets where name = 'strdys_publishable_key'
  ) or not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'strdys_live_scheduler_token'
  ) then
    raise exception 'Add the STRDYS project URL and publishable key to Vault before scheduling';
  end if;

  for existing_job in
    select jobid from cron.job where jobname like 'strdys-live-2026-%'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'strdys-live-2026-results-watch',
    '*/30 * * * *',
    'select public.invoke_strdys_function(''update-2026'', ''{"job":"watch"}''::jsonb);'
  );
  perform cron.schedule(
    'strdys-live-2026-push',
    '*/5 * * * *',
    'select public.invoke_strdys_function(''push'', ''{"action":"run"}''::jsonb);'
  );
  perform cron.schedule(
    'strdys-live-2026-thursday-friday-results',
    '0 6,7 * * 5,6',
    'select public.invoke_live_update(''daily-results'');'
  );
  perform cron.schedule(
    'strdys-live-2026-sunday-weekly',
    '0 8,9 * * 0',
    'select public.invoke_live_update(''weekly'');'
  );
  perform cron.schedule(
    'strdys-live-2026-monday',
    '0 4,5 * * 1',
    'select public.invoke_live_update(''monday'');'
  );
  perform cron.schedule(
    'strdys-live-2026-cfp',
    '0 4,5 * 11,12 3',
    'select public.invoke_live_update(''cfp'');'
  );
  perform cron.schedule(
    'strdys-live-2026-december',
    '0 6,7 1-31 12 *',
    'select public.invoke_live_update(''winter'');'
  );
  perform cron.schedule(
    'strdys-live-2026-january',
    '0 6,7 1-31 1 *',
    'select public.invoke_live_update(''winter'');'
  );

  select count(*) into scheduled_jobs
  from cron.job
  where jobname like 'strdys-live-2026-%';
  return pg_catalog.jsonb_build_object('scheduled_jobs', scheduled_jobs);
end;
$$;

revoke all on function public.schedule_strdys_live_updates()
  from public, anon, authenticated;
grant execute on function public.schedule_strdys_live_updates() to postgres;

-- Apply the new schedule right away when the live season is already set up.
do $$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'strdys_project_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'strdys_publishable_key')
    and exists (select 1 from vault.decrypted_secrets where name = 'strdys_live_scheduler_token')
  then
    perform public.schedule_strdys_live_updates();
  end if;
end;
$$;
