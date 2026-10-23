-- Draft tab, phase 4: the real NFL drafts for the archive (first round, from CFBD).
-- Filled by the import-draft Edge Function (service role); signed-in users can read.
create table public.nfl_draft_picks (
  draft_year smallint not null check (draft_year between 2000 and 2100),
  overall smallint not null check (overall >= 1),
  round smallint not null check (round >= 1),
  pick smallint,
  nfl_team text not null,
  nfl_abbr text,
  name text not null,
  position text,
  height smallint,
  weight smallint,
  college_team text,
  college_id integer,
  college_athlete_id text,
  college_conference text,
  primary key (draft_year, overall)
);

alter table public.nfl_draft_picks enable row level security;
revoke all on table public.nfl_draft_picks from anon, authenticated;
grant select on table public.nfl_draft_picks to authenticated;
create policy "Authenticated users can read nfl_draft_picks"
  on public.nfl_draft_picks for select to authenticated using (true);
