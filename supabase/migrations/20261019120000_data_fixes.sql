-- Data pipeline fixes (October 2026)
--
-- 1. games: keep the CFBD notes, CFP seeds and the live clock.
alter table public.games
  add column if not exists notes text,
  add column if not exists home_seed integer,
  add column if not exists away_seed integer,
  add column if not exists period integer,
  add column if not exists clock text;

-- 2. polls: CFBD numbers the final postseason poll as week 1, which collided
--    with the regular-season week 1 (preseason) poll. The season type is now
--    part of the key.
alter table public.polls
  add column if not exists season_type text not null default 'regular'
    check (season_type in ('regular', 'postseason'));
alter table public.polls drop constraint if exists polls_pkey;
alter table public.polls
  add constraint polls_pkey primary key (season, season_type, week, source, team_id);
drop index if exists public.polls_season_week_source_rank_idx;
create index if not exists polls_season_source_week_rank_idx
  on public.polls (season, source, season_type, week, rank);

-- FCS and Division II/III coaches polls were stored as the FBS Coaches Poll.
-- Their teams are not FBS teams; the next rankings import restores the rest.
delete from public.polls p
using public.teams t
where t.id = p.team_id and p.source = 'Coaches' and not t.is_fbs;

-- 3. player_season_stats: the stat name was read from the value field, so
--    every stored row has only null values. Remove those rows; the next
--    season-stats import writes them correctly. Positions are kept from now on.
alter table public.player_season_stats
  add column if not exists position text;
delete from public.player_season_stats s
where not exists (
  select 1 from jsonb_each(s.stats) e where e.value <> 'null'::jsonb
);

-- 4. game_team_stats: keys were stored as "<category>_<value>". CFBD category
--    names never contain an underscore, so the part before it is the name.
update public.game_team_stats s
set stats = fixed.stats
from (
  select game_id, team_id,
    jsonb_object_agg(split_part(e.key, '_', 1), e.value) as stats
  from public.game_team_stats g, jsonb_each(g.stats) e
  group by game_id, team_id
) fixed
where fixed.game_id = s.game_id and fixed.team_id = s.team_id
  and exists (select 1 from jsonb_object_keys(s.stats) k where k like '%\_%' escape '\');

-- 5. heisman_weekly is rebuilt in place (upsert, then prune), so a rank may
--    briefly belong to two players during a rebuild.
alter table public.heisman_weekly
  drop constraint if exists heisman_weekly_season_week_rank_key;

-- 6. Helpful read indexes for the app.
create index if not exists games_season_type_week_idx
  on public.games (season, season_type, week);
create index if not exists game_player_stats_player_idx
  on public.game_player_stats (player_id);
create index if not exists player_season_stats_season_category_idx
  on public.player_season_stats (season, category);
