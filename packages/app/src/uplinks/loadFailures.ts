import { useMemo } from "react";
import {
  type UplinkReadinessEntry,
  useUplinkReadiness,
} from "../firstRun/useUplinkReadiness";

export type UplinkLoadFailureKind =
  | "contract"
  | "assembly"
  | "integrity"
  | "client"
  | "reported";

/** What a station is told about a failing Uplink: its name, since the reason is worded on the main screen. */
export type HostUplinkFailure = Pick<UplinkLoadFailure, "id" | "name">;

/** One installed Uplink that did not load, with the reason worded for the operator at the screen. */
export interface UplinkLoadFailure {
  id: string;
  name: string;
  kind: UplinkLoadFailureKind;
  /** What went wrong in plain words, carrying the mod's, loader's or Uplink's own detail verbatim where there is one. */
  why: string;
  /** The one thing that fixes this kind of failure, or null where `why` already says it, as it does for an Uplink reporting in its own words. */
  fix: string | null;
}

function contractText(v: { major: number; minor: number }): string {
  return `${v.major}.${v.minor}`;
}

function failureOf(entry: UplinkReadinessEntry): UplinkLoadFailure | null {
  if (!entry.installed) return null;
  const base = { id: entry.id, name: entry.name };
  const health = entry.rosterEntry?.health;
  /* The Uplink's own word, in its own words, outranks every inference below. An Uplink the mod refused outright has its refusal reported by the cases below instead. */
  if (entry.rosterEntry?.available && health?.preventsStart) {
    return {
      ...base,
      kind: "reported",
      why: health.detail ?? "It blocks start and gave no reason.",
      fix: null,
    };
  }
  switch (entry.state) {
    case "contract-mismatch": {
      const built = entry.declaredContract;
      const running = entry.coreContract;
      const versions =
        built && running
          ? `Built for contract ${contractText(built)}; Gonogo speaks ${contractText(running)}.`
          : "Built for a different contract than Gonogo speaks.";
      return {
        ...base,
        kind: "contract",
        why: versions,
        fix: "Update the Uplink or Gonogo so they match.",
      };
    }
    case "unavailable":
      /* An Uplink the mod lists as available but whose own health reads unavailable is reporting that something it integrates with is absent, such as an expansion the player does not own. The mod did load it. */
      if (entry.rosterEntry?.available !== false) return null;
      return {
        ...base,
        kind: "assembly",
        why: entry.modReason
          ? `The game could not start it: ${entry.modReason}`
          : "The game could not start it.",
        fix: "Update the Uplink, or remove it from GameData.",
      };
    case "quarantined": {
      const outcome = entry.outcome;
      if (
        !outcome ||
        outcome.registryUnavailable ||
        outcome.awaitingRoster ||
        outcome.refusedOnHealth
      ) {
        return null;
      }
      if (outcome.integrity) {
        return {
          ...base,
          kind: "integrity",
          why: "Its client is not the build the mod vouched for.",
          fix: "Update the Uplink.",
        };
      }
      const detail = outcome.summary ?? outcome.reason;
      return {
        ...base,
        kind: "client",
        why: detail
          ? `Its client could not be loaded: ${detail}`
          : "Its client could not be loaded.",
        fix: "Update the Uplink, or remove it from GameData.",
      };
    }
    default:
      return null;
  }
}

/**
 * The installed Uplinks that failed to load, in roster order: refused for its
 * contract, assembly the game would not start, client refused, failing its
 * integrity check, missing or throwing on import, or an Uplink that reports
 * through its health that its state prevents start (shown in its own words).
 * Not counted: an Uplink that
 * loaded but reports its own health unavailable without saying it prevents
 * start (a bundled Uplink whose
 * expansion is not owned, an add-on whose host mod is absent), a client the
 * operator skipped at the consent prompt, and a quarantine that says nothing
 * about the Uplink itself (the registry unreadable, the roster not yet naming
 * it, the Uplink's own health refusal). Useful for deciding
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
