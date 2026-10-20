-- Phase 8: every College GameDay show since 1993, read from Wikipedia by the
-- update jobs. Seasons before the tracked ones are kept here as plain text
-- (teams are linked when they exist in the teams table).
create table if not exists public.gameday_stops (
  season smallint not null,
  stop integer not null,
  show_date date,
  visitor text not null,
  host text not null,
  visitor_rank integer,
  host_rank integer,
  visitor_points integer,
  host_points integer,
  city text,
  state text,
  site text,
  notes text,
  guest_picker text,
  corso_pick text,
  host_team_id bigint references public.teams(id) on delete set null,
  visitor_team_id bigint references public.teams(id) on delete set null,
  game_id bigint references public.games(id) on delete set null,
  primary key (season, stop)
);

alter table public.gameday_stops enable row level security;
grant select on public.gameday_stops to authenticated;
grant all privileges on public.gameday_stops to service_role;
drop policy if exists "Authenticated users can read gameday_stops" on public.gameday_stops;
create policy "Authenticated users can read gameday_stops"
  on public.gameday_stops for select to authenticated using (true);

create index if not exists gameday_stops_host_idx on public.gameday_stops (host_team_id);
create index if not exists gameday_stops_visitor_idx on public.gameday_stops (visitor_team_id);
