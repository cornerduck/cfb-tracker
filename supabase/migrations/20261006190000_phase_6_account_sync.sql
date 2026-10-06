create or replace function public.toggle_favorite_team(p_team_id bigint)
returns bigint[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_favorites bigint[];
begin
  update public.profiles as profile
  set favorite_team_ids = case
    when p_team_id = any(profile.favorite_team_ids)
      then array_remove(profile.favorite_team_ids, p_team_id)
    else array_append(profile.favorite_team_ids, p_team_id)
  end,
  updated_at = statement_timestamp()
  where profile.user_id = (select auth.uid())
  returning profile.favorite_team_ids into updated_favorites;

  if not found then
    raise exception 'The signed-in user profile does not exist';
  end if;

  return updated_favorites;
end;
$$;

revoke all on function public.toggle_favorite_team(bigint)
  from public, anon;
grant execute on function public.toggle_favorite_team(bigint) to authenticated;
