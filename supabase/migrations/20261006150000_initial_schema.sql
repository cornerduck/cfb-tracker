create table public.conferences (
  id bigint primary key,
  slug text not null unique,
  name text not null,
  short_name text,
  abbreviation text,
  group_name text check (group_name in ('Power 4', 'Group of 6', 'Independent')),
  classification text
);

create table public.teams (
  id bigint primary key,
  slug text not null unique,
  school text not null,
  mascot text,
  abbreviation text,
  color text,
  alt_color text,
  location jsonb not null default '{}'::jsonb,
  venue text,
  capacity integer check (capacity is null or capacity >= 0),
  is_fbs boolean not null default false
);

create table public.seasons (
  year smallint primary key check (year >= 1869),
  status text not null check (status in ('archived', 'live')),
  champion_team_id bigint references public.teams(id),
  title_game_id bigint,
  heisman_winner text,
  heisman_finalists jsonb not null default '[]'::jsonb,
  last_unbeaten_team_id bigint references public.teams(id)
);

create table public.calendar (
  season smallint not null references public.seasons(year) on delete cascade,
  week integer not null,
  season_type text not null,
  start_date timestamptz,
  end_date timestamptz,
  primary key (season, week, season_type)
);

create table public.conference_seasons (
  season smallint not null references public.seasons(year) on delete cascade,
  conference_id bigint not null references public.conferences(id),
  divisions text[] not null default '{}',
  primary key (season, conference_id)
);

create table public.team_seasons (
  season smallint not null references public.seasons(year) on delete cascade,
  team_id bigint not null references public.teams(id),
  conference_id bigint references public.conferences(id),
  division text,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  ties integer not null default 0 check (ties >= 0),
  final_ranking integer check (final_ranking is null or final_ranking > 0),
  postseason_result text,
  primary key (season, team_id)
);

create table public.games (
  id bigint primary key,
  season smallint not null references public.seasons(year) on delete cascade,
  week integer,
  season_type text not null,
  away_team_id bigint not null references public.teams(id),
  home_team_id bigint not null references public.teams(id),
  neutral_site boolean not null default false,
  away_points integer,
  home_points integer,
  away_line_scores integer[],
  home_line_scores integer[],
  start_time timestamptz,
  tv text,
  venue text,
  away_postgame_rank integer,
  home_postgame_rank integer,
  conference_game boolean,
  status text not null default 'scheduled',
  is_title_game boolean not null default false,
  bowl_name text,
  cfp_round text,
  check (away_team_id <> home_team_id)
);

alter table public.seasons
  add constraint seasons_title_game_id_fkey
  foreign key (title_game_id) references public.games(id);

create table public.lines (
  game_id bigint primary key references public.games(id) on delete cascade,
  provider_spreads jsonb not null default '{}'::jsonb,
  consensus_spread numeric,
  over_under numeric
);

create table public.game_team_stats (
  game_id bigint not null references public.games(id) on delete cascade,
  team_id bigint not null references public.teams(id),
  stats jsonb not null default '{}'::jsonb,
  primary key (game_id, team_id)
);

create table public.game_player_stats (
  game_id bigint not null references public.games(id) on delete cascade,
  player_id text not null,
  player_name text not null,
  team_id bigint not null references public.teams(id),
  category text not null,
  stats jsonb not null default '{}'::jsonb,
  primary key (game_id, player_id, team_id, category)
);

create table public.polls (
  season smallint not null references public.seasons(year) on delete cascade,
  week integer not null,
  source text not null check (source in ('AP', 'Coaches', 'CFP')),
  rank integer not null check (rank > 0),
  team_id bigint not null references public.teams(id),
  points integer,
  first_place_votes integer,
  primary key (season, week, source, team_id),
  unique (season, week, source, rank)
);

create table public.player_season_stats (
  season smallint not null references public.seasons(year) on delete cascade,
  player_id text not null,
  player_name text not null,
  team_id bigint references public.teams(id),
  category text not null,
  stats jsonb not null default '{}'::jsonb,
  primary key (season, player_id, category)
);

