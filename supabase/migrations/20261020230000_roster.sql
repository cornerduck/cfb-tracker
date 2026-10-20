-- Team rosters per season. Rows are only ever added or updated, never deleted,
-- so a player keeps his history across seasons (the player id is the CFBD
-- athlete id, the same id the stats tables and the photo files use).
create table public.roster (
  season smallint not null references public.seasons(year) on delete cascade,
  team_id bigint not null references public.teams(id),
  player_id text not null,
  first_name text,
  last_name text,
  full_name text not null,
  jersey integer,
  position text,
  class_year integer,
  height integer,
  weight integer,
  home_city text,
  home_state text,
  home_country text,
  primary key (season, team_id, player_id)
);

create index roster_player_idx on public.roster (player_id);

alter table public.roster enable row level security;
grant select on table public.roster to authenticated;
grant all privileges on table public.roster to service_role;
create policy "Authenticated users can read roster"
  on public.roster for select to authenticated using (true);
