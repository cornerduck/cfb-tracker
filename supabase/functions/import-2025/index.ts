import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const SEASON = 2025;
const HEISMAN_WINNER = { name: "Fernando Mendoza", team: "Indiana" };
const CFBD_BASE_URL = "https://api.collegefootballdata.com";
const GITHUB_OIDC_AUDIENCE = "strdys-supabase-test-import";
const GITHUB_REPOSITORY = "cornerduck/cfb-tracker";
const GITHUB_WORKFLOW_REF =
  "cornerduck/cfb-tracker/.github/workflows/supabase.yml@refs/heads/main";
const GITHUB_JWKS_URL =
  "https://token.actions.githubusercontent.com/.well-known/jwks";
const STAGES = [
  "setup",
  "games",
  "boxscores",
  "rankings",
  "season-stats",
  "awards",
] as const;
type Stage = typeof STAGES[number];
type JsonObject = Record<string, unknown>;
type GithubSigningKey = JsonWebKey & { kid: string };
type CallCounter = { value: number; endpoints: string[] };

let githubKeys: Promise<GithubSigningKey[]> | undefined;

const response = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const asObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`CFBD returned an invalid ${label} record`);
  }
  return value as JsonObject;
};

const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`CFBD ${label} response was not an array`);
  return value;
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`CFBD record is missing ${label}`);
  }
  return value.trim();
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const optionalIdentifier = (value: unknown) =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : null;

const numberValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const integerValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
};

const slugify = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const normalizeName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeConferenceName = (value: string) =>
  normalizeName(value.toLowerCase().replace(/^the\s+/, "").replace(/\s+conference$/, ""));

const decodeBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const decodeJwtPart = (value: string): JsonObject =>
  asObject(JSON.parse(new TextDecoder().decode(decodeBase64Url(value))), "GitHub token");

const getGithubKeys = async (refresh = false) => {
  if (refresh || !githubKeys) {
    githubKeys = fetch(GITHUB_JWKS_URL).then(async (result) => {
      if (!result.ok) {
        throw new Error(`GitHub JWKS request failed with HTTP ${result.status}`);
      }
      const payload = asObject(await result.json(), "GitHub JWKS");
      return asArray(payload.keys, "GitHub JWKS").map((key) => {
        const signingKey = asObject(key, "GitHub signing key");
        if (
          typeof signingKey.kid !== "string" || signingKey.kty !== "RSA" ||
          typeof signingKey.n !== "string" || typeof signingKey.e !== "string"
        ) {
          throw new Error("GitHub signing key is missing required RSA fields");
        }
        return {
          kid: signingKey.kid,
          kty: "RSA",
          n: signingKey.n,
          e: signingKey.e,
        };
      });
    });
  }
  try {
    return await githubKeys;
  } catch (error) {
    githubKeys = undefined;
    throw error;
  }
};

const validateWorkflowToken = async (token: string) => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed GitHub Actions identity token");
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported GitHub token signing algorithm");
  }

  let signingKey = (await getGithubKeys()).find((key) => key.kid === header.kid);
  if (!signingKey) {
    signingKey = (await getGithubKeys(true)).find((key) => key.kid === header.kid);
  }
  if (!signingKey) throw new Error("GitHub token signing key was not found");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    signingKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!isValid) throw new Error("Invalid GitHub token signature");

  const audience = payload.aud;
  const hasAudience = Array.isArray(audience)
    ? audience.includes(GITHUB_OIDC_AUDIENCE)
    : audience === GITHUB_OIDC_AUDIENCE;
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.iss !== "https://token.actions.githubusercontent.com" ||
    !hasAudience || typeof payload.exp !== "number" || payload.exp <= now ||
    (typeof payload.nbf === "number" && payload.nbf > now)
  ) {
    throw new Error("GitHub token issuer, audience, or validity period is invalid");
  }
  if (
    payload.repository !== GITHUB_REPOSITORY ||
    payload.event_name !== "workflow_dispatch" ||
    payload.ref !== "refs/heads/main" ||
    payload.workflow_ref !== GITHUB_WORKFLOW_REF
  ) {
    throw new Error("The GitHub token is not from the authorized manual workflow on main");
  }
};

const fetchCfbd = async (
  path: string,
  apiKey: string,
  calls: CallCounter,
  params: Record<string, string> = {},
) => {
  const url = new URL(path, CFBD_BASE_URL);
  url.searchParams.set("year", String(SEASON));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  calls.value += 1;
  calls.endpoints.push(url.pathname);
  const result = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
  });
  if (!result.ok) throw new Error(`CFBD ${url.pathname} request failed with HTTP ${result.status}`);
  return asArray(await result.json(), url.pathname);
};

const upsert = async (
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: JsonObject[],
  onConflict: string,
) => {
  for (let offset = 0; offset < rows.length; offset += 250) {
    const { error } = await supabase.from(table).upsert(
      rows.slice(offset, offset + 250),
      { onConflict },
    );
    if (error) throw new Error(`Could not import ${table}: ${error.message}`);
  }
  return rows.length;
};

const loadLookups = async (supabase: ReturnType<typeof createClient>) => {
  const [{ data: teams, error: teamsError }, { data: conferences, error: conferencesError }] =
    await Promise.all([
      supabase.from("teams").select("id,school,slug,is_fbs"),
      supabase.from("conferences").select("id,name,short_name,abbreviation"),
    ]);
  if (teamsError) throw new Error(`Could not load teams: ${teamsError.message}`);
  if (conferencesError) {
    throw new Error(`Could not load conferences: ${conferencesError.message}`);
  }
  const teamByName = new Map<string, number>();
  const fbsTeamIds = new Set<number>();
  for (const team of teams ?? []) {
    teamByName.set(normalizeName(team.school), team.id);
    teamByName.set(normalizeName(team.slug.replace(/-/g, " ")), team.id);
    if (team.is_fbs) fbsTeamIds.add(team.id);
  }
  const conferenceByName = new Map<string, number>();
  for (const conference of conferences ?? []) {
    for (const name of [conference.name, conference.short_name, conference.abbreviation]) {
      if (name) conferenceByName.set(normalizeConferenceName(name), conference.id);
    }
  }
  return { teamByName, conferenceByName, fbsTeamIds };
};

