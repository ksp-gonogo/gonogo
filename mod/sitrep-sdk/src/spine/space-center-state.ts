import { registerTopicUnits, type SitrepUnit } from "../units";
import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

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
 * The `spaceCenter.state` derived channel: the pad-occupancy scalars behind
 * the legacy `kc.padOccupied` / `kc.padVesselTitle` keys. The mod
 * already carries per-site occupancy on `spaceCenter.launchSites`
 * (`LaunchSiteEntry.padOccupied` is non-null only on the stock KSC pad, there
 * is no clean stock per-site occupancy API, so it rides the one pad), so this
 * derives the two vessel-independent scalars off that array rather than the mod
 * duplicating them onto a second channel. Vessel-independent, ground-side facts,
 * the same lifetime as `spaceCenter.launchSites` itself, matching the legacy
 * keys' scope.
 */
export interface SpaceCenterState {
  /**
   * Whether the ACTIVE VESSEL is sitting on the stock KSC pad in `PRELAUNCH`,
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
 * `spaceCenter.state` derivation. `undefined` while `spaceCenter.launchSites`
 * hasn't arrived (still resyncing); `null` when it's a confirmed tombstone;
 * otherwise the pad-occupancy pair pulled from the stock-pad entry (the one
 * carrying a non-null `padOccupied`). A pad reported clear reads as
 * `{ padOccupied: false, padVesselTitle: null }`; a list carrying no
 * occupancy at all reads `padOccupied: null`. Never throws.
 */
export function deriveSpaceCenterState(
  get: DerivedGet,
): SpaceCenterState | null | undefined {
  const point = get<LaunchSiteWireEntry[]>("spaceCenter.launchSites");
  if (!point) return undefined;
  if (point.payload === null) return null;

  const sites = Array.isArray(point.payload) ? point.payload : [];
  // The stock pad is the only entry that reports occupancy (padOccupied
  // non-null); every other site carries null there.
  const pad = sites.find(
    (s) => s && typeof s === "object" && typeof s.padOccupied === "boolean",
  );

  return {
    // No entry carried occupancy at all: nothing to report, which is not the
    // same answer as a pad reported clear and must not collapse into it.
    padOccupied: pad ? pad.padOccupied === true : null,
    padVesselTitle:
      typeof pad?.padVesselTitle === "string" ? pad.padVesselTitle : null,
  };
}

/**
 * Ready-to-register definition: `store.registerDerivedChannel(spaceCenterStateChannel)`.
 * `fields: true` exposes `spaceCenter.state.padOccupied` /
 * `spaceCenter.state.padVesselTitle`. `deriveStatus` omitted: the default
 * (worst status across the single `spaceCenter.launchSites` input) is right for
 * a single-input passthrough.
 */
export const spaceCenterStateChannel: DerivedChannelDefinition<SpaceCenterState> =
  {
    topic: "spaceCenter.state",
    inputs: ["spaceCenter.launchSites"],
    derive: deriveSpaceCenterState,
    fields: true,
  };

/**
 * What each `spaceCenter.state` field MEANS, in the contract's own unit
 * vocabulary. This channel is derived client-side, so the unit-map codegen has
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
