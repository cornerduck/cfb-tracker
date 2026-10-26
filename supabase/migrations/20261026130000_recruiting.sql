-- Recruiting tab, phase 10 step 1: team class rankings, recruits and the transfer portal (from CFBD).
-- Filled by the import-recruiting Edge Function (service role); signed-in users can read.
-- Rank and points of a class come from CFBD; commits, star counts, average rating and the position and
-- state ranks of a recruit are computed by the import from the recruits of the class.

create table public.recruiting_teams (
  class_year smallint not null check (class_year between 2000 and 2100),
  team_id bigint not null references public.teams (id) on delete cascade,
  rank smallint check (rank is null or rank >= 1),
  points numeric(8, 2),
  commits smallint not null default 0 check (commits >= 0),
  average_rating numeric(6, 4),
  five_stars smallint not null default 0 check (five_stars >= 0),
  four_stars smallint not null default 0 check (four_stars >= 0),
  three_stars smallint not null default 0 check (three_stars >= 0),
  primary key (class_year, team_id)
);

create index recruiting_teams_class_rank_idx on public.recruiting_teams (class_year, rank);

create table public.recruits (
  class_year smallint not null check (class_year between 2000 and 2100),
  id text not null,
  athlete_id text,
  name text not null,
  position text,
  stars smallint check (stars is null or stars between 0 and 5),
  rating numeric(6, 4),
  national_rank integer check (national_rank is null or national_rank >= 1),
  position_rank integer check (position_rank is null or position_rank >= 1),
  state_rank integer check (state_rank is null or state_rank >= 1),
  high_school text,
  city text,
  state_province text,
  country text,
  height numeric(5, 1),
  weight smallint,
  committed_team_id bigint references public.teams (id) on delete set null,
  committed_to text,
  primary key (class_year, id)
);

create index recruits_class_national_rank_idx on public.recruits (class_year, national_rank);
create index recruits_class_team_idx on public.recruits (class_year, committed_team_id);
create index recruits_class_state_idx on public.recruits (class_year, state_province);

create table public.portal_entries (
  season smallint not null check (season between 2000 and 2100),
  id text not null,
  name text not null,
  first_name text,
  last_name text,
  position text,
  origin text,
  origin_team_id bigint references public.teams (id) on delete set null,
  destination text,
  destination_team_id bigint references public.teams (id) on delete set null,
  transfer_date timestamptz,
  stars smallint check (stars is null or stars between 0 and 5),
  rating numeric(6, 4),
  eligibility text check (eligibility is null or eligibility in ('Immediate', 'SittingOne', 'PendingAppeal', 'TBD', 'Withdrawn')),
  primary key (season, id)
);

create index portal_entries_origin_idx on public.portal_entries (season, origin_team_id);
create index portal_entries_destination_idx on public.portal_entries (season, destination_team_id);
create index portal_entries_rating_idx on public.portal_entries (season, rating desc);

alter table public.recruiting_teams enable row level security;
alter table public.recruits enable row level security;
alter table public.portal_entries enable row level security;

revoke all on table public.recruiting_teams, public.recruits, public.portal_entries from anon, authenticated;
grant select on table public.recruiting_teams, public.recruits, public.portal_entries to authenticated;

create policy "Authenticated users can read recruiting_teams"
  on public.recruiting_teams for select to authenticated using (true);
create policy "Authenticated users can read recruits"
  on public.recruits for select to authenticated using (true);
create policy "Authenticated users can read portal_entries"
  on public.portal_entries for select to authenticated using (true);
