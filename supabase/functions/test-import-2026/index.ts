import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const SEASON = 2026;
const CFBD_BASE_URL = "https://api.collegefootballdata.com";
const GITHUB_OIDC_AUDIENCE = "strdys-supabase-test-import";
const GITHUB_REPOSITORY = "cornerduck/cfb-tracker";
const GITHUB_WORKFLOW_REF =
  "cornerduck/cfb-tracker/.github/workflows/supabase.yml@refs/heads/main";
const GITHUB_JWKS_URL =
  "https://token.actions.githubusercontent.com/.well-known/jwks";

type JsonObject = Record<string, unknown>;
type GithubSigningKey = JsonWebKey & { kid: string };

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

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`CFBD record is missing ${label}`);
  }
  return value.trim();
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const optionalInteger = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("CFBD returned an invalid integer");
  }
  return parsed;
};

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const mapTeam = (value: unknown) => {
  const team = asObject(value, "team");
  const id = optionalInteger(team.id);
  if (id === null) throw new Error("CFBD team record is missing id");

  const school = requiredString(team.school, "school");
  const location = typeof team.location === "object" && team.location !== null
    ? team.location
    : {};
  const locationObject = asObject(location, "team location");

  return {
    id,
    slug: slugify(school),
    school,
    mascot: optionalString(team.mascot),
    abbreviation: optionalString(team.abbreviation),
    color: optionalString(team.color),
    alt_color: optionalString(team.alt_color),
    location: locationObject,
    venue: optionalString(locationObject.venue),
    capacity: optionalInteger(locationObject.capacity),
    is_fbs: true,
  };
};

const normalizeConferenceName = (value: string) =>
  value.toLowerCase().replace(/^the\s+/, "").replace(/\s+conference$/, "");

const powerFour = new Set([
  "acc",
  "atlantic coast",
  "b1g",
  "big ten",
  "big 12",
  "sec",
  "southeastern",
]);
const groupOfSix = new Set([
  "aac",
  "american athletic",
  "conference usa",
  "cusa",
  "mac",
  "mid-american",
  "mwc",
  "mountain west",
  "pac-12",
  "sun belt",
]);

const mapConference = (value: unknown, fbsConferenceNames: Set<string>) => {
  const conference = asObject(value, "conference");
  const name = requiredString(conference.name, "conference name");
  const classification = optionalString(conference.classification);
  if (classification && classification.toLowerCase() !== "fbs") return null;
  if (!classification && !fbsConferenceNames.has(name.toLowerCase())) {
    return null;
  }

  const id = optionalInteger(conference.id);
  if (id === null) throw new Error(`CFBD conference "${name}" is missing id`);

  const shortName = optionalString(conference.shortName);
  const identifiers = [name, shortName, optionalString(conference.abbreviation)]
    .filter((identifier): identifier is string => identifier !== null)
    .map(normalizeConferenceName);
  const isIndependent = identifiers.some((identifier) =>
    identifier.includes("independent")
  );
  const groupName = isIndependent
    ? "Independent"
    : identifiers.some((identifier) => powerFour.has(identifier))
    ? "Power 4"
    : identifiers.some((identifier) => groupOfSix.has(identifier))
    ? "Group of 6"
    : null;
  const divisions = Array.isArray(conference.divisions)
    ? conference.divisions.filter((division): division is string =>
      typeof division === "string"
    )
    : [];

  return {
    id,
    slug: slugify(name),
    name,
    short_name: shortName,
    abbreviation: optionalString(conference.abbreviation),
    group_name: groupName,
    classification,
    divisions,
  };
};

const mapCalendarWeek = (value: unknown) => {
  const week = asObject(value, "calendar");
  const season = optionalInteger(week.season);
  const weekNumber = optionalInteger(week.week);
  const seasonType = requiredString(week.seasonType, "calendar seasonType");
  if (season !== SEASON || weekNumber === null) {
    throw new Error("CFBD returned a calendar week for an unexpected season");
  }

  return {
    season,
    week: weekNumber,
    season_type: seasonType,
    start_date: optionalString(week.firstGameStart),
    end_date: optionalString(week.lastGameStart),
  };
};

const fetchCfbd = async (path: string, apiKey: string): Promise<unknown[]> => {
  const url = new URL(path, CFBD_BASE_URL);
  url.searchParams.set("year", String(SEASON));

  const result = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!result.ok) {
    throw new Error(`CFBD ${path} request failed with HTTP ${result.status}`);
  }

  const payload: unknown = await result.json();
  if (!Array.isArray(payload)) {
    throw new Error(`CFBD ${path} response was not an array`);
  }
  return payload;
};

const decodeBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const decodeJwtPart = (value: string): JsonObject =>
  asObject(
    JSON.parse(new TextDecoder().decode(decodeBase64Url(value))),
    "GitHub token",
  );

