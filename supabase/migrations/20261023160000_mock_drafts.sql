-- Draft tab, phase 3: saved mock drafts.
--
-- A mock keeps its own copy of the pick order (slots) from the moment it was
-- started, so it stays complete when the pick order is changed later. The
-- picks are the players chosen so far, in the order they were picked.
--   slots  [{ "pick": 1, "round": 1, "team": "CLE", "owner": "CLE", "forfeited": false }, ... 64 entries]
--   picks  [{ "pick": 1, "player_id": "4361741" }, ...]
create table public.mock_drafts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  draft_year smallint not null check (draft_year between 2020 and 2100),
  name text not null check (char_length(name) between 1 and 60),
  slots jsonb not null,
  picks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mock_drafts_user_year_idx on public.mock_drafts (user_id, draft_year, updated_at desc);

alter table public.mock_drafts enable row level security;
revoke all on table public.mock_drafts from anon, authenticated;
grant select on table public.mock_drafts to authenticated;
create policy "Users can read their own mock drafts"
  on public.mock_drafts for select to authenticated using ((select auth.uid()) = user_id);

-- Creates or updates one of your mocks. The caller chooses the id, so a mock
-- can be saved again and again without a first round trip.
create or replace function public.save_mock_draft(
  p_id uuid,
  p_year smallint,
  p_name text,
  p_slots jsonb,
  p_picks jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  item jsonb;
  clean_name text := btrim(coalesce(p_name, ''));
  slot_numbers integer[] := '{}';
  open_numbers integer[] := '{}';
  pick_numbers integer[] := '{}';
  player_ids text[] := '{}';
  n integer;
  affected integer;
begin
  if uid is null then
    raise exception 'Sign in to save a mock draft';
  end if;
  if p_id is null then
    raise exception 'A mock needs an id';
  end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then
    raise exception 'The draft year is not valid';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 60 then
    raise exception 'The name must have 1 to 60 characters';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) <> 64 then
    raise exception 'A mock needs the 64 picks of rounds 1 and 2';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) > 64 then
    raise exception 'A mock holds at most 64 picks';
  end if;

  for item in select value from jsonb_array_elements(p_slots) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(jsonb_typeof(item -> 'pick'), '') <> 'number'
      or coalesce(jsonb_typeof(item -> 'round'), '') <> 'number'
      or coalesce(jsonb_typeof(item -> 'team'), '') <> 'string'
      or coalesce(jsonb_typeof(item -> 'owner'), '') <> 'string'
      or coalesce(jsonb_typeof(item -> 'forfeited'), '') <> 'boolean' then
      raise exception 'A pick slot is not valid';
    end if;
    n := (item ->> 'pick')::numeric::integer;
    if n < 1 or n > 64 or n = any (slot_numbers) then
      raise exception 'The pick numbers must be 1 to 64, each once';
    end if;
    if (item ->> 'round')::numeric::integer not in (1, 2) then
      raise exception 'Only rounds 1 and 2 are supported';
    end if;
    if not exists (select 1 from public.nfl_teams where abbr = item ->> 'team')
      or not exists (select 1 from public.nfl_teams where abbr = item ->> 'owner') then
      raise exception 'A pick slot names an unknown team';
    end if;
    slot_numbers := slot_numbers || n;
    if not (item ->> 'forfeited')::boolean then
      open_numbers := open_numbers || n;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_picks) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(jsonb_typeof(item -> 'pick'), '') <> 'number'
      or coalesce(jsonb_typeof(item -> 'player_id'), '') <> 'string'
      or char_length(item ->> 'player_id') not between 1 and 40 then
      raise exception 'A chosen player is not valid';
    end if;
    n := (item ->> 'pick')::numeric::integer;
    if not (n = any (open_numbers)) or n = any (pick_numbers) then
      raise exception 'A pick is made twice or for a pick that is not open';
    end if;
    if (item ->> 'player_id') = any (player_ids) then
      raise exception 'A player cannot be picked twice';
    end if;
    pick_numbers := pick_numbers || n;
    player_ids := player_ids || (item ->> 'player_id');
  end loop;

  if not exists (select 1 from public.mock_drafts where id = p_id)
    and (select count(*) from public.mock_drafts where user_id = uid) >= 100 then
    raise exception 'You can keep at most 100 mocks. Delete one first.';
  end if;

  insert into public.mock_drafts (id, user_id, draft_year, name, slots, picks)
  values (p_id, uid, p_year, clean_name, p_slots, p_picks)
  on conflict (id) do update
    set name = excluded.name,
        slots = excluded.slots,
        picks = excluded.picks,
        updated_at = now()
    where public.mock_drafts.user_id = uid;
  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'This mock could not be saved';
  end if;
end;
$$;

revoke all on function public.save_mock_draft(uuid, smallint, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_mock_draft(uuid, smallint, text, jsonb, jsonb) to authenticated;

create or replace function public.delete_mock_draft(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in to delete a mock draft';
  end if;
  delete from public.mock_drafts where id = p_id and user_id = uid;
end;
$$;

revoke all on function public.delete_mock_draft(uuid) from public, anon;
grant execute on function public.delete_mock_draft(uuid) to authenticated;
