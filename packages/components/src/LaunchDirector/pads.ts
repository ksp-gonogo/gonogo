import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

export interface LaunchSiteEntry {
  name: string;
  displayName: string;
  facility: string;
  /** The `system.bodies` index of the body the site stands on; `null` when the site reported none. */
  bodyIndex: number | null;
  /**
   * Whether a vessel is standing on this pad, `null` when this site reports no
   * occupancy at all. The mod reports occupancy for the stock VAB pad alone, so
   * every other site carries `null`, not a claim that it is clear.
   */
  occupied: boolean | null;
  /** The occupying vessel's name; `null` whenever {@link occupied} is not true. */
  occupantName: string | null;
}

/**
 * Parse `spaceCenter.launchSites`; null when the channel is absent so the
 * picker collapses. Every entry is selectable: the mod enumerates only the
 * sites available to launch from.
 */
export function parseLaunchSites(raw: unknown): LaunchSiteEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: LaunchSiteEntry[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      displayName:
        typeof e.displayName === "string" && e.displayName
          ? e.displayName
          : name,
      facility: typeof e.editorFacility === "string" ? e.editorFacility : "",
      bodyIndex: typeof e.bodyIndex === "number" ? e.bodyIndex : null,
      // Only a real boolean is an answer; anything else is a site that reported no occupancy.
      occupied: typeof e.padOccupied === "boolean" ? e.padOccupied : null,
      occupantName:
        typeof e.padVesselTitle === "string" && e.padVesselTitle
          ? e.padVesselTitle
          : null,
    });
  }
  return out;
}

/**
 * The pads, with the ones holding a REPORTED vessel first, stable otherwise.
 * An unreported pad keeps its place, so silence never outranks the stock pad
 * that answers.
 */
export function orderPads(
  sites: readonly LaunchSiteEntry[],
): LaunchSiteEntry[] {
  return [...sites].sort(
    (a, b) => (a.occupied === true ? 0 : 1) - (b.occupied === true ? 0 : 1),
  );
}

/**
 * The name of every body a pad can stand on that is not the home world, by
 * index. The home world is the unmarked case, so it is left out; a body whose
 * home flag is unreported keeps its name, since naming it is still true.
 */
export function awayBodyNames(
  bodies: readonly {
    index: number;
    name?: string | null;
    isHome?: boolean | null;
  }[],
): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  for (const body of bodies) {
    if (!body.name || body.isHome === true) continue;
    out.set(body.index, body.name);
  }
  return out;
}

/** The body a pad names beside its kind: only one resolved and away from home, never a guess. */
export function padBodyName(
  site: LaunchSiteEntry,
  awayBodies: ReadonlyMap<number, string>,
): string | null {
  if (site.bodyIndex === null) return null;
  return awayBodies.get(site.bodyIndex) ?? null;
}

/** What a site's `EditorFacility` makes it, in the operator's words. */
export function padKindLabel(facility: string): string {
  if (facility === "VAB") return "Pad";
  if (facility === "SPH") return "Runway";
  return facility || NULL_DISPLAY;
}

// "all clear" needs every pad to have answered; otherwise it is a count of those that did.
function clearanceTerm(
  pads: number,
  occupied: number,
  unreported: number,
): string {
  if (occupied > 0) return `${occupied} occupied`;
  if (unreported === 0) return "all clear";
  return `${pads - unreported} clear`;
}

/** The subtitle's account of the pads; every pad silent about occupancy is not every pad clear. */
export function padSummary({
  pads,
  occupied,
  unreported,
}: {
  pads: number;
  occupied: number;
  unreported: number;
}): string {
  if (pads === 0) return "No pads";
  const label = `${pads} pad${pads === 1 ? "" : "s"}`;
  if (unreported === pads) return `${label} · occupancy unreported`;
  const parts = [label, clearanceTerm(pads, occupied, unreported)];
  if (unreported > 0) parts.push(`${unreported} unreported`);
  return parts.join(" · ");
}

/** What is standing on this pad, including the case where nobody said. */
export function occupancyText(site: LaunchSiteEntry): string {
  if (site.occupied === true) {
    return `On pad: ${site.occupantName ?? NULL_DISPLAY}`;
  }
  if (site.occupied === false) return "Clear";
  return "Occupancy unreported";
}
