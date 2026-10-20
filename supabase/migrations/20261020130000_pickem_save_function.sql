-- Pick'em writes go through one database function instead of direct table
-- writes. The function runs with the table owner's rights, so saving a pick
-- no longer depends on table grants for signed-in users ("permission denied
-- for table pickem_picks"), and all rules live in one place.

drop trigger if exists pickem_before_write on public.pickem_picks;
drop function if exists public.pickem_before_write();

-- Signed-in users may still read their own picks, but only write through
-- save_pickem_pick.
revoke insert, update, delete on public.pickem_picks from authenticated;
grant select on public.pickem_picks to authenticated;

create or replace function public.save_pickem_pick(p_game_id bigint, p_mode text, p_team_id bigint)
returns public.pickem_picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  game record;
  saved public.pickem_picks;
begin
  if uid is null then
    raise exception 'Sign in to save picks' using errcode = '42501';
  end if;
  if p_mode not in ('straight_up', 'against_the_spread') then
    raise exception 'Unknown pick mode' using errcode = 'check_violation';
  end if;
  select g.start_time, g.home_team_id, g.away_team_id, l.consensus_spread
    into game
    from public.games g
    left join public.lines l on l.game_id = g.id
    where g.id = p_game_id;
  if not found or game.start_time is null or game.start_time <= now() then
    raise exception 'Picks lock at kickoff' using errcode = 'check_violation';
  end if;

  if p_team_id is null then
    delete from public.pickem_picks
      where user_id = uid and game_id = p_game_id and mode = p_mode;
    return null;
  end if;

  if p_team_id not in (game.home_team_id, game.away_team_id) then
    raise exception 'The pick must be one of the two teams' using errcode = 'check_violation';
  end if;
  if p_mode = 'against_the_spread' and game.consensus_spread is null then
    raise exception 'This game has no line yet' using errcode = 'check_violation';
  end if;

  insert into public.pickem_picks as pick (user_id, game_id, mode, pick_team_id, spread, locked, correct, updated_at)
  values (
    uid, p_game_id, p_mode, p_team_id,
    case when p_mode = 'against_the_spread' then game.consensus_spread end,
    false, null, now()
  )
  on conflict (user_id, game_id, mode) do update
    set pick_team_id = excluded.pick_team_id,
        spread = excluded.spread,
        locked = false,
        correct = null,
        updated_at = now()
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.save_pickem_pick(bigint, text, bigint) from public, anon;
grant execute on function public.save_pickem_pick(bigint, text, bigint) to authenticated;
