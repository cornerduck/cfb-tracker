create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'strdys_live_scheduler_token'
  ) then
    perform vault.create_secret(
      replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
        replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      'strdys_live_scheduler_token',
      'Internal token for scheduled STRDYS 2026 live-season updates'
    );
  end if;
end;
$$;

create table public.live_update_claims (
  claim_name text primary key,
  last_claimed_at timestamptz not null
);

alter table public.live_update_claims enable row level security;
revoke all on table public.live_update_claims from public, anon, authenticated;
grant select, insert, update on table public.live_update_claims to service_role;

create or replace function public.is_live_scheduler_token(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select candidate is not null
    and exists (
      select 1
      from vault.decrypted_secrets
      where name = 'strdys_live_scheduler_token'
        and decrypted_secret = candidate
    );
$$;

revoke all on function public.is_live_scheduler_token(text)
  from public, anon, authenticated;
grant execute on function public.is_live_scheduler_token(text) to service_role;

create or replace function public.claim_live_manual_update()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  insert into public.live_update_claims (claim_name, last_claimed_at)
  values ('live-2026', statement_timestamp())
  on conflict (claim_name) do update
    set last_claimed_at = excluded.last_claimed_at
    where public.live_update_claims.last_claimed_at <=
      statement_timestamp() - interval '15 minutes'
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_live_manual_update()
  from public, anon, authenticated;
grant execute on function public.claim_live_manual_update() to service_role;

create or replace function public.invoke_live_update(job_name text)
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
  if job_name not in (
    'near-live',
    'daily-results',
    'weekly',
    'monday',
    'cfp',
    'winter',
    'bootstrap'
  ) then
    raise exception 'Unsupported live update job';
  end if;

  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'strdys_project_url'
  limit 1;
  select decrypted_secret into publishable_key
  from vault.decrypted_secrets
  where name = 'strdys_publishable_key'
  limit 1;
  select decrypted_secret into scheduler_token
  from vault.decrypted_secrets
  where name = 'strdys_live_scheduler_token'
  limit 1;

  if coalesce(project_url, '') = '' or coalesce(publishable_key, '') = ''
    or coalesce(scheduler_token, '') = '' then
    raise exception 'Live update Vault configuration is incomplete';
  end if;

  select net.http_post(
    url := rtrim(regexp_replace(project_url, '/rest/v1/?$', ''), '/') ||
      '/functions/v1/update-2026',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'x-live-scheduler-token', scheduler_token
    ),
    body := pg_catalog.jsonb_build_object('job', job_name)
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.invoke_live_update(text)
  from public, anon, authenticated;
grant execute on function public.invoke_live_update(text) to postgres;

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
    'strdys-live-2026-saturday',
    '0 16-23 * * 6',
    'select public.invoke_live_update(''near-live'');'
  );
  perform cron.schedule(
    'strdys-live-2026-sunday-morning',
    '0 0-7 * * 0',
    'select public.invoke_live_update(''near-live'');'
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
