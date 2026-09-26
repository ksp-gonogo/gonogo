import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

export interface LaunchSiteEntry {
  name: string;
  displayName: string;
  facility: string;
  body: string;
  ready: boolean;
  unlocked: boolean;
  /**
   * Whether a vessel is standing on this pad, `null` when this site reports no
   * occupancy at all. The mod reports occupancy for the stock VAB pad alone, so
   * every other site carries `null`, not a claim that it is clear.
   */
  occupied: boolean | null;
  /** The occupying vessel's name; `null` whenever {@link occupied} is not true. */
  occupantName: string | null;
}

function facilityOf(e: Record<string, unknown>): string {
  if (typeof e.facility === "string") return e.facility;
  if (typeof e.editorFacility === "string") return e.editorFacility;
  return "";
}

/**
 * Parse `kc.launchSites`; null when the key is absent so the picker collapses.
 * Accepts the legacy `{ facility, body, ready, unlocked }` shape and the mod's
 * `LaunchSiteEntry` (`editorFacility`, `bodyIndex`, `isStock`). A new-shape
 * entry is selectable: the mod enumerates only sites available to launch from.
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
    // The mod entry has `editorFacility`/`isStock` and no legacy `unlocked` field.
    const isNewShape = !("unlocked" in e) && "editorFacility" in e;
    out.push({
      name,
      displayName:
        typeof e.displayName === "string" && e.displayName
          ? e.displayName
          : name,
      facility: facilityOf(e),
      body: typeof e.body === "string" ? e.body : "",
      ready: e.ready === true,
      unlocked: isNewShape ? true : e.unlocked === true,
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
