-- Phase 7: Pick'em rules enforced in the database and a cache for
-- head-to-head series.

-- 1. Pick'em ---------------------------------------------------------------
-- The line a pick was made against is stored with the pick, so later line
-- moves do not change an against-the-spread result.
alter table public.pickem_picks
  add column if not exists spread numeric;

-- Writes from signed-in users: only before kickoff, only one of the two
-- teams, the spread is copied from the stored line, and the result fields
-- stay untouched. Writes from the update jobs (service role) pass through.
create or replace function public.pickem_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  game record;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  select g.start_time, g.home_team_id, g.away_team_id, l.consensus_spread
    into game
    from public.games g
    left join public.lines l on l.game_id = g.id
    where g.id = new.game_id;
  if not found or game.start_time is null or game.start_time <= now() then
    raise exception 'Picks lock at kickoff' using errcode = 'check_violation';
  end if;
  if new.pick_team_id is not null and new.pick_team_id not in (game.home_team_id, game.away_team_id) then
    raise exception 'The pick must be one of the two teams' using errcode = 'check_violation';
  end if;
  if new.mode = 'against_the_spread' then
    if game.consensus_spread is null then
      raise exception 'This game has no line yet' using errcode = 'check_violation';
    end if;
    new.spread := game.consensus_spread;
  else
    new.spread := null;
  end if;
  new.locked := false;
  new.correct := null;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pickem_before_write on public.pickem_picks;
create trigger pickem_before_write
  before insert or update on public.pickem_picks
  for each row execute function public.pickem_before_write();

-- Picks can only be removed before kickoff.
drop policy if exists "Users can delete their own picks" on public.pickem_picks;
create policy "Users can delete their own picks"
  on public.pickem_picks for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = pickem_picks.game_id and g.start_time > now()
    )
  );

-- Locks every started game and grades finished ones. A tie (straight up)
-- or a push (against the spread) stays ungraded.
create or replace function public.grade_pickem_picks()
returns integer
language sql
security definer
set search_path = public
as $$
  with graded as (
    update public.pickem_picks p
    set locked = true,
        correct = case
          when g.status <> 'final' or g.home_points is null or g.away_points is null then null
          when p.mode = 'straight_up' then
            case when g.home_points = g.away_points then null
                 else p.pick_team_id = case when g.home_points > g.away_points then g.home_team_id else g.away_team_id end
            end
          when p.spread is null then null
          when p.pick_team_id = g.home_team_id then nullif(sign((g.home_points - g.away_points) + p.spread), 0) > 0
          else nullif(sign((g.away_points - g.home_points) - p.spread), 0) > 0
        end
    from public.games g
    where g.id = p.game_id and g.start_time <= now()
    returning 1
  )
  select count(*)::integer from graded;
$$;

revoke all on function public.grade_pickem_picks() from public, anon, authenticated;
grant execute on function public.grade_pickem_picks() to service_role;

create index if not exists pickem_picks_game_idx on public.pickem_picks (game_id);

-- 2. Head to head ----------------------------------------------------------
-- Filled on demand by the head-to-head Edge Function (one CFBD call per pair).
alter table public.head_to_head
  add column if not exists meetings jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();
