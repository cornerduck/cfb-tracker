-- Draft tab, phase 2: NFL teams with their records and the pick order of each account.

-- The 32 NFL teams with the record of the season that decides the draft order.
-- The nfl-standings Edge Function keeps it fresh (service role); everybody who
-- is signed in can read it.
create table public.nfl_teams (
  abbr text primary key,
  espn_id integer not null unique,
  name text not null,
  color text not null default '3A3F46' check (color ~ '^[0-9A-Fa-f]{6}$'),
  wins smallint not null default 0 check (wins >= 0),
  losses smallint not null default 0 check (losses >= 0),
  ties smallint not null default 0 check (ties >= 0),
  record_season smallint not null,
  updated_at timestamptz not null default now()
);

alter table public.nfl_teams enable row level security;
revoke all on table public.nfl_teams from anon, authenticated;
grant select on table public.nfl_teams to authenticated;
create policy "Authenticated users can read nfl_teams"
  on public.nfl_teams for select to authenticated using (true);

-- The changes an account made to the pick order of one draft year. Without a
-- row the order follows the records: worst team first, same order in round 2.
--   team_order  all 32 team abbreviations when the order was changed by hand
--   exceptions  [{ "round": 1, "team": "NYG", "owner": "NYJ", "forfeited": false }]
--               the pick that belongs to "team" in that round is owned by "owner"
--               or is forfeited
create table public.pick_orders (
  user_id uuid not null references auth.users (id) on delete cascade,
  draft_year smallint not null check (draft_year between 2020 and 2100),
  team_order text[],
  exceptions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, draft_year)
);

alter table public.pick_orders enable row level security;
revoke all on table public.pick_orders from anon, authenticated;
grant select on table public.pick_orders to authenticated;
create policy "Users can read their own pick orders"
  on public.pick_orders for select to authenticated using ((select auth.uid()) = user_id);

-- Saves the pick order of one draft year. Passing no team order and no
-- exceptions removes the row, which brings back the order by records.
create or replace function public.save_pick_order(
  p_year smallint,
  p_team_order text[],
  p_exceptions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  item jsonb;
  clean jsonb := '[]'::jsonb;
  seen text[] := '{}';
  item_round integer;
  item_team text;
  item_owner text;
  item_forfeited boolean;
begin
  if uid is null then
    raise exception 'Sign in to save a pick order';
  end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then
    raise exception 'The draft year is not valid';
  end if;
  if p_exceptions is null then
    p_exceptions := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_exceptions) <> 'array' or jsonb_array_length(p_exceptions) > 64 then
    raise exception 'The exceptions must be a list of at most 64 picks';
  end if;

  if p_team_order is not null then
    if cardinality(p_team_order) <> 32
      or (select count(distinct t) from unnest(p_team_order) as t) <> 32
      or exists (
        select 1 from unnest(p_team_order) as t
        where t is null or not exists (select 1 from public.nfl_teams n where n.abbr = t)
      ) then
      raise exception 'The team order must list each of the 32 teams once';
    end if;
  end if;

  for item in select value from jsonb_array_elements(p_exceptions) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(jsonb_typeof(item -> 'round'), '') <> 'number'
      or coalesce(jsonb_typeof(item -> 'team'), '') <> 'string'
      or coalesce(jsonb_typeof(item -> 'forfeited'), '') <> 'boolean'
      or coalesce(jsonb_typeof(item -> 'owner'), '') not in ('string', 'null') then
      raise exception 'A pick exception is not valid';
    end if;
    item_round := (item ->> 'round')::numeric::integer;
    item_team := item ->> 'team';
    item_owner := item ->> 'owner';
    item_forfeited := (item ->> 'forfeited')::boolean;
    if item_round not in (1, 2) then
      raise exception 'Only rounds 1 and 2 are supported';
    end if;
    if not exists (select 1 from public.nfl_teams where abbr = item_team)
      or (item_owner is not null and not exists (select 1 from public.nfl_teams where abbr = item_owner)) then
      raise exception 'A pick exception names an unknown team';
    end if;
    if (item_round || ':' || item_team) = any (seen) then
      raise exception 'A pick appears twice in the exceptions';
    end if;
    seen := seen || (item_round || ':' || item_team);
    -- A pick that stays with its own team and is not forfeited is no exception.
    if item_forfeited or (item_owner is not null and item_owner <> item_team) then
      clean := clean || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'round', item_round,
        'team', item_team,
        'owner', item_owner,
        'forfeited', item_forfeited
      ));
    end if;
  end loop;

  if p_team_order is null and jsonb_array_length(clean) = 0 then
    delete from public.pick_orders where user_id = uid and draft_year = p_year;
  else
    insert into public.pick_orders (user_id, draft_year, team_order, exceptions, updated_at)
    values (uid, p_year, p_team_order, clean, now())
    on conflict (user_id, draft_year) do update
      set team_order = excluded.team_order,
          exceptions = excluded.exceptions,
          updated_at = excluded.updated_at;
  end if;
end;
$$;

revoke all on function public.save_pick_order(smallint, text[], jsonb) from public, anon;
grant execute on function public.save_pick_order(smallint, text[], jsonb) to authenticated;
