// Pure mapping helpers that turn CollegeFootballData API v2 responses into
// STRDYS database rows. Nothing in this file talks to the network or the
// database, so the same rules apply to the 2025 import and the 2026 updater.

export type JsonObject = Record<string, unknown>;
export type CallCounter = { value: number; endpoints: string[] };

export const CFBD_BASE_URL = "https://api.collegefootballdata.com";

export const asObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`CFBD returned an invalid ${label} record`);
  }
  return value as JsonObject;
};

export const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`CFBD ${label} response was not an array`);
  }
  return value;
};

export const jsonObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};

export const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export const numberValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const integerValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
};

export const identifier = (value: unknown) =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : null;

export const slugify = (value: string) =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const normalizeName = (value: string) =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export const teamIdFor = (value: unknown, idByName: Map<string, number>) => {
  const id = integerValue(value);
  if (id !== null) return id;
  const name = optionalString(value);
  return name ? idByName.get(normalizeName(name)) ?? null : null;
};

export const fetchCfbd = async (
  path: string,
  apiKey: string,
  calls: CallCounter,
  params: Record<string, string> = {},
  options: { year?: number | null } = {},
) => {
  const url = new URL(path, CFBD_BASE_URL);
  if (options.year !== null && options.year !== undefined) {
    url.searchParams.set("year", String(options.year));
  }
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  calls.value += 1;
  calls.endpoints.push(`${url.pathname}${url.search}`);
  const result = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
  });
  if (!result.ok) {
    const error = new Error(
      `CFBD ${url.pathname} request failed with HTTP ${result.status}`,
    ) as Error & { status?: number };
    error.status = result.status;
    throw error;
  }
  return asArray(await result.json(), url.pathname);
};

// ---------------------------------------------------------------- teams

export const mapTeam = (value: unknown, isFbs: boolean) => {
  const team = asObject(value, "team");
  const id = integerValue(team.id);
  const school = optionalString(team.school);
  if (id === null || !school) throw new Error("CFBD team record is missing id or school");
  const location = jsonObject(team.location);
  return {
    id,
    slug: slugify(school),
    school,
    mascot: optionalString(team.mascot),
    abbreviation: optionalString(team.abbreviation),
    color: optionalString(team.color),
    alt_color: optionalString(team.alternateColor) ?? optionalString(team.altColor) ??
      optionalString(team.alt_color),
    location,
    venue: optionalString(location.name) ?? optionalString(location.venue),
    capacity: integerValue(location.capacity),
    is_fbs: isFbs,
  };
};

// ---------------------------------------------------------------- roster