const teamIdFor = (value: unknown, lookup: Map<string, number>) => {
  const id = integerValue(value);
  if (id !== null) return id;
  const name = optionalString(value);
  return name ? lookup.get(normalizeName(name)) ?? null : null;
};

const importSetup = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  counts: JsonObject,
) => {
  const [teamData, fbsData, conferenceData, calendarData] = await Promise.all([
    fetchCfbd("/teams", apiKey, calls),
    fetchCfbd("/teams/fbs", apiKey, calls),
    fetchCfbd("/conferences", apiKey, calls),
    fetchCfbd("/calendar", apiKey, calls),
  ]);
  if (!teamData.length || !fbsData.length || !conferenceData.length || !calendarData.length) {
    throw new Error("CFBD returned an empty 2025 teams, conferences, or calendar dataset");
  }
  const { data: existingTeams, error: existingTeamsError } = await supabase.from("teams")
    .select("id,is_fbs");
  if (existingTeamsError) {
    throw new Error(`Could not load existing team classifications: ${existingTeamsError.message}`);
  }
  const fbsIds = new Set([
    ...fbsData.map((value) => integerValue(asObject(value, "FBS team").id))
      .filter((id): id is number => id !== null),
    ...(existingTeams ?? []).filter((team) => team.is_fbs).map((team) => team.id),
  ]);
  const teams = teamData.map((value) => {
    const team = asObject(value, "team");
    const id = integerValue(team.id);
    const school = requiredString(team.school, "school");
    if (id === null) throw new Error(`CFBD team "${school}" is missing id`);
    const location = typeof team.location === "object" && team.location !== null
      ? asObject(team.location, "team location")
      : {};
    return {
      id,
      slug: slugify(school),
      school,
      mascot: optionalString(team.mascot),
      abbreviation: optionalString(team.abbreviation),
      color: optionalString(team.color),
      alt_color: optionalString(team.altColor) ?? optionalString(team.alt_color),
      location,
      venue: optionalString(location.venue),
      capacity: integerValue(location.capacity),
      is_fbs: fbsIds.has(id),
    };
  });
  const fbsConferenceNames = new Set(
    fbsData.map((value) => optionalString(asObject(value, "FBS team").conference))
      .filter((name): name is string => Boolean(name))
      .map(normalizeConferenceName),
  );
  const conferences = conferenceData.flatMap((value) => {
    const conference = asObject(value, "conference");
    const name = requiredString(conference.name, "conference name");
    const classification = optionalString(conference.classification);
    if (
      (classification && classification.toLowerCase() !== "fbs") ||
      (!classification && ![
        name,
        optionalString(conference.shortName),
        optionalString(conference.abbreviation),
      ].filter((value): value is string => value !== null)
        .map(normalizeConferenceName).some((value) => fbsConferenceNames.has(value)))
    ) return [];
    const id = integerValue(conference.id);
    if (id === null) throw new Error(`CFBD conference "${name}" is missing id`);
    const identifiers = [
      name,
      optionalString(conference.shortName),
      optionalString(conference.abbreviation),
    ].filter((identifier): identifier is string => identifier !== null)
      .map((identifier) => identifier.toLowerCase().replace(/^the\s+/, "").replace(/\s+conference$/, ""));
    const powerFour = new Set(["acc", "atlantic coast", "b1g", "big ten", "big 12", "sec", "southeastern"]);
    const groupOfSix = new Set(["aac", "american athletic", "conference usa", "cusa", "mac", "mid-american", "mwc", "mountain west", "pac-12", "sun belt"]);
    const isIndependent = identifiers.some((identifier) => identifier.includes("independent"));
    const divisions = Array.isArray(conference.divisions)
      ? conference.divisions.filter((item): item is string => typeof item === "string")
      : [];
    return [{
      row: {
        id,
        slug: slugify(name),
        name,
        short_name: optionalString(conference.shortName),
        abbreviation: optionalString(conference.abbreviation),
        group_name: isIndependent
          ? "Independent"
          : identifiers.some((identifier) => powerFour.has(identifier))
          ? "Power 4"
          : identifiers.some((identifier) => groupOfSix.has(identifier))
          ? "Group of 6"
          : null,
        classification,
      },
      divisions,
    }];
  });
  const calendar: JsonObject[] = calendarData.map((value) => {
    const week = asObject(value, "calendar");
    if (integerValue(week.season) !== SEASON || integerValue(week.week) === null) {
      throw new Error("CFBD returned a calendar week for an unexpected season");
    }
    return {
      season: SEASON,
      week: integerValue(week.week),
      season_type: requiredString(week.seasonType, "calendar seasonType"),
      start_date: optionalString(week.firstGameStart),
      end_date: optionalString(week.lastGameStart),
    };
  });
  const { error: seasonError } = await supabase.from("seasons").upsert(
    { year: SEASON, status: "live" },
    { onConflict: "year", ignoreDuplicates: true },
  );
  if (seasonError) throw new Error(`Could not create the 2025 season: ${seasonError.message}`);
  counts.teams = await upsert(supabase, "teams", teams, "id");
  counts.conferences = await upsert(
    supabase,
    "conferences",
    conferences.map(({ row }) => row),
    "id",
  );
  counts.conference_seasons = await upsert(
    supabase,
    "conference_seasons",
    conferences.map(({ row, divisions }) => ({
      season: SEASON,
      conference_id: row.id,
      divisions,
    })),
    "season,conference_id",
  );
  counts.calendar = await upsert(
    supabase,
    "calendar",
    calendar,
    "season,week,season_type",
  );
  const lookups = await loadLookups(supabase);
  const { data: existingSeasonRows, error: existingSeasonError } = await supabase
    .from("team_seasons")
    .select("team_id,wins,losses,ties,final_ranking,postseason_result")
    .eq("season", SEASON);
  if (existingSeasonError) {
    throw new Error(`Could not load existing 2025 team seasons: ${existingSeasonError.message}`);
  }
  const existingByTeam = new Map(
    (existingSeasonRows ?? []).map((row) => [row.team_id, row]),
  );
  const teamSeasons = teamData.flatMap((value) => {
    const team = asObject(value, "team");
    const id = integerValue(team.id);
    if (id === null) return [];
    const existing = existingByTeam.get(id);
    const conferenceName = optionalString(team.conference);
    return [{
      season: SEASON,
      team_id: id,
      conference_id: conferenceName
        ? lookups.conferenceByName.get(normalizeConferenceName(conferenceName)) ?? null
        : null,
      division: optionalString(team.division),
      wins: existing?.wins ?? 0,
      losses: existing?.losses ?? 0,
      ties: existing?.ties ?? 0,
      final_ranking: existing?.final_ranking ?? null,
      postseason_result: existing?.postseason_result ?? null,
    }];
  });
  counts.team_seasons = await upsert(
    supabase,
    "team_seasons",
    teamSeasons,
    "season,team_id",
  );
};