create table public.team_season_stats (
  season smallint not null references public.seasons(year) on delete cascade,
  team_id bigint not null references public.teams(id),
  category text not null,
  stats jsonb not null default '{}'::jsonb,
  national_ranks jsonb not null default '{}'::jsonb,
  primary key (season, team_id, category)
);

create table public.heisman_tracker (
  season smallint not null references public.seasons(year) on delete cascade,
  player_id text not null,
  player_name text not null,
  team_id bigint references public.teams(id),
  score numeric not null,
  rank integer check (rank is null or rank > 0),
  primary key (season, player_id)
);

create table public.heisman_weekly (
  season smallint not null references public.seasons(year) on delete cascade,
  week integer not null,
  player_id text not null,
  player_name text not null,
  team_id bigint references public.teams(id),
  score numeric not null,
  rank integer not null check (rank > 0),
  primary key (season, week, player_id),
  unique (season, week, rank)
);

create table public.weekly_awards (
  season smallint not null references public.seasons(year) on delete cascade,
  week integer not null,
  award_type text not null,
  game_id bigint references public.games(id),
  player_id text,
  details jsonb not null default '{}'::jsonb,
  primary key (season, week, award_type)
);

create table public.gameday (
  season smallint not null references public.seasons(year) on delete cascade,
  week integer not null,
  team_id bigint references public.teams(id),
  game_id bigint references public.games(id),
  guest_picker text,
  guest_pick_team_id bigint references public.teams(id),
  result jsonb not null default '{}'::jsonb,
  primary key (season, week)
);

create table public.coaches (
  season smallint not null references public.seasons(year) on delete cascade,
  team_id bigint not null references public.teams(id),
  coach_id text,
  coach_name text not null,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  ties integer not null default 0 check (ties >= 0),
  primary key (season, team_id)
);

create table public.head_to_head (
  team_a_id bigint not null references public.teams(id),
  team_b_id bigint not null references public.teams(id),
  team_a_wins integer not null default 0 check (team_a_wins >= 0),
  team_b_wins integer not null default 0 check (team_b_wins >= 0),
  ties integer not null default 0 check (ties >= 0),
  last_game_id bigint references public.games(id),
  primary key (team_a_id, team_b_id),
  check (team_a_id < team_b_id)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  favorite_team_ids bigint[] not null default '{}',
  time_zone text not null default 'Europe/Berlin',
  recent_searches jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.pickem_picks (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id bigint not null references public.games(id) on delete cascade,
  pick_team_id bigint references public.teams(id),
  mode text not null check (mode in ('straight_up', 'against_the_spread')),
  locked boolean not null default false,
  correct boolean,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, mode)
);

create table public.update_log (
  id bigint generated always as identity primary key,
  job text not null,
  trigger text not null check (trigger in ('schedule', 'manual')),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  api_calls_used integer not null default 0 check (api_calls_used >= 0),
  error text,
  details jsonb not null default '{}'::jsonb
);

create index games_season_week_start_time_idx
  on public.games (season, week, start_time);
create index polls_season_week_source_rank_idx
  on public.polls (season, week, source, rank);
create index update_log_started_at_idx
  on public.update_log (started_at desc);

do $$
declare
  table_name text;
  football_tables text[] := array[
    'conferences',
    'teams',
    'seasons',
    'calendar',
    'conference_seasons',
    'team_seasons',
    'games',
    'lines',
    'game_team_stats',
    'game_player_stats',
    'polls',
    'player_season_stats',
    'team_season_stats',
    'heisman_tracker',
    'heisman_weekly',
    'weekly_awards',
    'gameday',
    'coaches',
    'head_to_head',
    'update_log'
  ];
begin
  foreach table_name in array football_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      'Authenticated users can read ' || table_name,
      table_name
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;
grant select, insert, update, delete on public.profiles to authenticated;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their own profile"
  on public.profiles for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.pickem_picks enable row level security;
grant select, insert, update, delete on public.pickem_picks to authenticated;
create policy "Users can read their own picks"
  on public.pickem_picks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can create their own picks"
  on public.pickem_picks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users can update their own picks"
  on public.pickem_picks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their own picks"
  on public.pickem_picks for delete to authenticated
  using (user_id = (select auth.uid()));

grant usage on schema public to authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