// One row per FBS team and player. FCS and unknown teams are skipped.
export const mapRoster = (
  data: unknown[],
  season: number,
  idByName: Map<string, number>,
  fbsIds: Set<number>,
) => {
  const rows = new Map<string, JsonObject>();
  for (const raw of data) {
    const item = jsonObject(raw);
    const playerId = identifier(item.id);
    const firstName = optionalString(item.firstName);
    const lastName = optionalString(item.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const teamId = teamIdFor(item.team, idByName);
    if (!playerId || !fullName || teamId === null || !fbsIds.has(teamId)) continue;
    rows.set(`${teamId}:${playerId}`, {
      season,
      team_id: teamId,
      player_id: playerId,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      jersey: integerValue(item.jersey),
      position: optionalString(item.position),
      class_year: integerValue(item.year),
      height: integerValue(item.height),
      weight: integerValue(item.weight),
      home_city: optionalString(item.homeCity),
      home_state: optionalString(item.homeState),
      home_country: optionalString(item.homeCountry),
    });
  }
  return [...rows.values()];
};

// ---------------------------------------------------------------- games

export const cfpRoundFrom = (playoff: JsonObject, notes: string) => {
  const text = `${optionalString(playoff.roundName) ?? ""} ${optionalString(playoff.round) ?? ""} ${notes}`;
  if (/national championship/i.test(text)) return "National Championship";
  if (/semifinal|semi-final/i.test(text)) return "Semifinal";
  if (/quarterfinal|quarter-final/i.test(text)) return "Quarterfinal";
  if (/first round/i.test(text)) return "First Round";
  return null;
};

export const mapGame = (
  value: unknown,
  idByName: Map<string, number>,
  season: number,
) => {
  const game = asObject(value, "game");
  const homeId = integerValue(game.homeId) ?? teamIdFor(game.homeTeam, idByName);
  const awayId = integerValue(game.awayId) ?? teamIdFor(game.awayTeam, idByName);
  if (homeId === null || awayId === null || homeId === awayId) return null;
  const id = integerValue(game.id);
  if (id === null) throw new Error("CFBD game record is missing id");
  const notes = optionalString(game.notes) ?? "";
  const playoff = jsonObject(game.playoff);
  const seasonType = optionalString(game.seasonType) ?? "regular";
  const status = optionalString(game.status) ?? "";
  const completed = game.completed === true || /final|completed/i.test(status);
  const inProgress = !completed && /progress|quarter|half|overtime/i.test(status);
  const cfpRound = cfpRoundFrom(playoff, notes);
  const postseason = seasonType.toLowerCase() !== "regular";
  const bowlName = optionalString(playoff.bowlName) ??
    (postseason && notes ? notes : null);
  return {
    id,
    season,
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
    venue: optionalString(game.venue),
    away_postgame_rank: integerValue(game.awayPostgameRank),
    home_postgame_rank: integerValue(game.homePostgameRank),
    conference_game: typeof game.conferenceGame === "boolean" ? game.conferenceGame : null,
    status: completed ? "final" : inProgress ? "in_progress" : "scheduled",
    is_title_game: cfpRound === "National Championship",
    bowl_name: bowlName,
    cfp_round: cfpRound,
    notes: notes || null,
    home_seed: integerValue(playoff.homeSeed),
    away_seed: integerValue(playoff.awaySeed),
  };
};

// The TV outlet per game from /games/media. TV wins over web or radio.
export const mapMedia = (mediaData: unknown[]) => {
  const priority: Record<string, number> = { tv: 0, ppv: 1, web: 2, mobile: 3, radio: 4 };
  const best = new Map<number, { outlet: string; rank: number }>();
  for (const value of mediaData) {
    const item = jsonObject(value);
    const gameId = integerValue(item.id);
    const outlet = optionalString(item.outlet);
    const type = (optionalString(item.mediaType) ?? "").toLowerCase();
    if (gameId === null || !outlet) continue;
    const rank = priority[type] ?? 9;
    const current = best.get(gameId);
    if (!current || rank < current.rank) best.set(gameId, { outlet, rank });
  }
  return new Map([...best].map(([id, value]) => [id, value.outlet]));
};

// ---------------------------------------------------------------- lines

export const mapLines = (lineData: unknown[], gameIds: Set<number>) =>
  lineData.flatMap((value) => {
    const item = jsonObject(value);
    const gameId = integerValue(item.id);
    if (gameId === null || !gameIds.has(gameId)) return [];
    const providerSpreads: Record<string, number> = {};
    const spreads: number[] = [];
    const totals: number[] = [];
    let consensusTotal: number | null = null;
    for (const rawLine of Array.isArray(item.lines) ? item.lines : []) {
      const line = jsonObject(rawLine);
      const provider = optionalString(line.provider);
      const spread = numberValue(line.spread);
      const total = numberValue(line.overUnder);
      const isConsensus = provider !== null && /consensus/i.test(provider);
      if (provider && spread !== null) {
        providerSpreads[provider] = spread;
        if (!isConsensus) spreads.push(spread);
      }
      if (total !== null) {
        if (isConsensus) consensusTotal = total;
        else totals.push(total);
      }
    }
    const consensus = Object.entries(providerSpreads)
      .find(([provider]) => /consensus/i.test(provider))?.[1] ??
      (spreads.length
        ? Math.round(spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length * 2) / 2
        : null);
    const overUnder = consensusTotal ??
      (totals.length
        ? Math.round(totals.reduce((sum, total) => sum + total, 0) / totals.length * 2) / 2
        : null);
    if (consensus === null && overUnder === null) return [];
    return [{
      game_id: gameId,
      provider_spreads: providerSpreads,
      consensus_spread: consensus,
      over_under: overUnder,
    }];
  });

// ---------------------------------------------------------------- box scores

export const mapTeamGameStats = (
  teamData: unknown[],
  gameIds: Set<number>,
  idByName: Map<string, number>,
) => {
  const rows = new Map<string, { game_id: number; team_id: number; stats: JsonObject }>();
  for (const value of teamData) {
    const game = jsonObject(value);
    const gameId = integerValue(game.id);
    if (gameId === null || !gameIds.has(gameId)) continue;
    for (const rawSide of Array.isArray(game.teams) ? game.teams : []) {
      const side = jsonObject(rawSide);
      const teamId = teamIdFor(side.teamId ?? side.team, idByName);
      if (teamId === null) continue;
      const key = `${gameId}:${teamId}`;
      const row = rows.get(key) ?? { game_id: gameId, team_id: teamId, stats: {} };
      for (const rawStat of Array.isArray(side.stats) ? side.stats : []) {
        const stat = jsonObject(rawStat);
        const category = optionalString(stat.category);
        if (category) row.stats[category] = stat.stat ?? null;
      }
      rows.set(key, row);
    }
  }
  return [...rows.values()];
};

export const mapPlayerGameStats = (
  playerData: unknown[],
  gameIds: Set<number>,
  idByName: Map<string, number>,
) => {
  const rows = new Map<string, {
    game_id: number;
    player_id: string;
    player_name: string;
    team_id: number;
    category: string;
    stats: JsonObject;
  }>();
  for (const value of playerData) {
    const game = jsonObject(value);
    const gameId = integerValue(game.id);
    if (gameId === null || !gameIds.has(gameId)) continue;
    for (const rawSide of Array.isArray(game.teams) ? game.teams : []) {
      const side = jsonObject(rawSide);
      const teamId = teamIdFor(side.teamId ?? side.team, idByName);
      if (teamId === null) continue;
      for (const rawCategory of Array.isArray(side.categories) ? side.categories : []) {
        const categoryRecord = jsonObject(rawCategory);
        const category = optionalString(categoryRecord.name);
        if (!category) continue;
        for (const rawType of Array.isArray(categoryRecord.types) ? categoryRecord.types : []) {
          const type = jsonObject(rawType);
          const stat = optionalString(type.name);
          if (!stat) continue;
          for (const rawAthlete of Array.isArray(type.athletes) ? type.athletes : []) {
            const athlete = jsonObject(rawAthlete);
            const playerName = optionalString(athlete.name);
            if (!playerName) continue;
            const playerId = identifier(athlete.id) ?? `${teamId}:${slugify(playerName)}`;
            const key = `${gameId}:${playerId}:${teamId}:${category}`;
            const row = rows.get(key) ?? {
              game_id: gameId,
              player_id: playerId,
              player_name: playerName,
              team_id: teamId,
              category,
              stats: {},
            };
            row.stats[stat] = athlete.stat ?? null;
            rows.set(key, row);
          }
        }
      }
    }
  }
  return [...rows.values()];
};

// ---------------------------------------------------------------- polls

// CFBD returns several polls per week. Only these three are used; the FCS and
// Division II/III coaches polls must not be read as the FBS Coaches Poll.
export const classifyPoll = (name: string | null): "AP" | "Coaches" | "CFP" | null => {
  const poll = (name ?? "").trim().toLowerCase();
  if (!poll) return null;
  if (/\bfcs\b|division|afca d|d-?ii|naia/.test(poll)) return null;
  if (/playoff committee|college football playoff|\bcfp\b|selection committee/.test(poll)) {
    return "CFP";
  }
  if (/^ap\b|associated press/.test(poll)) return "AP";
  if (/coaches/.test(poll)) return "Coaches";
  return null;
};

export const mapPolls = (
  rankings: unknown[],
  idByName: Map<string, number>,
  season: number,
) => {
  const rows = new Map<string, JsonObject>();
  for (const value of rankings) {
    const item = jsonObject(value);
    const week = integerValue(item.week);
    if (week === null) continue;
    const seasonType = (optionalString(item.seasonType) ?? "regular").toLowerCase() ===
        "postseason"
      ? "postseason"
      : "regular";
    for (const rawPoll of Array.isArray(item.polls) ? item.polls : []) {
      const poll = jsonObject(rawPoll);
      const source = classifyPoll(optionalString(poll.poll));
      if (!source) continue;
      for (const rawRank of Array.isArray(poll.ranks) ? poll.ranks : []) {
        const rank = jsonObject(rawRank);
        const teamId = teamIdFor(rank.teamId ?? rank.school, idByName);
        const place = integerValue(rank.rank);
        if (teamId === null || place === null || place < 1) continue;
        rows.set(`${seasonType}:${week}:${source}:${teamId}`, {
          season,
          season_type: seasonType,
          week,
          source,
          rank: place,
          team_id: teamId,
          points: integerValue(rank.points),
          first_place_votes: integerValue(rank.firstPlaceVotes),
        });
      }
    }
  }
  return [...rows.values()];
};

// The final AP rank of each team: the postseason poll when it exists,
// otherwise the latest regular-season poll.
export const finalApRanks = (polls: JsonObject[]) => {
  const latest = new Map<number, { order: number; rank: number }>();
  for (const poll of polls) {
    if (poll.source !== "AP") continue;
    const order = (poll.season_type === "postseason" ? 100 : 0) + Number(poll.week);
    const teamId = Number(poll.team_id);
    const current = latest.get(teamId);
    if (!current || order > current.order) latest.set(teamId, { order, rank: Number(poll.rank) });
  }
  const maxOrder = Math.max(0, ...[...latest.values()].map((value) => value.order));
  return new Map(
    [...latest].filter(([, value]) => value.order === maxOrder)
      .map(([teamId, value]) => [teamId, value.rank]),
  );
};

// ---------------------------------------------------------------- season stats

export const mapPlayerSeasonStats = (
  playerData: unknown[],
  idByName: Map<string, number>,
  season: number,
  fbsIds: Set<number> | null,
) => {
  const rows = new Map<string, {
    season: number;
    player_id: string;
    player_name: string;
    team_id: number | null;
    position: string | null;
    category: string;
    stats: JsonObject;
  }>();
  for (const value of playerData) {
    const item = jsonObject(value);
    const playerId = identifier(item.playerId) ?? identifier(item.athleteId);
    const playerName = optionalString(item.player) ?? optionalString(item.playerName);
    const category = optionalString(item.category);
    const statName = optionalString(item.statType) ?? optionalString(item.statName);
    const teamId = teamIdFor(item.teamId ?? item.team, idByName);
    if (!playerId || !playerName || !category || !statName) continue;
    if (fbsIds && (teamId === null || !fbsIds.has(teamId))) continue;
    const key = `${playerId}:${category}`;
    const row = rows.get(key) ?? {
      season,
      player_id: playerId,
      player_name: playerName,
      team_id: teamId,
      position: optionalString(item.position),
      category,
      stats: {},
    };
    const raw = item.stat ?? item.statValue ?? null;
    row.stats[statName] = numberValue(raw) ?? raw;
    rows.set(key, row);
  }
  return [...rows.values()];
};

export const mapTeamSeasonStats = (
  teamData: unknown[],
  idByName: Map<string, number>,
  season: number,
  fbsIds: Set<number> | null,
) => {
  const rows = new Map<number, {
    season: number;
    team_id: number;
    category: string;
    stats: JsonObject;
    national_ranks: JsonObject;
  }>();
  for (const value of teamData) {
    const item = jsonObject(value);
    const teamId = teamIdFor(item.teamId ?? item.team, idByName);
    const stat = optionalString(item.statName);
    if (teamId === null || !stat) continue;
    if (fbsIds && !fbsIds.has(teamId)) continue;
    const row = rows.get(teamId) ?? {
      season,
      team_id: teamId,
      category: "season",
      stats: {},
      national_ranks: {},
    };
    const raw = item.statValue ?? item.value ?? null;
    row.stats[stat] = numberValue(raw) ?? raw;
    rows.set(teamId, row);
  }
  // National ranks per statistic, computed across FBS teams. Statistics where
  // a lower value is better (allowed yards, turnovers, penalties) rank ascending.
  const lowerIsBetter = (stat: string) =>
    /opponent/i.test(stat)
      ? !/turnover|sack|intercept|fumble|tacklesForLoss|penalt/i.test(stat)
      : /^turnovers$|fumblesLost|^interceptions$|penalt|sacksAllowed/i.test(stat);
  const statNames = new Set([...rows.values()].flatMap((row) => Object.keys(row.stats)));
  for (const stat of statNames) {
    const values = [...rows.values()]
      .map((row) => ({ row, value: numberValue(row.stats[stat]) }))
      .filter((entry): entry is { row: typeof entry.row; value: number } => entry.value !== null);
    const ascending = lowerIsBetter(stat);
    values.sort((a, b) => ascending ? a.value - b.value : b.value - a.value);
    let lastValue: number | null = null;
    let lastRank = 0;
    values.forEach((entry, index) => {
      const rank = entry.value === lastValue ? lastRank : index + 1;
      entry.row.national_ranks[stat] = rank;
      lastValue = entry.value;
      lastRank = rank;
    });
  }
  return [...rows.values()];
};

// ---------------------------------------------------------------- coaches

export const mapCoaches = (
  coachData: unknown[],
  idByName: Map<string, number>,
  season: number,
  knownTeams: Set<number>,
) => {
  const rows = new Map<number, JsonObject>();
  for (const value of coachData) {
    const coach = jsonObject(value);
    const name = [optionalString(coach.firstName), optionalString(coach.lastName)]
      .filter(Boolean).join(" ");
    if (!name) continue;
    for (const rawSeason of Array.isArray(coach.seasons) ? coach.seasons : []) {
      const entry = jsonObject(rawSeason);
      if (integerValue(entry.year) !== season) continue;
      const teamId = teamIdFor(entry.school, idByName);
      if (teamId === null || !knownTeams.has(teamId)) continue;
      const games = integerValue(entry.games) ?? 0;
      const current = rows.get(teamId);
      // An interim coach shares a season with the fired coach; keep the coach
      // with the most games, which is the one still in charge at season end.
      if (current && Number(current.games ?? 0) >= games) continue;
      rows.set(teamId, {
        season,
        team_id: teamId,
        coach_id: slugify(name),
        coach_name: name,
        wins: integerValue(entry.wins) ?? 0,
        losses: integerValue(entry.losses) ?? 0,
        ties: integerValue(entry.ties) ?? 0,
        games,
      });
    }
  }
  return [...rows.values()].map(({ games: _games, ...row }) => row);
};

// ---------------------------------------------------------------- scoreboard

export type ScoreboardUpdate = {
  id: number;
  status: "scheduled" | "in_progress" | "final";
  home_points: number | null;
  away_points: number | null;
  home_line_scores: number[] | null;
  away_line_scores: number[] | null;
  period: number | null;
  clock: string | null;
  tv: string | null;
};

export const mapScoreboard = (data: unknown[]): ScoreboardUpdate[] =>
  data.flatMap((value) => {
    const game = jsonObject(value);
    const id = integerValue(game.id);
    if (id === null) return [];
    const home = jsonObject(game.homeTeam);
    const away = jsonObject(game.awayTeam);
    const status = (optionalString(game.status) ?? "").toLowerCase();
    const lines = (side: JsonObject) =>
      Array.isArray(side.lineScores)
        ? side.lineScores.map((score) => integerValue(score) ?? 0)
        : null;
    return [{
      id,
      status: status === "completed" || status === "final"
        ? "final"
        : status === "in_progress"
        ? "in_progress"
        : "scheduled",
      home_points: integerValue(home.points),
      away_points: integerValue(away.points),
      home_line_scores: lines(home),
      away_line_scores: lines(away),
      period: integerValue(game.period),
      clock: optionalString(game.clock),
      tv: optionalString(game.tv),
    }];
  });