const mapGame = (value: unknown, teamByName: Map<string, number>) => {
  const game = asObject(value, "game");
  const homeId = integerValue(game.homeId) ?? teamIdFor(game.homeTeam, teamByName);
  const awayId = integerValue(game.awayId) ?? teamIdFor(game.awayTeam, teamByName);
  if (homeId === null || awayId === null || homeId === awayId) return null;
  const id = integerValue(game.id);
  if (id === null) throw new Error("CFBD game record is missing id");
  const notes = optionalString(game.notes) ?? "";
  const titleGame = /national championship|cfp championship/i.test(notes);
  const cfpRound = /national championship/i.test(notes)
    ? "National Championship"
    : /semifinal/i.test(notes)
    ? "Semifinal"
    : /quarterfinal/i.test(notes)
    ? "Quarterfinal"
    : /first round/i.test(notes)
    ? "First Round"
    : null;
  const seasonType = optionalString(game.seasonType) ?? "regular";
  return {
    id,
    season: SEASON,
    week: integerValue(game.week),
    season_type: seasonType,
    away_team_id: awayId,
    home_team_id: homeId,
    neutral_site: game.neutralSite === true,
    away_points: integerValue(game.awayPoints),
    home_points: integerValue(game.homePoints),
    away_line_scores: Array.isArray(game.awayLineScores) ? game.awayLineScores : null,
    home_line_scores: Array.isArray(game.homeLineScores) ? game.homeLineScores : null,
    start_time: optionalString(game.startDate),
    tv: optionalString(game.tv),
    venue: optionalString(game.venue),
    away_postgame_rank: integerValue(game.awayPostgameRank),
    home_postgame_rank: integerValue(game.homePostgameRank),
    conference_game: typeof game.conferenceGame === "boolean" ? game.conferenceGame : null,
    status: game.completed === true ? "final" : optionalString(game.status) ?? "scheduled",
    is_title_game: titleGame,
    bowl_name: seasonType.toLowerCase() === "regular" ? null : optionalString(game.notes),
    cfp_round: cfpRound,
  };
};

const importGames = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  counts: JsonObject,
) => {
  const { teamByName, fbsTeamIds } = await loadLookups(supabase);
  const [gameData, lineData] = await Promise.all([
    fetchCfbd("/games", apiKey, calls),
    fetchCfbd("/lines", apiKey, calls),
  ]);
  const games = gameData.map((game) => mapGame(game, teamByName))
    .filter((game): game is NonNullable<typeof game> =>
      game !== null &&
      (fbsTeamIds.has(game.home_team_id) || fbsTeamIds.has(game.away_team_id))
    );
  if (games.length === 0) throw new Error("CFBD returned no 2025 games with an FBS team");
  counts.games = await upsert(supabase, "games", games, "id");
  const gameIds = new Set(games.map((game) => game.id));
  const lines = lineData.flatMap((value) => {
    const item = asObject(value, "line");
    const gameId = integerValue(item.id);
    if (gameId === null || !gameIds.has(gameId)) return [];
    const providerSpreads: Record<string, number> = {};
    const spreads: number[] = [];
    let overUnder: number | null = null;
    for (const rawLine of Array.isArray(item.lines) ? item.lines : []) {
      const line = asObject(rawLine, "provider line");
      const provider = optionalString(line.provider);
      const spread = numberValue(line.spread);
      if (provider && spread !== null) {
        providerSpreads[provider] = spread;
        if (!/consensus/i.test(provider)) spreads.push(spread);
      }
      overUnder ??= numberValue(line.overUnder);
    }
    const consensus = Object.entries(providerSpreads)
      .find(([provider]) => /consensus/i.test(provider))?.[1] ??
      (spreads.length ? spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length : null);
    return [{
      game_id: gameId,
      provider_spreads: providerSpreads,
      consensus_spread: consensus,
      over_under: overUnder,
    }];
  });
  counts.lines = await upsert(supabase, "lines", lines, "game_id");
  const records = new Map<number, { wins: number; losses: number; ties: number }>();
  for (const game of games) {
    if (game.home_points === null || game.away_points === null) continue;
    for (const [teamId, points, opponentPoints] of [
      [game.home_team_id, game.home_points, game.away_points],
      [game.away_team_id, game.away_points, game.home_points],
    ] as const) {
      const record = records.get(teamId) ?? { wins: 0, losses: 0, ties: 0 };
      if (points > opponentPoints) record.wins += 1;
      else if (points < opponentPoints) record.losses += 1;
      else record.ties += 1;
      records.set(teamId, record);
    }
  }
  const { data: existingTeamSeasons, error: teamSeasonReadError } = await supabase
    .from("team_seasons")
    .select("season,team_id,conference_id,division,wins,losses,ties,final_ranking,postseason_result")
    .eq("season", SEASON);
  if (teamSeasonReadError) {
    throw new Error(`Could not load 2025 team seasons: ${teamSeasonReadError.message}`);
  }
  counts.team_seasons = await upsert(
    supabase,
    "team_seasons",
    (existingTeamSeasons ?? []).map((row) => ({
      ...row,
      ...(records.get(row.team_id) ?? { wins: 0, losses: 0, ties: 0 }),
    })),
    "season,team_id",
  );
};

