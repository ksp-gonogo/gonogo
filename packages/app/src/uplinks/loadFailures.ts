import { useMemo } from "react";
import {
  type UplinkReadinessEntry,
  useUplinkReadiness,
} from "../firstRun/useUplinkReadiness";

export type UplinkLoadFailureKind =
  | "contract"
  | "assembly"
  | "integrity"
  | "client";

/** What a station is told about a failing Uplink: its name, since the reason is worded on the main screen. */
export type HostUplinkFailure = Pick<UplinkLoadFailure, "id" | "name">;

/** One installed Uplink that did not load, with the reason worded for the operator at the screen. */
export interface UplinkLoadFailure {
  id: string;
  name: string;
  kind: UplinkLoadFailureKind;
  /** What went wrong in plain words, carrying the mod's or loader's own detail verbatim where there is one. */
  why: string;
}

function contractText(v: { major: number; minor: number }): string {
  return `${v.major}.${v.minor}`;
}

/**
 * A bundled Uplink whose own health reads unavailable while the mod still
 * lists it available is an expansion the player does not own. It is not a
 * fault and is never reported.
 */
function isUnownedExpansion(entry: UplinkReadinessEntry): boolean {
  const row = entry.rosterEntry;
  return (
    row !== null &&
    row.bundled &&
    row.available &&
    row.health.state === "unavailable"
  );
}

function failureOf(entry: UplinkReadinessEntry): UplinkLoadFailure | null {
  if (!entry.installed || isUnownedExpansion(entry)) return null;
  const base = { id: entry.id, name: entry.name };
  switch (entry.state) {
    case "contract-mismatch": {
      const built = entry.declaredContract;
      const running = entry.coreContract;
      const versions =
        built && running
          ? `It was built for contract ${contractText(built)} and the Gonogo mod speaks ${contractText(running)}.`
          : "It was built for a different contract than the Gonogo mod speaks.";
      return {
        ...base,
        kind: "contract",
        why: `The Gonogo mod refused it. ${versions}`,
      };
    }
    case "unavailable":
      return {
        ...base,
        kind: "assembly",
        why: entry.modReason
          ? `The game could not start it: ${entry.modReason}`
          : "The game could not start it.",
      };
    case "quarantined": {
      const outcome = entry.outcome;
      if (!outcome || outcome.registryUnavailable || outcome.awaitingRoster) {
        return null;
      }
      if (outcome.integrity) {
        return {
          ...base,
          kind: "integrity",
          why: "Its client is not the build the Gonogo mod vouched for.",
        };
      }
      const detail = outcome.summary ?? outcome.reason;
      return {
        ...base,
        kind: "client",
        why: detail
          ? `Its client could not be loaded: ${detail}`
          : "Its client could not be loaded.",
      };
    }
    default:
      return null;
  }
}

/**
 * The installed Uplinks that failed to load, in roster order: refused for its
 * contract, assembly the game would not start, client refused, failing its
 * integrity check, missing or throwing on import. Not counted: a bundled
 * Uplink whose expansion is not owned, a client the operator skipped at the
 * consent prompt, and a quarantine that says nothing about the Uplink itself
 * (the registry unreadable, the roster not yet naming it). Useful for deciding
 * whether the main screen can open. Used by the main screen's start gate.
 */
export function computeUplinkLoadFailures(
  entries: readonly UplinkReadinessEntry[],
): UplinkLoadFailure[] {
  const out: UplinkLoadFailure[] = [];
  for (const entry of entries) {
    const failure = failureOf(entry);
    if (failure) out.push(failure);
  }
  return out;
}

/** Live {@link computeUplinkLoadFailures}: re-derived whenever the roster or a load outcome moves. */
export function useUplinkLoadFailures(): UplinkLoadFailure[] {
  const { entries } = useUplinkReadiness();
  return useMemo(() => computeUplinkLoadFailures(entries), [entries]);
}
