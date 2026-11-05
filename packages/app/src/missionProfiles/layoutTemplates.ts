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
  /** Builds the tile's config, so ids inside it are fresh for every layout made. */
  config?: () => Record<string, unknown>;
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

const actionGroup = (actionGroupId: string) => () => ({ actionGroupId });

const altitudeGraph = () => ({
  series: [
    {
      id: safeRandomUuid(),
      key: "vessel.flight.altitudeTerrain",
      type: "line",
      axis: "auto",
    },
    {
      id: safeRandomUuid(),
      key: "vessel.flight.altitudeAsl",
      type: "line",
      axis: "auto",
    },
  ],
  windowSec: 300,
  xKey: "$time",
  yScalePrimary: "linear",
  yScaleSecondary: "linear",
  thresholds: [],
  variant: "auto",
});

/**
 * Flight: attitude, orbit, ground track, landing, fuel, science and the
 * controls a pilot reaches for in the air (action groups, time warp).
 */
export const FLIGHT_TEMPLATE: LayoutTemplate = {
  name: "Flight",
  summary: "Navball, orbit, ground track, landing, fuel and action groups",
  scenes: ["Flight"],
  tiles: [
    { componentId: "navball", x: 20, y: 0, w: 6, h: 14 },
    { componentId: "twr", x: 19, y: 26, w: 4, h: 5 },
    { componentId: "orbit-view", x: 0, y: 14, w: 7, h: 12 },
    { componentId: "comm-signal", x: 0, y: 8, w: 3, h: 6 },
    {
      componentId: "action-group",
      x: 0,
      y: 0,
      w: 3,
      h: 4,
      config: actionGroup("Stage"),
    },
    { componentId: "warp-control", x: 26, y: 0, w: 5, h: 14 },
    { componentId: "fuel-status", x: 0, y: 26, w: 6, h: 14 },
    { componentId: "objectives", x: 31, y: 0, w: 5, h: 14, config: () => ({}) },
    {
      componentId: "ground-track",
      x: 3,
      y: 0,
      w: 17,
      h: 14,
      config: () => ({ trajectoryLength: 2000, showPrediction: true }),
    },
    {
      componentId: "graph",
      x: 23,
      y: 14,
      w: 13,
      h: 12,
      config: altitudeGraph,
    },
    {
      componentId: "action-group",
      x: 0,
      y: 4,
      w: 3,
      h: 4,
      config: actionGroup("AG1"),
    },
    {
      componentId: "landing-status",
      x: 7,
      y: 14,
      w: 16,
      h: 12,
      config: () => ({}),
    },
    {
      componentId: "science-data",
      x: 6,
      y: 26,
      w: 13,
      h: 14,
      config: () => ({}),
    },
    { componentId: "ship-map", x: 23, y: 26, w: 13, h: 14, config: () => ({}) },
  ],
};

/**
 * Space Center: contracts, the buildings of the base, the fleet in the
 * tracking station, research and science. One layout serves all three scenes
 * because none of them has a vessel to fly.
 */
export const SPACE_CENTRE_TEMPLATE: LayoutTemplate = {
  name: "Space Center",
  summary: "Base status, buildings, tracking, research and contracts",
  scenes: ["SpaceCenter", "TrackingStation", "Editor"],
  tiles: [
    { componentId: "space-center-status", x: 18, y: 27, w: 18, h: 17 },
    { componentId: "contract-manager", x: 0, y: 0, w: 8, h: 12 },
    { componentId: "tracking-station", x: 8, y: 12, w: 19, h: 15 },
    {
      componentId: "administration-building",
      x: 15,
      y: 0,
      w: 12,
      h: 12,
      config: () => ({}),
    },
    {
      componentId: "astronaut-complex",
      x: 0,
      y: 12,
      w: 8,
      h: 15,
      config: () => ({}),
    },
    {
      componentId: "launch-director",
      x: 8,
      y: 0,
      w: 7,
      h: 12,
      config: () => ({}),
    },
    {
      componentId: "research-and-development",
      x: 0,
      y: 27,
      w: 18,
      h: 17,
      config: () => ({}),
    },
    {
      componentId: "science-data",
      x: 27,
      y: 0,
      w: 9,
      h: 27,
      config: () => ({}),
    },
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
  for (const { componentId, config, ...place } of template.tiles) {
    const i = safeRandomUuid();
    items.push(
      config ? { i, componentId, config: config() } : { i, componentId },
    );
    layout.push({ i, ...place, moved: false, static: false });
  }
  return { items, layout };
}