const importBoxscores = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  counts: JsonObject,
) => {
  const [{ data: games, error: gamesError }, { data: teams, error: teamsError }] =
    await Promise.all([
      supabase.from("games").select("id").eq("season", SEASON),
      supabase.from("teams").select("id,school"),
    ]);
  if (gamesError) throw new Error(`Could not load 2025 games: ${gamesError.message}`);
  if (teamsError) throw new Error(`Could not load teams: ${teamsError.message}`);
  const gameIds = new Set((games ?? []).map((game) => game.id));
  const teamByName = new Map<string, number>();
  for (const team of teams ?? []) teamByName.set(normalizeName(team.school), team.id);
  const { data: calendar, error: calendarError } = await supabase.from("calendar")
    .select("week,season_type")
    .eq("season", SEASON);
  if (calendarError) throw new Error(`Could not load the 2025 calendar: ${calendarError.message}`);
  const periodByKey = new Map<string, { week: string; seasonType: string }>();
  for (const period of calendar ?? []) {
    if (
      (period.season_type === "regular" || period.season_type === "postseason") &&
      typeof period.week === "number"
    ) {
      periodByKey.set(`${period.season_type}:${period.week}`, {
        week: String(period.week),
        seasonType: period.season_type,
      });
    }
  }
  const periods = [...periodByKey.values()];
  if (!periods.length) throw new Error("The 2025 calendar has no regular or postseason weeks");

  const teamData: unknown[] = [];
  const playerData: unknown[] = [];
  for (const period of periods) {
    teamData.push(...await fetchCfbd("/games/teams", apiKey, calls, period));
    playerData.push(...await fetchCfbd("/games/players", apiKey, calls, period));
  }
  const teamStats = new Map<string, JsonObject>();
  for (const value of teamData) {
    const game = asObject(value, "team game statistics");
    const gameId = integerValue(game.id);
    if (gameId === null || !gameIds.has(gameId)) continue;
    const sides = Array.isArray(game.teams) ? game.teams : [];
    for (const rawSide of sides) {
      const side = asObject(rawSide, "team game statistics");
      const teamId = teamIdFor(side.teamId ?? side.team_id ?? side.team, teamByName);
      if (teamId === null) continue;
      const key = `${gameId}:${teamId}`;
      const row = teamStats.get(key) ??
        { game_id: gameId, team_id: teamId, stats: {} };
      for (const rawStat of Array.isArray(side.stats) ? side.stats : []) {
        const stat = asObject(rawStat, "team game statistic");
        const category = optionalString(stat.category);
        const name = optionalString(stat.stat);
        if (category && name) {
          (row.stats as JsonObject)[`${category}_${name}`] = stat.stat;
        }
      }
      teamStats.set(key, row);
    }
  }
  counts.game_team_stats = await upsert(
    supabase,
    "game_team_stats",
    [...teamStats.values()],
    "game_id,team_id",
  );

  const playerStats = new Map<string, JsonObject>();
  for (const value of playerData) {
    const game = asObject(value, "player game statistics");
    const gameId = integerValue(game.id);
    if (gameId === null || !gameIds.has(gameId)) continue;
    for (const rawSide of Array.isArray(game.teams) ? game.teams : []) {
      const side = asObject(rawSide, "player game team statistics");
      const teamId = teamIdFor(side.teamId ?? side.team_id ?? side.team, teamByName);
      if (teamId === null) continue;
      for (const rawCategory of Array.isArray(side.categories) ? side.categories : []) {
        const categoryRecord = asObject(rawCategory, "player game category");
        const category = optionalString(categoryRecord.name);
        if (!category) continue;
        for (const rawType of Array.isArray(categoryRecord.types) ? categoryRecord.types : []) {
          const type = asObject(rawType, "player game statistic type");
          const stat = optionalString(type.name);
          if (!stat) continue;
          for (const rawAthlete of Array.isArray(type.athletes) ? type.athletes : []) {
            const athlete = asObject(rawAthlete, "player game statistic");
            const playerName = optionalString(athlete.name);
            if (!playerName) continue;
            const playerId = optionalIdentifier(athlete.id) ??
              `${teamId}:${slugify(playerName)}`;
            const key = `${gameId}:${playerId}:${teamId}:${category}`;
            const row = playerStats.get(key) ?? {
              game_id: gameId,
              player_id: playerId,
              player_name: playerName,
              team_id: teamId,
              category,
              stats: {},
            };
            (row.stats as JsonObject)[stat] = athlete.stat ?? null;
            playerStats.set(key, row);
          }
        }
      }
    }
  }
  if (teamStats.size === 0 || playerStats.size === 0) {
    throw new Error(
      `CFBD returned no usable 2025 box scores (team rows: ${teamStats.size}, player rows: ${playerStats.size})`,
    );
  }
  counts.game_player_stats = await upsert(
    supabase,
    "game_player_stats",
    [...playerStats.values()],
    "game_id,player_id,team_id,category",
  );
};