const getGithubKeys = async (refresh = false) => {
  if (refresh || !githubKeys) {
    githubKeys = fetch(GITHUB_JWKS_URL).then(async (result) => {
      if (!result.ok) {
        throw new Error(
          `GitHub JWKS request failed with HTTP ${result.status}`,
        );
      }
      const payload: unknown = await result.json();
      const keys = asObject(payload, "GitHub JWKS").keys;
      if (!Array.isArray(keys)) {
        throw new Error("GitHub JWKS did not contain signing keys");
      }
      return keys.map((key) => {
        const signingKey = asObject(key, "GitHub signing key");
        if (
          typeof signingKey.kid !== "string" ||
          signingKey.kty !== "RSA" ||
          typeof signingKey.n !== "string" ||
          typeof signingKey.e !== "string"
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
  if (parts.length !== 3) {
    throw new Error("Malformed GitHub Actions identity token");
  }

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported GitHub token signing algorithm");
  }

  let signingKey = (await getGithubKeys()).find((key) =>
    key.kid === header.kid
  );
  if (!signingKey) {
    signingKey = (await getGithubKeys(true)).find((key) =>
      key.kid === header.kid
    );
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
    !hasAudience ||
    typeof payload.exp !== "number" ||
    payload.exp <= now ||
    (typeof payload.nbf === "number" && payload.nbf > now)
  ) {
    throw new Error(
      "GitHub token issuer, audience, or validity period is invalid",
    );
  }

  if (
    payload.repository !== GITHUB_REPOSITORY ||
    payload.event_name !== "workflow_dispatch" ||
    payload.ref !== "refs/heads/main" ||
    payload.workflow_ref !== GITHUB_WORKFLOW_REF
  ) {
    throw new Error(
      "The GitHub token is not from the authorized manual workflow on main",
    );
  }
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  const githubToken = request.headers.get("x-github-oidc-token");
  if (!githubToken) {
    return response({ error: "Missing GitHub Actions identity token" }, 401);
  }

  try {
    await validateWorkflowToken(githubToken);
  } catch {
    return response(
      { error: "GitHub Actions identity could not be verified" },
      401,
    );
  }

  const apiKey = Deno.env.get("CFBD_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    return response({
      error: "Required Edge Function configuration is missing",
    }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let updateLogId: number | null = null;
  let apiCallsUsed = 0;

  try {
    const { data: log, error: logError } = await supabase
      .from("update_log")
      .insert({
        job: "test-import-2026",
        trigger: "manual",
        status: "running",
      })
      .select("id")
      .single();
    if (logError) {
      throw new Error(`Could not start update log: ${logError.message}`);
    }
    updateLogId = log.id;

    apiCallsUsed = 3;
    const [teamData, conferenceData, calendarData] = await Promise.all([
      fetchCfbd("/teams/fbs", apiKey),
      fetchCfbd("/conferences", apiKey),
      fetchCfbd("/calendar", apiKey),
    ]);

    const teams = teamData.map(mapTeam);
    const fbsConferenceNames = new Set(
      teamData
        .map((value) =>
          optionalString(asObject(value, "team").conference)?.toLowerCase()
        )
        .filter((name): name is string => Boolean(name)),
    );
    const conferences = conferenceData
      .map((value) => mapConference(value, fbsConferenceNames))
      .filter((conference): conference is NonNullable<typeof conference> =>
        conference !== null
      );
    const calendar = calendarData.map(mapCalendarWeek);

    if (
      teams.length === 0 || conferences.length === 0 || calendar.length === 0
    ) {
      throw new Error(
        "CFBD returned an empty 2026 teams, conferences, or calendar dataset",
      );
    }

    const { error: seasonError } = await supabase
      .from("seasons")
      .upsert({ year: SEASON, status: "live" }, {
        onConflict: "year",
        ignoreDuplicates: true,
      });
    if (seasonError) {
      throw new Error(
        `Could not create the 2026 season: ${seasonError.message}`,
      );
    }

    const { error: teamsError } = await supabase
      .from("teams")
      .upsert(teams, { onConflict: "id" });
    if (teamsError) {
      throw new Error(`Could not import teams: ${teamsError.message}`);
    }

    const { error: conferencesError } = await supabase
      .from("conferences")
      .upsert(conferences, { onConflict: "id" });
    if (conferencesError) {
      throw new Error(
        `Could not import conferences: ${conferencesError.message}`,
      );
    }

    const conferenceSeasons = conferences.map(({ id, divisions }) => ({
      season: SEASON,
      conference_id: id,
      divisions,
    }));
    const { error: conferenceSeasonsError } = await supabase
      .from("conference_seasons")
      .upsert(conferenceSeasons, { onConflict: "season,conference_id" });
    if (conferenceSeasonsError) {
      throw new Error(
        `Could not import conference seasons: ${conferenceSeasonsError.message}`,
      );
    }

    const { error: calendarError } = await supabase
      .from("calendar")
      .upsert(calendar, { onConflict: "season,week,season_type" });
    if (calendarError) {
      throw new Error(`Could not import calendar: ${calendarError.message}`);
    }

    const details = {
      teams_imported: teams.length,
      conferences_imported: conferences.length,
      calendar_weeks_imported: calendar.length,
    };
    const { error: finishError } = await supabase
      .from("update_log")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        api_calls_used: apiCallsUsed,
        details,
      })
      .eq("id", updateLogId);
    if (finishError) {
      throw new Error(`Could not finish update log: ${finishError.message}`);
    }

    return response({
      status: "success",
      season: SEASON,
      api_calls_used: apiCallsUsed,
      ...details,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unexpected test import failure";
    if (updateLogId !== null) {
      const { error: logError } = await supabase
        .from("update_log")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          api_calls_used: apiCallsUsed,
          error: message,
        })
        .eq("id", updateLogId);
      if (logError) {
        console.error("Could not record failed test import:", logError.message);
      }
    }
    console.error("2026 test import failed:", message);
    return response({ status: "failed", error: message }, 500);
  }
});
