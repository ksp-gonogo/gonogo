import { registerTopicUnits, type SitrepUnit } from "../units";
import { CORE_UPLINK_CLIENT } from "./uplink-clients";

/**
 * One entry of the `spaceCenter.launchSites` wire array
 * (`mod/Sitrep.Contract/SpaceCenterPayloads.cs`'s `LaunchSiteEntry`). Only the
 * two occupancy fields matter here; the rest of the entry is read wholesale by
 * LaunchDirector off the same channel.
 */
interface LaunchSiteWireEntry {
  padOccupied?: boolean | null;
  padVesselTitle?: string | null;
}

/**
 * The `spaceCenter.state` published processor: the two pad-occupancy facts, whether
 * the launch pad is occupied and the title of the vessel on it. Useful for
 * showing the operator whether the pad is clear at the space centre. Used by the
 * space centre status widget and the game context hook.
 *
 * Both are ground-side and independent of the active vessel, with the same
 * lifetime as `spaceCenter.launchSites`. They are derived from that array because
 * the mod carries per-site occupancy there, and `LaunchSiteEntry.padOccupied` is
 * non-null only on the stock pad: stock KSP has no per-site occupancy.
 */
export interface SpaceCenterState {
  /**
   * Whether the active vessel is sitting on the stock KSC pad in `PRELAUNCH`,
   * old `kc.padOccupied`. Despite the name this is not pad tenancy: the mod
   * derives it from the reported active vessel's `situation`, so a craft parked
   * on the pad while you are in the Space Centre scene reads `false`, and a
   * `true` implies the flight scene.
   *
   * `null` when the launch-site list arrived carrying no occupancy at all,
   * which is a different fact from a pad reported clear.
   */
  padOccupied: boolean | null;
  /** Name of the vessel occupying the pad, or null when it's clear, old `kc.padVesselTitle`. */
  padVesselTitle: string | null;
}

/**
 * Derives `spaceCenter.state` from `spaceCenter.launchSites`. Useful for showing
 * the operator whether the pad is occupied. Used by {@link SPACE_CENTER_STATE}.
 *
 * The result is `undefined` while `spaceCenter.launchSites` has not arrived (still
 * resyncing) and `null` when it is a confirmed tombstone; otherwise it is the
 * pad-occupancy pair from the stock-pad entry (the one carrying a non-null
 * `padOccupied`). A pad reported clear reads as `{ padOccupied: false,
 * padVesselTitle: null }`; a list carrying no occupancy at all reads `padOccupied:
 * null`. Never throws.
 */
export function deriveSpaceCenterState(
  launchSites: readonly LaunchSiteWireEntry[] | null | undefined,
): SpaceCenterState | null | undefined {
  if (launchSites === undefined) return undefined;
  if (launchSites === null) return null;

  const sites = Array.isArray(launchSites) ? launchSites : [];
  // The stock pad is the only entry that reports occupancy (padOccupied non-null); every other site carries null there.
  const pad = sites.find(
    (s) => s && typeof s === "object" && typeof s.padOccupied === "boolean",
  );

  return {
    // No entry carried occupancy at all: nothing to report, which is not the same answer as a pad reported clear and must not collapse into it.
    padOccupied: pad ? pad.padOccupied === true : null,
    padVesselTitle:
      typeof pad?.padVesselTitle === "string" ? pad.padVesselTitle : null,
  };
}

/**
 * The processor published as `spaceCenter.state`. Useful for making pad occupancy
 * readable by widgets. `fields` exposes `spaceCenter.state.padOccupied` and
 * `spaceCenter.state.padVesselTitle`. Its status is its single
 * `spaceCenter.launchSites` input's.
 */
export const SPACE_CENTER_STATE = CORE_UPLINK_CLIENT.registerProcessor({
  id: "space-center-state",
  topic: "spaceCenter.state",
  fields: true,
  deps: ["spaceCenter.launchSites"],
  compute: ([launchSites]) => deriveSpaceCenterState(launchSites),
});

/**
 * What each `spaceCenter.state` field means, in the contract's own unit
 * vocabulary. This Topic is computed client-side, so the unit-map codegen has
 * no type to reflect over and a key picker built on the generated maps would
 * find nothing to offer under it.
 *
 * `Record<keyof SpaceCenterState, ...>` so the compiler keeps it complete: a
 * field added above fails the build until it is described here.
 */
const SPACE_CENTER_STATE_UNITS: Readonly<
  Record<keyof SpaceCenterState, SitrepUnit>
> = {
  padOccupied: "flag",
  padVesselTitle: "text",
};

registerTopicUnits("spaceCenter.state", SPACE_CENTER_STATE_UNITS);