const importRankings = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  counts: JsonObject,
) => {
  const { teamByName } = await loadLookups(supabase);
  const rankings = await fetchCfbd("/rankings", apiKey, calls);
  const pollsByTeam = new Map<string, JsonObject>();
  const latestApRank = new Map<number, { week: number; rank: number }>();
  for (const value of rankings) {
    const item = asObject(value, "ranking week");
    const week = integerValue(item.week);
    if (week === null) continue;
    for (const rawPoll of Array.isArray(item.polls) ? item.polls : []) {
      const poll = asObject(rawPoll, "poll");
      const pollName = optionalString(poll.poll);
      const source = /ap/i.test(pollName ?? "")
        ? "AP"
        : /coaches/i.test(pollName ?? "")
        ? "Coaches"
        : /cfp|selection committee|college football playoff/i.test(pollName ?? "")
        ? "CFP"
        : null;
      if (!source) continue;
      for (const rawRank of Array.isArray(poll.ranks) ? poll.ranks : []) {
        const rank = asObject(rawRank, "poll rank");
        const teamId = teamIdFor(rank.teamId ?? rank.school, teamByName);
        const place = integerValue(rank.rank);
        if (teamId === null || place === null) continue;
        pollsByTeam.set(`${week}:${source}:${teamId}`, {
          season: SEASON,
          week,
          source,
          rank: place,
          team_id: teamId,
          points: integerValue(rank.points),
          first_place_votes: integerValue(rank.firstPlaceVotes),
        });
        if (source === "AP") {
          const current = latestApRank.get(teamId);
          if (!current || week > current.week) latestApRank.set(teamId, { week, rank: place });
        }
      }
    }
  }
  const polls = [...pollsByTeam.values()];
  if (!polls.length) throw new Error("CFBD returned no usable 2025 AP, Coaches, or CFP rankings");
  counts.polls = await upsert(
    supabase,
    "polls",
    polls,
    "season,week,source,team_id",
  );
  for (const [teamId, value] of latestApRank) {
    const { error } = await supabase.from("team_seasons")
      .update({ final_ranking: value.rank })
      .eq("season", SEASON)
      .eq("team_id", teamId);
    if (error) throw new Error(`Could not update final team ranking: ${error.message}`);
  }
};

const importSeasonStats = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  counts: JsonObject,
) => {
  const { teamByName } = await loadLookups(supabase);
  const [playerData, teamData] = await Promise.all([
    fetchCfbd("/stats/player/season", apiKey, calls),
    fetchCfbd("/stats/season", apiKey, calls),
  ]);
  const playerStats = new Map<string, JsonObject>();
  for (const value of playerData) {
    const item = asObject(value, "player season statistic");
    const playerId = optionalIdentifier(item.playerId) ?? optionalIdentifier(item.athleteId);
    const playerName = optionalString(item.player) ?? optionalString(item.playerName) ??
      optionalString(item.athlete);
    const category = optionalString(item.category);
    const stat = optionalString(item.statName) ?? optionalString(item.stat);
    if (!playerId || !playerName || !category || !stat) continue;
    const key = `${playerId}:${category}`;
    const row = playerStats.get(key) ?? {
      season: SEASON,
      player_id: playerId,
      player_name: playerName,
      team_id: teamIdFor(item.teamId ?? item.team, teamByName),
      category,
      stats: {},
    };
    (row.stats as JsonObject)[stat] = item.statValue ?? item.value ?? null;
    playerStats.set(key, row);
  }
  counts.player_season_stats = await upsert(
    supabase,
    "player_season_stats",
    [...playerStats.values()],
    "season,player_id,category",
  );
  const teamStats = new Map<number, JsonObject>();
  for (const value of teamData) {
    const item = asObject(value, "team season statistic");
    const teamId = teamIdFor(item.teamId ?? item.team, teamByName);
    const stat = optionalString(item.statName) ?? optionalString(item.stat);
    if (teamId === null || !stat) continue;
    const row = teamStats.get(teamId) ?? {
      season: SEASON,
      team_id: teamId,
      category: "season",
      stats: {},
      national_ranks: {},
    };
    (row.stats as JsonObject)[stat] = item.statValue ?? item.value ?? null;
    const rank = integerValue(item.ranking ?? item.rank);
    if (rank !== null) (row.national_ranks as JsonObject)[stat] = rank;
    teamStats.set(teamId, row);
  }
  counts.team_season_stats = await upsert(
    supabase,
    "team_season_stats",
    [...teamStats.values()],
    "season,team_id,category",
  );
};

const statsObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};

