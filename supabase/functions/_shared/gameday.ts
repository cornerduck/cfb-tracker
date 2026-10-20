// College GameDay locations from the Wikipedia list, read through the
// MediaWiki API (no CFBD calls). The page holds one table per season since
// 1993; each row is one show with both teams, the score, city and site.

export const GAMEDAY_PAGE = "List_of_College_GameDay_(football_TV_program)_locations";
const API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "STRDYS/1.0 (private college football tracker; https://github.com/cornerduck/cfb-tracker)";

export type GamedayStop = {
  season: number;
  stop: number;
  show_date: string | null;
  visitor: string;
  host: string;
  visitor_rank: number | null;
  host_rank: number | null;
  visitor_points: number | null;
  host_points: number | null;
  city: string | null;
  state: string | null;
  site: string | null;
  notes: string | null;
  guest_picker: string | null;
  corso_pick: string | null;
};

export const fetchGamedayHtml = async () => {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: "parse",
    page: GAMEDAY_PAGE,
    prop: "text",
    format: "json",
    formatversion: "2",
    redirects: "1",
  }).toString();
  const result = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!result.ok) throw new Error(`Wikipedia request failed with HTTP ${result.status}`);
  const body = await result.json();
  const html = body?.parse?.text;
  if (typeof html !== "string" || !html) throw new Error("Wikipedia returned no page text");
  return html;
};

// ---------------------------------------------------------------- HTML helpers

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", minus: "−",
};

export const cleanText = (html: string) =>
  html
    .replace(/<sup\b[\s\S]*?<\/sup>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();

const attr = (attributes: string, name: string) => {
  const match = attributes.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Math.max(1, Number(match[1])) : 1;
};

type Cell = { text: string; header: boolean };

// Tables with their nearest preceding heading, rows expanded for rowspan
// and colspan so every row has one cell per column.
export const parseTables = (html: string) => {
  const tables: Array<{ heading: string; caption: string; rows: Cell[][] }> = [];
  const pattern = /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>|<table\b([^>]*)>/gi;
  let heading = "";
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (match[1] !== undefined) {
      heading = cleanText(match[1]);
      continue;
    }
    // Find the matching </table>, allowing nested tables.
    let depth = 1;
    const tag = /<\/?table\b[^>]*>/gi;
    tag.lastIndex = pattern.lastIndex;
    let end = -1;
    let inner: RegExpExecArray | null;
    while ((inner = tag.exec(html))) {
      depth += inner[0][1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = inner.index;
        break;
      }
    }
    if (end < 0) break;
    const body = html.slice(pattern.lastIndex, end);
    pattern.lastIndex = end;
    if (!/wikitable/i.test(match[2] ?? "")) continue;
    const caption = cleanText(body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? "");
    const grid: Cell[][] = [];
    const pending: Array<{ col: number; left: number; cell: Cell }> = [];
    const rows = body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    rows.forEach((row, rowIndex) => {
      const out: Cell[] = [];
      const place = () => {
        let carried = pending.find((item) => item.col === out.length && item.left > 0);
        while (carried) {
          out.push(carried.cell);
          carried.left -= 1;
          carried = pending.find((item) => item.col === out.length && item.left > 0);
        }
      };
      const cells = row.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?=<\/t[dh]>|<t[dh]\b|<\/tr>)/gi);
      for (const cell of cells) {
        place();
        const value: Cell = { text: cleanText(cell[3]), header: cell[1].toLowerCase() === "th" };
        const colspan = attr(cell[2], "colspan");
        const rowspan = attr(cell[2], "rowspan");
        for (let index = 0; index < colspan; index += 1) {
          if (rowspan > 1) pending.push({ col: out.length, left: rowspan - 1, cell: value });
          out.push(value);
        }
      }
      place();
      grid[rowIndex] = out;
    });
    tables.push({ heading, caption, rows: grid.filter((row) => row && row.length) });
    heading = ""; // a heading only labels the first table after it
  }
  return tables;
};

// ---------------------------------------------------------------- stops

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const parseDate = (text: string) => {
  const match = text.toLowerCase().match(/([a-z]+)\s+(\d{1,2})(?:\s*[–-]\s*\d{1,2})?(?:,\s*(\d{4}))?/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]);
  if (month < 0) return null;
  return { month, day: Number(match[2]), year: match[3] ? Number(match[3]) : null };
};

