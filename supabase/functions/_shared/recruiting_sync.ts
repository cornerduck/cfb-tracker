// Loads recruiting data from CFBD into the database. Used by the manual import (import-recruiting)
// and by the Monday update job (update-2026).

import { type CallCounter, fetchCfbd, type JsonObject } from "./cfbd.ts";
import { countByMonth, currentClassYear, mapPortal, mapRecruitingTeams, mapRecruits, unmatchedNames } from "./recruiting.ts";
import { type Db, loadTeamLookups, upsertRows } from "./store.ts";

type Lookups = Awaited<ReturnType<typeof loadTeamLookups>>;

// The high school recruits of one class and the team class rankings (2 CFBD calls).
export async function syncRecruitClass(
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  lookups: Lookups,
  year: number,
  requireData: boolean,
): Promise<JsonObject> {
  const players = await fetchCfbd("/recruiting/players", apiKey, calls, { classification: "HighSchool" }, { year });
  const recruits = mapRecruits(players, year, lookups.idByName, lookups.allIds);
  if (!recruits.length && requireData) throw new Error(`CFBD returned no recruits for the class of ${year}`);
  const teams = await fetchCfbd("/recruiting/teams", apiKey, calls, {}, { year });
  const classRows = mapRecruitingTeams(teams, recruits, year, lookups.idByName, lookups.fbsIds);
  return {
    class_year: year,
    recruits: await upsertRows(supabase, "recruits", recruits, "class_year,id"),
    class_rankings: await upsertRows(supabase, "recruiting_teams", classRows, "class_year,team_id"),
    top_recruit: recruits[0]?.name ?? null,
    unmatched_commit_schools: unmatchedNames(
      recruits.map((row) => (row.committed_team_id === null ? (row.committed_to as string | null) : null)),
      lookups.idByName,
    ),
  };
}

// Every transfer portal entry of one season (1 CFBD call).
export async function syncPortalSeason(
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  lookups: Lookups,
  season: number,
  requireData: boolean,
): Promise<JsonObject> {
  const entries = await fetchCfbd("/player/portal", apiKey, calls, {}, { year: season });
  const rows = mapPortal(entries, season, lookups.idByName, lookups.allIds);
  if (!rows.length && requireData) throw new Error(`CFBD returned no portal entries for ${season}`);
  const dates = rows.map((row) => row.transfer_date as string | null).filter((value): value is string => !!value).sort();
  return {
    portal_season: season,
    portal_entries: await upsertRows(supabase, "portal_entries", rows, "season,id"),
    portal_with_destination: rows.filter((row) => row.destination !== null).length,
    portal_first_transfer_date: dates[0] ?? null,
    portal_last_transfer_date: dates[dates.length - 1] ?? null,
    unmatched_portal_schools: unmatchedNames(rows.flatMap((row) => [row.origin as string | null, row.destination as string | null]), lookups.idByName),
    portal_by_month: countByMonth(dates),
  };
}

// The portal seasons the weekly update refreshes: the current calendar year, and from November on the
// next one as well, because CFBD starts the next season while the offseason window opens.
export const portalSeasonsToRefresh = (now = new Date()) => {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 10 ? [year, year + 1] : [year];
};

// The Monday job: the class that is recruited now and the current portal (about 4 CFBD calls). A failure
// of one part is reported in the details and never fails the job.
export async function syncRecruitingWeekly(supabase: Db, apiKey: string, calls: CallCounter, now = new Date()): Promise<JsonObject> {
  const details: JsonObject = {};
  const errors: string[] = [];
  const lookups = await loadTeamLookups(supabase);
  const classYear = currentClassYear(now);
  try {
    const result = await syncRecruitClass(supabase, apiKey, calls, lookups, classYear, false);
    details.recruiting_class = {
      class_year: result.class_year,
      recruits: result.recruits,
      class_rankings: result.class_rankings,
    };
  } catch (error) {
    errors.push(`class ${classYear}: ${error instanceof Error ? error.message : "failed"}`);
  }
  const portal: JsonObject[] = [];
  for (const season of portalSeasonsToRefresh(now)) {
    try {
      const result = await syncPortalSeason(supabase, apiKey, calls, lookups, season, false);
      portal.push({ season, entries: result.portal_entries });
    } catch (error) {
      errors.push(`portal ${season}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  details.recruiting_portal = portal;
  if (errors.length) {
    details.recruiting_error = errors.join("; ");
    console.error("Recruiting update failed:", details.recruiting_error);
  }
  return details;
}