const loadAllPlayerGameStats = async (
  supabase: ReturnType<typeof createClient>,
  gameIds: number[],
) => {
  const rows: Array<{
    game_id: number;
    player_id: string;
    player_name: string;
    team_id: number;
    category: string;
    stats: unknown;
  }> = [];
  for (let idOffset = 0; idOffset < gameIds.length; idOffset += 100) {
    const gameBatch = gameIds.slice(idOffset, idOffset + 100);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("game_player_stats")
        .select("game_id,player_id,player_name,team_id,category,stats")
        .in("game_id", gameBatch)
        .order("game_id")
        .order("player_id")
        .order("team_id")
        .order("category")
        .range(offset, offset + 999);
      if (error) throw new Error(`Could not load player box scores: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  return rows;
};

const loadLinesForGames = async (
  supabase: ReturnType<typeof createClient>,
  gameIds: number[],
) => {
  const rows: Array<{ game_id: number; consensus_spread: number | null }> = [];
  for (let offset = 0; offset < gameIds.length; offset += 100) {
    const { data, error } = await supabase.from("lines")
      .select("game_id,consensus_spread")
      .in("game_id", gameIds.slice(offset, offset + 100));
    if (error) throw new Error(`Could not load closing lines: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
};

const metric = (stats: JsonObject, names: string[]) => {
  for (const [key, value] of Object.entries(stats)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (names.includes(normalized)) {
      return numberValue(value) ?? 0;
    }
    if (
      names.includes("attempts") &&
      (normalized === "catt" || normalized === "completionsattempts") &&
      typeof value === "string" && value.includes("/")
    ) {
      return numberValue(value.split("/").at(-1)) ?? 0;
    }
  }
  return 0;
};

const importHeismanHistory = async (
  supabase: ReturnType<typeof createClient>,
  games: Array<{
    id: number;
    week: number | null;
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
  }>,
  playerRows: Array<{
    game_id: number;
    player_id: string;
    player_name: string;
    team_id: number;
    category: string;
    stats: unknown;
  }>,
  counts: JsonObject,
) => {
  const completedGames = games.filter((game) =>
    game.week !== null && game.home_points !== null && game.away_points !== null
  );
  const weeks = [...new Set(completedGames.map((game) => game.week)
    .filter((week): week is number => week !== null))]
    .sort((a, b) => a - b);
  if (!weeks.length) throw new Error("No completed 2025 games are available for Heisman history");
  const { data: polls, error: pollsError } = await supabase.from("polls")
    .select("week,rank,team_id")
    .eq("season", SEASON)
    .eq("source", "AP");
  if (pollsError) throw new Error(`Could not load AP polls for Heisman history: ${pollsError.message}`);
  const gameById = new Map(completedGames.map((game) => [game.id, game]));
  const pollRows = polls ?? [];
  const finalCandidates = new Map<string, JsonObject>();
  const weeklyRows: JsonObject[] = [];
  for (const week of weeks) {
    const winsByTeam = new Map<number, { wins: number; games: number }>();
    for (const game of completedGames.filter((item) => (item.week ?? 0) <= week)) {
      for (const teamId of [game.home_team_id, game.away_team_id]) {
        const record = winsByTeam.get(teamId) ?? { wins: 0, games: 0 };
        record.games += 1;
        if (
          (teamId === game.home_team_id && game.home_points! > game.away_points!) ||
          (teamId === game.away_team_id && game.away_points! > game.home_points!)
        ) record.wins += 1;
        winsByTeam.set(teamId, record);
      }
    }
    const cumulative = playerRows.filter((row) => {
      const game = gameById.get(row.game_id);
      return game !== undefined && (game.week ?? Number.MAX_SAFE_INTEGER) <= week;
    });
    const grouped = new Map<string, {
      player_id: string;
      player_name: string;
      team_id: number;
      passing: JsonObject;
      rushing: JsonObject;
      receiving: JsonObject;
    }>();
    for (const row of cumulative) {
      const key = row.player_id;
      const candidate = grouped.get(key) ?? {
        player_id: row.player_id,
        player_name: row.player_name,
        team_id: row.team_id,
        passing: {},
        rushing: {},
        receiving: {},
      };
      const category = row.category.toLowerCase();
      const bucket = category.includes("pass")
        ? candidate.passing
        : category.includes("rush")
        ? candidate.rushing
        : category.includes("receiv")
        ? candidate.receiving
        : null;
      if (bucket) {
        for (const [stat, value] of Object.entries(statsObject(row.stats))) {
          const normalizedStat = stat.toLowerCase().replace(/[^a-z0-9]/g, "");
          const numericValue = numberValue(value) ??
            (normalizedStat === "catt" && typeof value === "string" && value.includes("/")
              ? numberValue(value.split("/").at(-1))
              : null);
          bucket[stat] = (numberValue(bucket[stat]) ?? 0) + (numericValue ?? 0);
        }
      }
      grouped.set(key, candidate);
    }
    const candidates = [...grouped.values()].map((player) => {
      const passYards = metric(player.passing, ["yards", "yds", "passingyards"]);
      const passAttempts = metric(player.passing, ["attempts", "att", "passingattempts"]);
      const passTd = metric(player.passing, ["td", "touchdowns", "passingtouchdowns"]);
      const interceptions = metric(player.passing, ["int", "interceptions"]);
      const rushYards = metric(player.rushing, ["yards", "yds", "rushingyards"]);
      const rushAttempts = metric(player.rushing, ["attempts", "att", "carries"]);
      const rushTd = metric(player.rushing, ["td", "touchdowns", "rushingtouchdowns"]);
      const receiveYards = metric(player.receiving, ["yards", "yds", "receivingyards"]);
      const receptions = metric(player.receiving, ["receptions", "rec", "catches"]);
      const receiveTd = metric(player.receiving, ["td", "touchdowns", "receivingtouchdowns"]);
      const isQuarterback = passAttempts > 0;
      const isReceiver = !isQuarterback && receiveYards + receptions > rushYards;
      const yards = isQuarterback
        ? passYards
        : isReceiver
        ? receiveYards
        : rushYards;
      const touchdowns = isQuarterback ? passTd : isReceiver ? receiveTd : rushTd;
      const attempts = isQuarterback ? passAttempts : isReceiver ? receptions : rushAttempts;
      const turnovers = interceptions +
        metric(player.rushing, ["fum", "fumbles", "lostfum", "lostfumbles"]);
      const poll = pollRows.filter((row) =>
        row.team_id === player.team_id && row.week <= week
      ).sort((a, b) => b.week - a.week)[0];
      const record = winsByTeam.get(player.team_id) ?? { wins: 0, games: 0 };
      const teamSuccess = Math.min(
        1,
        (record.games ? record.wins / record.games : 0) * 0.8 +
          (poll ? Math.max(0, 26 - poll.rank) / 25 : 0) * 0.2,
      );
      return {
        ...player,
        position: isQuarterback ? "QB" : isReceiver ? "WR" : "RB",
        yards,
        touchdowns,
        efficiency: attempts ? yards / attempts : 0,
        turnovers,
        teamSuccess,
      };
    }).filter((candidate) =>
      candidate.yards > 0 || candidate.touchdowns > 0
    );
    if (!candidates.length) continue;
    const percentile = (value: number, values: number[], reverse = false) => {
      const sorted = [...values].sort((a, b) => reverse ? a - b : b - a);
      const index = sorted.findIndex((entry) => entry === value);
      return sorted.length <= 1 ? 1 : 1 - index / (sorted.length - 1);
    };
    const scored = candidates.map((candidate) => {
      const samePosition = candidates.filter((item) => item.position === candidate.position);
      const production = (
        percentile(candidate.yards, samePosition.map((item) => item.yards)) +
        percentile(candidate.touchdowns, samePosition.map((item) => item.touchdowns)) +
        percentile(candidate.efficiency, samePosition.map((item) => item.efficiency)) +
        percentile(candidate.turnovers, samePosition.map((item) => item.turnovers), true)
      ) / 4;
      return {
        ...candidate,
        score: Number((0.7 * production + 0.3 * candidate.teamSuccess).toFixed(6)),
      };
    }).sort((a, b) =>
      b.score - a.score || b.yards - a.yards || a.player_name.localeCompare(b.player_name)
    );
    const topTen = scored.slice(0, 10);
    topTen.forEach((player, index) => weeklyRows.push({
      season: SEASON,
      week,
      player_id: player.player_id,
      player_name: player.player_name,
      team_id: player.team_id,
      score: player.score,
      rank: index + 1,
    }));
    for (const [index, player] of scored.entries()) {
      finalCandidates.set(player.player_id, {
        season: SEASON,
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        score: player.score,
        rank: index + 1,
      });
    }
  }
  if (!weeklyRows.length) throw new Error("Could not derive weekly 2025 Heisman tracker rankings");
  counts.heisman_weekly = await upsert(
    supabase,
    "heisman_weekly",
    weeklyRows,
    "season,week,player_id",
  );
  const finalRows = [...finalCandidates.values()];
  counts.heisman_tracker = await upsert(
    supabase,
    "heisman_tracker",
    finalRows,
    "season,player_id",
  );
  return finalRows.sort((a, b) =>
    (numberValue(a.rank) ?? 0) - (numberValue(b.rank) ?? 0)
  );
};

const importAwardsAndArchive = async (
  supabase: ReturnType<typeof createClient>,
  counts: JsonObject,
) => {
  const { teamByName } = await loadLookups(supabase);
  const winnerName = HEISMAN_WINNER.name;
  const { data: games, error: gamesError } = await supabase.from("games").select(
    "id,week,season_type,home_team_id,away_team_id,home_points,away_points",
  ).eq("season", SEASON).not("home_points", "is", null).not("away_points", "is", null);
  if (gamesError) throw new Error(`Could not load games for awards: ${gamesError.message}`);
  const importedGames = (games ?? []) as Array<{
    id: number;
    week: number | null;
    home_team_id: number;
    away_team_id: number;
    home_points: number;
    away_points: number;
  }>;
  const lines = await loadLinesForGames(
    supabase,
    importedGames.map((game) => game.id),
  );
  const players = await loadAllPlayerGameStats(
    supabase,
    importedGames.map((game) => game.id),
  );
  const importedPlayers = players;
  const finalTracker = await importHeismanHistory(
    supabase,
    importedGames,
    importedPlayers,
    counts,
  );
  const winnerCandidate = finalTracker.find((player) =>
    normalizeName(String(player.player_name)) === normalizeName(winnerName)
  );
  const winnerPlayerId = String(
    winnerCandidate?.player_id ?? `heisman-${slugify(winnerName)}`,
  );
  if (!winnerCandidate) {
    const winnerTeamId = teamIdFor(HEISMAN_WINNER.team, teamByName);
    finalTracker.push({
      season: SEASON,
      player_id: winnerPlayerId,
      player_name: winnerName,
      team_id: winnerTeamId,
      score: 0,
      rank: finalTracker.length + 1,
    });
    const { error: trackerError } = await supabase.from("heisman_tracker").upsert(
      {
        season: SEASON,
        player_id: winnerPlayerId,
        player_name: winnerName,
        team_id: winnerTeamId,
        score: 0,
        rank: finalTracker.length,
      },
      { onConflict: "season,player_id" },
    );
    if (trackerError) throw new Error(`Could not record Heisman winner: ${trackerError.message}`);
  }
  const lineByGame = new Map(lines.map((line) => [line.game_id, line.consensus_spread]));
  const playerRowsByGame = new Map<number, typeof players>();
  for (const player of players) {
    const rows = playerRowsByGame.get(player.game_id) ?? [];
    rows.push(player);
    playerRowsByGame.set(player.game_id, rows);
  }
  const weeklyAwards: JsonObject[] = [];
  for (const week of new Set(importedGames.map((game) => game.week).filter(
    (number): number is number => typeof number === "number",
  ))) {
    const weekGames = importedGames.filter((game) => game.week === week);
    if (!weekGames.length) continue;
    const withResults = weekGames.map((game) => ({
      ...game,
      margin: Math.abs(game.home_points - game.away_points),
    }));
    const ranked = withResults.filter((game) => {
      const spread = numberValue(lineByGame.get(game.id));
      return spread !== null && game.home_points !== game.away_points &&
        ((spread > 0 && game.away_points > game.home_points) ||
          (spread < 0 && game.home_points > game.away_points));
    }).sort((a, b) =>
      Math.abs(numberValue(lineByGame.get(b.id)) ?? 0) -
      Math.abs(numberValue(lineByGame.get(a.id)) ?? 0)
    );
    const closest = [...withResults].sort((a, b) => a.margin - b.margin)[0];
    const blowout = [...withResults].sort((a, b) => b.margin - a.margin)[0];
    if (ranked[0]) weeklyAwards.push({
      season: SEASON,
      week,
      award_type: "upset",
      game_id: ranked[0].id,
      details: { consensus_spread: lineByGame.get(ranked[0].id) },
    });
    if (closest) weeklyAwards.push({
      season: SEASON,
      week,
      award_type: "game",
      game_id: closest.id,
      details: { margin: closest.margin },
    });
    if (blowout) weeklyAwards.push({
      season: SEASON,
      week,
      award_type: "blowout",
      game_id: blowout.id,
      details: { margin: blowout.margin },
    });
    let performance: { row: (typeof importedPlayers)[number]; score: number } | null = null;
    for (const game of weekGames) {
      for (const row of playerRowsByGame.get(game.id) ?? []) {
        const stats = statsObject(row.stats);
        const category = row.category.toLowerCase();
        const yards = metric(stats, ["yards", "yds"]);
        const touchdowns = metric(stats, ["touchdowns", "td"]);
        const interceptions = metric(stats, ["interceptions", "int"]);
        const attempts = metric(stats, ["attempts", "att"]);
        const score = /pass/.test(category)
          ? yards / 25 + touchdowns * 4 - interceptions * 2 +
            metric(stats, ["rushingyards", "rushyds"]) / 10
          : yards / 10 + touchdowns * 6 + attempts * 0.1;
        if (!performance || score > performance.score) performance = { row, score };
      }
    }
    if (performance && performance.score > 0) weeklyAwards.push({
      season: SEASON,
      week,
      award_type: "performance",
      game_id: performance.row.game_id,
      player_id: performance.row.player_id,
      details: {
        player_name: performance.row.player_name,
        team_id: performance.row.team_id,
        score: Number(performance.score.toFixed(2)),
        formula: "passing_yards/25 + passing_TD*4 - interceptions*2; other_yards/10 + TD*6 + attempts*0.1",
      },
    });
  }
  counts.weekly_awards = await upsert(
    supabase,
    "weekly_awards",
    weeklyAwards,
    "season,week,award_type",
  );
  const { data: championship, error: titleGameError } = await supabase.from("games")
    .select("id,home_team_id,away_team_id,home_points,away_points")
    .eq("season", SEASON)
    .eq("is_title_game", true)
    .limit(1)
    .maybeSingle();
  if (titleGameError) throw new Error(`Could not find 2025 title game: ${titleGameError.message}`);
  if (!championship || championship.home_points === null || championship.away_points === null) {
    throw new Error("CFBD did not provide a completed 2025 national championship game");
  }
  const championId = championship.home_points > championship.away_points
    ? championship.home_team_id
    : championship.away_team_id;
  const { error: teamError } = await supabase.from("team_seasons")
    .update({ postseason_result: "National Champion" })
    .eq("season", SEASON)
    .eq("team_id", championId);
  if (teamError) throw new Error(`Could not record 2025 champion: ${teamError.message}`);
  const finalistNames = finalTracker.slice(0, 5).map((player) => player.player_name);
  if (!finalistNames.some((name) => normalizeName(String(name)) === normalizeName(winnerName))) {
    finalistNames.push(winnerName);
  }
  const { error: seasonError } = await supabase.from("seasons").update({
    status: "archived",
    champion_team_id: championId,
    title_game_id: championship.id,
    heisman_winner: winnerName,
    heisman_finalists: finalistNames,
  }).eq("year", SEASON);
  if (seasonError) throw new Error(`Could not archive the 2025 season: ${seasonError.message}`);
  counts.champion_team_id = championId;
  counts.heisman_winner = winnerName;
  counts.heisman_finalists = finalistNames.length;
  counts.cfbd_award_records = awards.length;
};

const runStage = async (
  stage: Stage,
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
) => {
  const prerequisites = STAGES.slice(0, STAGES.indexOf(stage));
  if (prerequisites.length) {
    const prerequisiteJobs = prerequisites.map((name) => `import-2025-${name}`);
    const { data, error } = await supabase.from("update_log")
      .select("job")
      .in("job", prerequisiteJobs)
      .eq("status", "success");
    if (error) throw new Error(`Could not verify earlier import stages: ${error.message}`);
    const completed = new Set((data ?? []).map((entry) => entry.job));
    const missing = prerequisiteJobs.filter((job) => !completed.has(job));
    if (missing.length) {
      throw new Error(`Run these successful stages first: ${missing.join(", ")}`);
    }
  }
  const counts: JsonObject = {};
  switch (stage) {
    case "setup":
      await importSetup(supabase, apiKey, calls, counts);
      break;
    case "games":
      await importGames(supabase, apiKey, calls, counts);
      break;
    case "boxscores":
      await importBoxscores(supabase, apiKey, calls, counts);
      break;
    case "rankings":
      await importRankings(supabase, apiKey, calls, counts);
      break;
    case "season-stats":
      await importSeasonStats(supabase, apiKey, calls, counts);
      break;
    case "awards":
      await importAwardsAndArchive(supabase, counts);
      break;
  }
  return counts;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const githubToken = request.headers.get("x-github-oidc-token");
  if (!githubToken) return response({ error: "Missing GitHub Actions identity token" }, 401);
  try {
    await validateWorkflowToken(githubToken);
  } catch {
    return response({ error: "GitHub Actions identity could not be verified" }, 401);
  }
  const apiKey = Deno.env.get("CFBD_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    return response({ error: "Required Edge Function configuration is missing" }, 500);
  }

  let stage: Stage;
  try {
    const body = asObject(await request.json(), "request");
    const requestedStage = body.stage;
    if (typeof requestedStage !== "string" || !STAGES.includes(requestedStage as Stage)) {
      return response({ error: `stage must be one of: ${STAGES.join(", ")}` }, 400);
    }
    stage = requestedStage as Stage;
  } catch (error) {
    return response({
      error: error instanceof SyntaxError
        ? "Request body must be valid JSON"
        : error instanceof Error
        ? error.message
        : "Invalid request body",
    }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let logId: number | null = null;
  const calls: CallCounter = { value: 0, endpoints: [] };
  const { data: log, error: logError } = await supabase.from("update_log")
    .insert({ job: `import-2025-${stage}`, trigger: "manual", status: "running" })
    .select("id")
    .single();
  if (logError) return response({ error: `Could not start update log: ${logError.message}` }, 500);
  logId = log.id;

  try {
    const details = await runStage(stage, supabase, apiKey, calls);
    const { error } = await supabase.from("update_log").update({
      status: "success",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      details: { stage, api_endpoints: calls.endpoints, ...details },
    }).eq("id", logId);
    if (error) throw new Error(`Could not finish update log: ${error.message}`);
    return response({
      status: "success",
      season: SEASON,
      stage,
      api_calls_used: calls.value,
      api_endpoints: calls.endpoints,
      ...details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected 2025 import failure";
    const { error: updateError } = await supabase.from("update_log").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      error: message,
      details: { stage, api_endpoints: calls.endpoints },
    }).eq("id", logId);
    if (updateError) console.error("Could not record failed import:", updateError.message);
    console.error(`2025 import ${stage} failed:`, message);
    return response({
      status: "failed",
      stage,
      error: message,
      api_calls_used: calls.value,
      api_endpoints: calls.endpoints,
    }, 500);
  }
});
