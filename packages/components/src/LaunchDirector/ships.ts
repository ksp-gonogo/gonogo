import {
  isValue,
  KSP_EDITOR_FACILITY_NAMES,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";
import type { LaunchSiteEntry } from "./pads";

export interface SavedShip {
  name: string;
  /** The `.craft` file name without its extension: unique within a facility folder, and what `ksp.launch` resolves. {@link name} is operator-chosen text and repeats across files. */
  file: string;
  /** The three figures below are null where the wire did not carry them. */
  partCount: number | null;
  totalMass: number | null;
  /** KSP's own `EditorFacility` name, verbatim: the label shown on the row. */
  facility: string;
  /** KSP's `EditorFacility` ordinal, `null` when none was sent: what decides the launch editor; {@link facility} is display only. */
  facilityOrdinal: number | null;
  requiresFunds: number | null;
  missingParts: string[];
  /** The universal time of the craft's most recent launch, null when it has never been launched. */
  lastLaunched: Value<"ut"> | null;
  /** True when {@link lastLaunched} came from a vessel in the save sharing the craft's name rather than from a recorded launch. */
  lastLaunchedByName: boolean;
}

function launchTime(raw: unknown): Value<"ut"> | null {
  if (isValue(raw)) return raw as Value<"ut">;
  return typeof raw === "number" && Number.isFinite(raw)
    ? value("ut", raw)
    : null;
}

export function parseSavedShips(raw: unknown): SavedShip[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: SavedShip[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      file: typeof e.file === "string" && e.file ? e.file : name,
      partCount: magnitudeOf(asQuantityish(e.partCount)),
      totalMass: magnitudeOf(asQuantityish(e.totalMass)),
      facility: typeof e.facility === "string" ? e.facility : "",
      facilityOrdinal:
        typeof e.facilityOrdinal === "number" ? e.facilityOrdinal : null,
      requiresFunds: magnitudeOf(asQuantityish(e.requiresFunds)),
      missingParts: Array.isArray(e.missingParts)
        ? e.missingParts.filter((p): p is string => typeof p === "string")
        : [],
      lastLaunched: launchTime(e.lastLaunchedUt),
      lastLaunchedByName: e.lastLaunchedByName === true,
    });
  }
  return out;
}

/**
 * The craft most recently launched first, then the ones never launched in
 * name order. A craft with no launch time sorts with the never-launched ones,
 * so a craft is never ranked on a time that is not a fact.
 */
export function sortByLastLaunched(
  ships: readonly SavedShip[],
): readonly SavedShip[] {
  return [...ships].sort(byLastLaunched);
}

function byLastLaunched(a: SavedShip, b: SavedShip): number {
  const { lastLaunched: first } = a;
  const { lastLaunched: second } = b;
  if (first === null && second === null) return a.name.localeCompare(b.name);
  if (first === null) return 1;
  if (second === null) return -1;
  if (first.greaterThan(second)) return -1;
  if (second.greaterThan(first)) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * The editor a saved craft launches from, as `ksp.launch` spells it. Resolved
 * from the ordinal, never substituted with a default: a default in a dispatched
 * argument launches a spaceplane from the pad. An unknown ordinal passes the
 * raw name through so the mod refuses it visibly.
 */
export function launchFacilityArg(ship: SavedShip): string {
  const resolved =
    ship.facilityOrdinal === null
      ? undefined
      : KSP_EDITOR_FACILITY_NAMES.get(ship.facilityOrdinal);
  // `None` is not an editor: let the mod refuse rather than choosing one on the player's behalf.
  if (resolved === undefined || resolved === "None") return ship.facility;
  return resolved;
}

/**
 * The craft this pad can take: a VAB craft from a pad, an SPH craft from a
 * runway, matched on the editor resolved from the ordinal. A site whose
 * facility is neither offers every craft, since hiding the fleet is a claim
 * we cannot make.
 */
export function craftForPad(
  pad: LaunchSiteEntry | undefined,
  ships: readonly SavedShip[] | null,
): readonly SavedShip[] {
  if (ships === null) return [];
  if (pad === undefined) return ships;
  if (pad.facility !== "VAB" && pad.facility !== "SPH") return ships;
  return ships.filter((s) => launchFacilityArg(s) === pad.facility);
}

/**
 * Why the save cannot launch a craft now, one line per cause: more than the
 * funds on hand, parts still locked. Null for a craft it can launch.
 */
export function shipBlockedReason(
  ship: SavedShip,
  fundsAvailable: number,
): string | null {
  const causes = [
    ship.requiresFunds !== null && ship.requiresFunds > fundsAvailable
      ? "Insufficient funds"
      : null,
    ship.missingParts.length > 0
      ? `Missing: ${ship.missingParts.join(", ")}`
      : null,
  ].filter((cause) => cause !== null);
  return causes.length === 0 ? null : causes.join("\n");
}

/** A craft the save cannot launch now: parts still locked, or more than the funds on hand. */
export function shipBlocked(ship: SavedShip, fundsAvailable: number): boolean {
  return shipBlockedReason(ship, fundsAvailable) !== null;
}
