/**
 * The dashboards the README's hero is drawn from: each a saved layout for the
 * app's own grid, filled by the one committed flight.
 */

import { LAUNCH_UT } from "./heroFlightModel";
import { readHeroFrames } from "./heroFlightWire";
import type { HeroItem, HeroLayoutEntry, HeroSpec } from "./probe/hero-entry";

/** The grid's row pitch in pixels: a row of `ROW_HEIGHT` plus the 8 px gutter. */
export const HERO_ROW_PITCH = 33;
/** The page padding around the grid and the strip the screen keeps above it. */
const SCREEN_GUTTER = 16;
const STRIP = 34;

/** Altitude on the left axis and orbital speed on the right, over the flight so far. */
const FLIGHT_GRAPH = {
  windowSec: 1800,
  variant: "chart",
  series: [
    {
      id: "alt",
      key: "vessel.flight.altitudeAsl",
      label: "Altitude",
      axis: "primary",
    },
    {
      id: "ospd",
      key: "vessel.flight.orbitalSpeed",
      label: "Orbital speed",
      axis: "secondary",
    },
  ],
};

interface Tile {
  id: string;
  widget: string;
  config?: Record<string, unknown>;
  at: readonly [x: number, y: number, w: number, h: number];
}

export interface HeroComposition {
  /** Page width in pixels: it picks the breakpoint and so the column width. */
  width: number;
  rows: number;
  tiles: readonly Tile[];
}

const SYSTEM_VIEW: Tile = {
  id: "system",
  widget: "tracking-station",
  at: [26, 0, 10, 11],
};

export const HERO_COMPOSITIONS: Record<string, HeroComposition> = {
  /** The same flight with Tracking Station and without the camera. */
  systemview: {
    width: 1440,
    rows: 23,
    tiles: [
      { id: "track", widget: "ground-track", at: [0, 0, 16, 11] },
      { id: "orbit", widget: "orbit-view", at: [16, 0, 10, 11] },
      SYSTEM_VIEW,
      {
        id: "graph",
        widget: "graph",
        config: FLIGHT_GRAPH,
        at: [0, 11, 16, 12],
      },
      { id: "fuel", widget: "fuel-status", at: [16, 11, 10, 12] },
      {
        id: "sas",
        widget: "action-group",
        config: { actionGroupId: "SAS" },
        at: [26, 11, 10, 6],
      },
      {
        id: "ag1",
        widget: "action-group",
        config: { actionGroupId: "AG1" },
        at: [26, 17, 10, 6],
      },
    ],
  },
  /** The smaller screen: no camera, the two action groups in their tiny form beside a small Tracking Station. */
  compact: {
    width: 1280,
    rows: 21,
    tiles: [
      { id: "track", widget: "ground-track", at: [0, 0, 22, 10] },
      { id: "orbit", widget: "orbit-view", at: [22, 0, 14, 10] },
      {
        id: "graph",
        widget: "graph",
        config: FLIGHT_GRAPH,
        at: [0, 10, 14, 11],
      },
      { id: "fuel", widget: "fuel-status", at: [14, 10, 12, 11] },
      { id: "system", widget: "tracking-station", at: [26, 10, 6, 11] },
      {
        id: "sas",
        widget: "action-group",
        config: { actionGroupId: "SAS" },
        at: [32, 10, 4, 5],
      },
      {
        id: "ag1",
        widget: "action-group",
        config: { actionGroupId: "AG1" },
        at: [32, 15, 4, 6],
      },
    ],
  },
  /** The same, with Tracking Station wider above the two action groups side by side. */
  compactwide: {
    width: 1280,
    rows: 21,
    tiles: [
      { id: "track", widget: "ground-track", at: [0, 0, 22, 10] },
      { id: "orbit", widget: "orbit-view", at: [22, 0, 14, 10] },
      {
        id: "graph",
        widget: "graph",
        config: FLIGHT_GRAPH,
        at: [0, 10, 14, 11],
      },
      { id: "fuel", widget: "fuel-status", at: [14, 10, 12, 11] },
      { id: "system", widget: "tracking-station", at: [26, 10, 10, 8] },
      {
        id: "sas",
        widget: "action-group",
        config: { actionGroupId: "SAS" },
        at: [26, 18, 5, 3],
      },
      {
        id: "ag1",
        widget: "action-group",
        config: { actionGroupId: "AG1" },
        at: [31, 18, 5, 3],
      },
    ],
  },
};

/** The stage a composition mounts: the saved layout, the chrome asked for and the flight to replay. */
export function heroSpec(name: string, chrome: HeroSpec["chrome"]): HeroSpec {
  const comp = HERO_COMPOSITIONS[name];
  if (!comp) throw new Error(`No hero composition "${name}"`);
  const items: HeroItem[] = comp.tiles.map((t) => ({
    i: t.id,
    componentId: t.widget,
    ...(t.config ? { config: t.config } : {}),
  }));
  const layout: HeroLayoutEntry[] = comp.tiles.map((t) => ({
    i: t.id,
    x: t.at[0],
    y: t.at[1],
    w: t.at[2],
    h: t.at[3],
  }));
  const gridHeight = comp.rows * HERO_ROW_PITCH;
  return {
    width: comp.width,
    height: gridHeight + 2 * SCREEN_GUTTER + (chrome === "today" ? STRIP : 0),
    items,
    layout,
    chrome,
    frames: readHeroFrames(),
    startUt: LAUNCH_UT,
  };
}
