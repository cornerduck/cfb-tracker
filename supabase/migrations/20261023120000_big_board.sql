-- Big Board for the Mock Draft Simulator. Every account keeps one board per
-- draft year, up to 100 players in rank order. The player id is the CFBD
-- athlete id (text), the same id the roster and stats tables use.
--
-- Like the Pick'em picks, the board is written through one database function
-- instead of direct table writes. The function replaces the whole board in the
-- order it is given, so ranks can never get duplicated or leave gaps.
create table public.big_boards (
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_year smallint not null check (draft_year between 2020 and 2100),
  player_id text not null,
  rank smallint not null check (rank between 1 and 100),
  added_at timestamptz not null default now(),
  primary key (user_id, draft_year, player_id),
  unique (user_id, draft_year, rank)
);

alter table public.big_boards enable row level security;
revoke all on public.big_boards from authenticated;
grant select on public.big_boards to authenticated;
grant all privileges on public.big_boards to service_role;
create policy "Users can read their own big board"
  on public.big_boards for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.save_big_board(p_year smallint, p_player_ids text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  total integer := coalesce(cardinality(p_player_ids), 0);
begin
  if uid is null then
    raise exception 'Sign in to save your board' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Unknown draft year' using errcode = 'check_violation';
  end if;
  if total > 100 then
    raise exception 'A board holds at most 100 players' using errcode = 'check_violation';
  end if;
  if total > 0 and (
    exists (select 1 from unnest(p_player_ids) as id where id is null or id = '')
    or (select count(distinct id) from unnest(p_player_ids) as id) <> total
  ) then
    raise exception 'The player list has empty or duplicate entries' using errcode = 'check_violation';
  end if;

  delete from public.big_boards where user_id = uid and draft_year = p_year;
  if total > 0 then
    insert into public.big_boards (user_id, draft_year, player_id, rank)
    select uid, p_year, entry.id, entry.ord::smallint
      from unnest(p_player_ids) with ordinality as entry(id, ord);
  end if;
  return total;
end;
$$;

revoke all on function public.save_big_board(smallint, text[]) from public, anon;
grant execute on function public.save_big_board(smallint, text[]) to authenticated;
