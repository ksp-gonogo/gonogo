import { safeRandomUuid } from "@ksp-gonogo/core";
import type { LayoutItem } from "react-grid-layout";
import type { DashboardItem } from "../components/Dashboard";
import type { BindableScene } from "./MissionProfilesService";
import type { DashboardSnapshot } from "./ProfileDashboard";

interface TemplateTile {
  componentId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A starter layout: the built-in widgets it places and the scenes it follows. */
export interface LayoutTemplate {
  /** The name the new layout is given. */
  name: string;
  /** What the starter is for, in a few words, shown beside its button. */
  summary: string;
  scenes: readonly BindableScene[];
  tiles: readonly TemplateTile[];
}

/**
 * Flight: attitude, orbit, propulsion and the controls a pilot reaches for
 * in the air (navball, orbit view, fuel, thrust-to-weight, signal, action
 * groups and time warp).
 */
export const FLIGHT_TEMPLATE: LayoutTemplate = {
  name: "Flight",
  summary: "Navball, orbit, fuel, signal and action groups",
  scenes: ["Flight"],
  tiles: [
    { componentId: "navball", x: 0, y: 0, w: 8, h: 11 },
    { componentId: "twr", x: 0, y: 11, w: 8, h: 5 },
    { componentId: "orbit-view", x: 8, y: 0, w: 9, h: 18 },
    { componentId: "comm-signal", x: 17, y: 0, w: 6, h: 8 },
    { componentId: "action-group", x: 17, y: 8, w: 6, h: 6 },
    { componentId: "warp-control", x: 17, y: 14, w: 6, h: 5 },
    { componentId: "fuel-status", x: 23, y: 0, w: 8, h: 14 },
  ],
};

/**
 * Space Centre: the status of the base, the fleet in the tracking station,
 * the craft catalogue for the editor, open contracts and time warp. One
 * layout serves all three scenes because none of them has a vessel to fly.
 */
export const SPACE_CENTRE_TEMPLATE: LayoutTemplate = {
  name: "Space Centre",
  summary: "Base status, tracking, craft catalogue and contracts",
  scenes: ["SpaceCenter", "TrackingStation", "Editor"],
  tiles: [
    { componentId: "space-center-status", x: 0, y: 0, w: 6, h: 7 },
    { componentId: "warp-control", x: 0, y: 7, w: 6, h: 5 },
    { componentId: "contract-manager", x: 0, y: 12, w: 6, h: 8 },
    { componentId: "tracking-station", x: 6, y: 0, w: 10, h: 12 },
    { componentId: "vessel-catalog", x: 16, y: 0, w: 8, h: 10 },
  ],
};

/** The two layouts "Add default layouts" creates. */
export const DEFAULT_TEMPLATES: readonly LayoutTemplate[] = [
  FLIGHT_TEMPLATE,
  SPACE_CENTRE_TEMPLATE,
];

/** The dashboard a template places, with a fresh id for every tile. */
export function snapshotOf(template: LayoutTemplate): DashboardSnapshot {
  const items: DashboardItem[] = [];
  const layout: LayoutItem[] = [];
  for (const { componentId, ...place } of template.tiles) {
    const i = safeRandomUuid();
    items.push({ i, componentId });
    layout.push({ i, ...place, moved: false, static: false });
  }
  return { items, layout };
}
