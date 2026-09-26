import { KSP_EDITOR_FACILITY_NAMES } from "@ksp-gonogo/sitrep-sdk";
import { asQuantityish, magnitudeOr } from "../shared/magnitude";
import type { LaunchSiteEntry } from "./pads";

export interface SavedShip {
  name: string;
  partCount: number;
  totalMass: number;
  /** KSP's own `EditorFacility` name, verbatim: the label shown on the row. */
  facility: string;
  /** KSP's `EditorFacility` ORDINAL, `null` when none was sent: what decides the launch editor; {@link facility} is display only. */
  facilityOrdinal: number | null;
  requiresFunds: number;
  missingParts: string[];
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
      partCount: magnitudeOr(asQuantityish(e.partCount), 0),
      totalMass: magnitudeOr(asQuantityish(e.totalMass), 0),
      facility: typeof e.facility === "string" ? e.facility : "",
      facilityOrdinal:
        typeof e.facilityOrdinal === "number" ? e.facilityOrdinal : null,
      requiresFunds: magnitudeOr(asQuantityish(e.requiresFunds), 0),
      missingParts: Array.isArray(e.missingParts)
        ? e.missingParts.filter((p): p is string => typeof p === "string")
        : [],
    });
  }
  return out;
}

/**
 * The editor a saved craft launches from, as `ksp.launch` spells it. Resolved
 * from the ORDINAL, never substituted with a default: a default in a dispatched
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

/** A craft the save cannot launch now: parts still locked, or more than the funds on hand. */
export function shipBlocked(ship: SavedShip, fundsAvailable: number): boolean {
  return ship.missingParts.length > 0 || ship.requiresFunds > fundsAvailable;
}
