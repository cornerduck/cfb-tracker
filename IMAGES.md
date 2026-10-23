# Images

All images live in `public/images/`. The app looks up which files exist when it is built, so a missing image
never causes an error: it simply shows the fallback. Add, replace or remove images at any time; every push to
`main` rebuilds the site within a minute or two.

| Folder | File name | Used for | Fallback |
|---|---|---|---|
| `logos/` | `<team-slug>.png` (`webp`, `svg`) | Every logo plate | Team abbreviation in the team color |
| `nfl/` | `<abbreviation>.png` (`webp`, `svg`), lower case as ESPN writes it, e.g. `ari.png`, `wsh.png`, `lv.png` | Pick order in the Draft tab | NFL abbreviation in the team color |
| `players/` | `<player-id>.png` (`jpg`, `jpeg`, `webp`) | Player window | Team color with the abbreviation |
| `gameday/` | `<team-slug>.jpg` (`jpeg`, `webp`, `png`) | GameDay tile and window when the show visits that campus | Host team color |
| `champions/` | `<season>.jpg` (`jpeg`, `webp`, `png`), e.g. `2025.jpg` | Champion banner in the archive | Champion team color |
| `stadiums/` | `<team-slug>.jpg` (`jpeg`, `webp`, `png`) | Team page header | Team color gradient |

NFL logos: the **NFL logos** workflow (Actions → NFL logos → Run workflow) downloads all 32 from ESPN and pushes
them to the branch `chore/nfl-logos`; open a pull request from it and merge. Run it again to refresh them.

Rules

- File names are lower case and must match exactly (the server is case sensitive).
- Logos (college and NFL): square, transparent background, about 200 × 200 px.
- Player photos: head and shoulders; landscape cut-outs (350 × 254, transparent) and square photos both work.
  The window crops from the top.
- Campus, champion and stadium photos: landscape, at least 1200 px wide, under 400 KB.
- The browser upload on GitHub takes at most 100 files at once; upload larger sets in batches.

Finding names

Team slugs (SQL editor, one row):

```sql
select string_agg(school || '  →  ' || slug, E'\n' order by school) from public.teams where is_fbs;
```

Player ids for a list of names: see the query in the project chat or ask for one; ids are the CFBD athlete ids
stored in `player_season_stats.player_id`.

Images are cached on the device after the first view. A replaced image may show the old version until the
cache refreshes on the next visit.