const splitTeam = (text: string) => {
  const match = text.match(/^(?:No\.\s*|#)?(\d{1,2})\s+(.+)$/i);
  return match ? { rank: Number(match[1]), name: match[2].trim() } : { rank: null, name: text.trim() };
};

const points = (text: string | undefined) => {
  const match = text?.match(/^\s*(\d{1,3})/);
  return match ? Number(match[1]) : null;
};

const columnName = (text: string) => {
  const value = text.toLowerCase();
  if (value.startsWith("date")) return "date";
  if (/visit|away/.test(value)) return "visitor";
  if (/host|home/.test(value)) return "host";
  if (value.startsWith("city")) return "city";
  if (/location|site/.test(value)) return "site";
  if (value.startsWith("note")) return "notes";
  if (/guest/.test(value)) return "guest";
  if (/corso/.test(value)) return "corso";
  if (/score|result/.test(value) || value === "") return "";
  return value;
};

export const parseGamedayStops = (html: string): GamedayStop[] => {
  const stops: GamedayStop[] = [];
  let previousSeason = 1992;
  for (const table of parseTables(html)) {
    const headerIndex = table.rows.findIndex((row) => row.filter((cell) => cell.header).length >= row.length / 2 &&
      row.some((cell) => /date/i.test(cell.text)) && row.some((cell) => /host/i.test(cell.text)));
    if (headerIndex < 0) continue;
    // Name each column; a blank column after Visitor or Host holds its score.
    const names: string[] = [];
    for (const cell of table.rows[headerIndex]) {
      let name = columnName(cell.text);
      const last = names.at(-1);
      if ((name === "" || name === last) && (last === "visitor" || last === "host")) name = `${last}_score`;
      names.push(name);
    }
    const column = (row: Cell[], name: string) => {
      const index = names.indexOf(name);
      return index >= 0 ? row[index]?.text ?? "" : "";
    };
    const body = table.rows.slice(headerIndex + 1).filter((row) => !row.every((cell) => cell.header));

    // Season: the year of a dated fall or January show, else a year in the
    // heading or caption, else the season after the previous table.
    let season: number | null = null;
    for (const row of body) {
      const date = parseDate(column(row, "date"));
      if (!date?.year) continue;
      if (date.month === 0) season = date.year - 1;
      else if (date.month >= 7) season = date.year;
      if (season !== null) break;
    }
    const labelled = `${table.heading} ${table.caption}`.match(/\b(19[89]\d|20\d{2})\b/);
    if (season === null && labelled) season = Number(labelled[1]);
    if (season === null || season <= previousSeason) season = previousSeason + 1;
    previousSeason = season;

    let stop = 0;
    for (const row of body) {
      const visitorText = column(row, "visitor");
      const hostText = column(row, "host");
      const date = parseDate(column(row, "date"));
      // NFL draft and other shows without a game.
      if (!visitorText || !hostText || visitorText === hostText) continue;
      if (date && date.month >= 2 && date.month <= 6) continue;
      const visitor = splitTeam(visitorText);
      const host = splitTeam(hostText);
      const [city, ...rest] = column(row, "city").split(",").map((part) => part.trim());
      stop += 1;
      const year = date ? date.year ?? (date.month <= 1 ? season + 1 : season) : null;
      stops.push({
        season,
        stop,
        show_date: date && year ? `${year}-${String(date.month + 1).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : null,
        visitor: visitor.name,
        host: host.name,
        visitor_rank: visitor.rank,
        host_rank: host.rank,
        visitor_points: points(column(row, "visitor_score")),
        host_points: points(column(row, "host_score")),
        city: city || null,
        state: rest.join(", ") || null,
        site: column(row, "site") || null,
        notes: column(row, "notes") || null,
        guest_picker: (() => {
          const value = column(row, "guest");
          return value && !/^(none|n\/a|—|-)$/i.test(value) ? value : null;
        })(),
        corso_pick: column(row, "corso") || null,
      });
    }
  }
  return stops;
};

// ---------------------------------------------------------------- teams

const ALIASES: Record<string, string> = {
  "miami fl": "miami",
  "miami florida": "miami",
  "miami ohio": "miami oh",
  "pitt": "pittsburgh",
  "north carolina state": "nc state",
  "southern california": "usc",
  "louisiana state": "lsu",
  "brigham young": "byu",
  "central florida": "ucf",
  "texas christian": "tcu",
  "southern methodist": "smu",
  "mississippi": "ole miss",
  "hawaii": "hawai i",
  "army": "army",
  "navy": "navy",
  "ohio st": "ohio state",
  "uconn": "connecticut",
  "umass": "massachusetts",
  "fiu": "florida international",
  "jmu": "james madison",
  "north dakota st": "north dakota state",
  "app state": "appalachian state",
};

export const normalizeName = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

export const teamMatcher = (teams: Array<{ id: number; school: string; abbreviation?: string | null; is_fbs?: boolean }>) => {
  const byName = new Map<string, number>();
  // FBS teams win ties (e.g. a former FCS name).
  for (const team of [...teams].sort((a, b) => Number(Boolean(a.is_fbs)) - Number(Boolean(b.is_fbs)))) {
    byName.set(normalizeName(team.school), team.id);
  }
  return (name: string) => {
    const key = normalizeName(name);
    return byName.get(key) ?? byName.get(ALIASES[key] ?? "") ?? byName.get(normalizeName(ALIASES[key] ?? "")) ?? null;
  };
};

// ---------------------------------------------------------------- storage

// deno-lint-ignore no-explicit-any
type Db = any;

const pageAll = async <T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string) => {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build(offset, offset + 999);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
};

type GameLink = { id: number; week: number | null; season_type: string; home_team_id: number; away_team_id: number; start_time: string | null };

// Links every show to its game where the season is stored, so tracked
// seasons also get one gameday row per week (postseason shows follow the
// last regular week in order).
export const linkStops = (
  stops: Array<GamedayStop & { host_team_id: number | null; visitor_team_id: number | null }>,
  gamesBySeason: Map<number, GameLink[]>,
) => {
  const linked = stops.map((stop) => {
    const games = gamesBySeason.get(stop.season) ?? [];
    const date = stop.show_date ? Date.parse(`${stop.show_date}T12:00:00Z`) : null;
    const game = stop.host_team_id && stop.visitor_team_id
      ? games.find((item) =>
        ((item.home_team_id === stop.host_team_id && item.away_team_id === stop.visitor_team_id) ||
          (item.home_team_id === stop.visitor_team_id && item.away_team_id === stop.host_team_id)) &&
        (date === null || !item.start_time || Math.abs(Date.parse(item.start_time) - date) < 3 * 86400_000)
      )
      : undefined;
    return { ...stop, game_id: game?.id ?? null, game };
  });
  const weekly: Array<{ season: number; week: number; team_id: number | null; game_id: number; guest_picker: string | null; guest_pick_team_id: null; result: Record<string, unknown> }> = [];
  for (const [season, games] of gamesBySeason) {
    const lastRegular = Math.max(0, ...games.filter((game) => game.season_type === "regular").map((game) => game.week ?? 0));
    let post = 0;
    const used = new Set<number>();
    for (const stop of linked.filter((item) => item.season === season && item.game)) {
      const game = stop.game!;
      const week = game.season_type === "regular" ? game.week ?? 0 : lastRegular + 1 + post++;
      if (used.has(week)) continue;
      used.add(week);
      weekly.push({
        season,
        week,
        team_id: stop.host_team_id,
        game_id: game.id,
        guest_picker: stop.guest_picker,
        guest_pick_team_id: null,
        result: { stop: stop.stop, city: stop.city, state: stop.state, site: stop.site, notes: stop.notes, corso_pick: stop.corso_pick },
      });
    }
  }
  return { stops: linked.map(({ game: _game, ...stop }) => stop), weekly };
};

export const syncGameday = async (supabase: Db) => {
  const parsed = parseGamedayStops(await fetchGamedayHtml());
  if (parsed.length < 100) throw new Error(`Only ${parsed.length} GameDay shows were found on Wikipedia; the page layout may have changed`);
  const teams = await pageAll<{ id: number; school: string; abbreviation: string | null; is_fbs: boolean }>(
    (from, to) => supabase.from("teams").select("id,school,abbreviation,is_fbs").order("id").range(from, to),
    "teams",
  );
  const match = teamMatcher(teams);
  const withTeams = parsed.map((stop) => ({ ...stop, host_team_id: match(stop.host), visitor_team_id: match(stop.visitor) }));

  const { data: seasonRows, error: seasonError } = await supabase.from("seasons").select("year");
  if (seasonError) throw new Error(`Could not load seasons: ${seasonError.message}`);
  const gamesBySeason = new Map<number, GameLink[]>();
  for (const { year } of seasonRows ?? []) {
    gamesBySeason.set(year, await pageAll<GameLink>(
      (from, to) => supabase.from("games").select("id,week,season_type,home_team_id,away_team_id,start_time").eq("season", year).order("id").range(from, to),
      `${year} games`,
    ));
  }
  const { stops, weekly } = linkStops(withTeams, gamesBySeason);

  for (let offset = 0; offset < stops.length; offset += 250) {
    const { error } = await supabase.from("gameday_stops").upsert(stops.slice(offset, offset + 250), { onConflict: "season,stop" });
    if (error) throw new Error(`Could not store GameDay shows: ${error.message}`);
  }
  // Rows that no longer exist on the page (a show removed or merged).
  const lastStop = new Map<number, number>();
  for (const stop of stops) lastStop.set(stop.season, Math.max(lastStop.get(stop.season) ?? 0, stop.stop));
  for (const [season, last] of lastStop) {
    const { error } = await supabase.from("gameday_stops").delete().eq("season", season).gt("stop", last);
    if (error) throw new Error(`Could not clean up GameDay shows: ${error.message}`);
  }

  for (const season of gamesBySeason.keys()) {
    const rows = weekly.filter((row) => row.season === season);
    const { error: deleteError } = await supabase.from("gameday").delete().eq("season", season)
      .not("week", "in", `(${rows.map((row) => row.week).join(",") || "-1"})`);
    if (deleteError) throw new Error(`Could not clean up GameDay weeks: ${deleteError.message}`);
    if (rows.length) {
      const { error } = await supabase.from("gameday").upsert(rows, { onConflict: "season,week" });
      if (error) throw new Error(`Could not store GameDay weeks: ${error.message}`);
    }
  }
  return {
    gameday_shows: stops.length,
    gameday_seasons: lastStop.size,
    gameday_unmatched_hosts: [...new Set(withTeams.filter((stop) => !stop.host_team_id).map((stop) => stop.host))].length,
    gameday_weeks: weekly.length,
  };
};
