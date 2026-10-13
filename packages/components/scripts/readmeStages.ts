/**
 * The stages the README pictures are drawn from: each a set of widgets placed
 * on a grid, fed from committed fixtures and playback models only.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { orbitFirstScene, orbitFrames } from "./mapOrbitModel";
import { ascentFirstScene, ascentFrames } from "./navballAscentModel";
import type { PlaybackFrame } from "./playbackFrame";
import { tilePixels } from "./probe/payload";
import type { StageCell, StageFrame, StageSpec } from "./probe/readme-entry";
import { transferFirstScene, transferFrames } from "./systemTransferModel";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** The dashboard grid's pitch in pixels: one column or row plus its margin. */
const COL_PITCH = 40;
const ROW_PITCH = 33;
const STAGE_PADDING = 24;
const STAGE_GAP = 24;

/** A committed fixture, by widget folder and scene name. */
export function loadFixture(
  folder: string,
  scene: string,
): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(SRC, folder, "__fixtures__", `${scene}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function toStageFrames(frames: readonly PlaybackFrame[]): StageFrame[] {
  return frames.map((f) => ({ ut: f.ut, emits: f.emits }));
}

/** The grid sizes the Navball is shown at, smallest to largest. */
export const NAVBALL_SIZES: ReadonlyArray<{
  w: number;
  h: number;
  config?: Record<string, unknown>;
}> = [
  { w: 3, h: 3 },
  { w: 4, h: 5 },
  { w: 4, h: 7 },
  { w: 5, h: 8 },
  { w: 7, h: 20, config: { controlMode: true } },
];

/**
 * Every Navball size side by side on one ascent: one fixture, one track, so
 * every instance is moved to the same instant by the same step.
 */
export function navballSizesStage(): StageSpec {
  const first = ascentFirstScene();
  const sized = NAVBALL_SIZES.map((s) => ({ ...s, ...tilePixels(s.w, s.h) }));
  const tallest = Math.max(...sized.map((s) => s.pxH));
  let x = STAGE_PADDING;
  const cells: StageCell[] = sized.map((s) => {
    const cell: StageCell = {
      widgetId: "navball",
      fixture: first,
      w: s.w,
      h: s.h,
      config: s.config,
      x,
      y: STAGE_PADDING + tallest - s.pxH,
      track: "ascent",
    };
    x += s.pxW + STAGE_GAP;
    return cell;
  });
  return {
    width: x - STAGE_GAP + STAGE_PADDING,
    height: tallest + 2 * STAGE_PADDING,
    cells,
    tracks: { ascent: toStageFrames(ascentFrames()) },
  };
}

interface Placement {
  widgetId: string;
  folder: string;
  /** A scene the placement is fed instead of a committed fixture. */
  first?: Record<string, unknown>;
  scene: string;
  col: number;
  row: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
  track?: string;
}

function gridStage(
  cols: number,
  rows: number,
  placements: readonly Placement[],
  tracks: StageSpec["tracks"] = {},
  stillAt?: StageSpec["stillAt"],
): StageSpec {
  const { pxW, pxH } = tilePixels(cols, rows);
  return {
    width: pxW + 2 * STAGE_PADDING,
    height: pxH + 2 * STAGE_PADDING,
    cells: placements.map((p) => ({
      widgetId: p.widgetId,
      fixture: p.first ?? loadFixture(p.folder, p.scene),
      w: p.w,
      h: p.h,
      x: STAGE_PADDING + p.col * COL_PITCH,
      y: STAGE_PADDING + p.row * ROW_PITCH,
      config: p.config,
      track: p.track,
    })),
    tracks,
    stillAt,
  };
}

const HERO_COLS = 22;
const HERO_ROWS = 14;

function place(
  widgetId: string,
  folder: string,
  scene: string,
  [col, row, w, h]: readonly [number, number, number, number],
  extra: Partial<Placement> = {},
): Placement {
  return { widgetId, folder, scene, col, row, w, h, ...extra };
}

/** Altitude on the left axis and orbital speed on the right, over the recorded ascent. */
const ASCENT_GRAPH = {
  windowSec: 600,
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

/** The ascent: the navball flies the gravity turn while its neighbours hold the flight's figures. */
function ascentHero(): StageSpec {
  return gridStage(
    HERO_COLS,
    HERO_ROWS,
    [
      place("navball", "Navball", "gravity-turn-east", [0, 0, 7, 14], {
        first: ascentFirstScene(),
        track: "ascent",
      }),
      place("graph", "Graph", "ascent-altitude-velocity", [7, 0, 9, 8], {
        config: ASCENT_GRAPH,
      }),
      place(
        "atmosphere-profile",
        "AtmosphereProfile",
        "kerbin-upper-atmosphere",
        [7, 8, 9, 6],
      ),
      place("twr", "Twr", "atmosphere-ascent-ok", [16, 0, 6, 7]),
      place("thermal-status", "ThermalStatus", "cruise-nominal", [16, 7, 6, 7]),
    ],
    { ascent: toStageFrames(ascentFrames()) },
    { ascent: 0.3 },
  );
}

/** The orbit: the ground track follows a craft round Kerbin while the orbit readouts hold its circular path. */
function orbitHero(): StageSpec {
  return gridStage(
    HERO_COLS,
    HERO_ROWS,
    [
      place(
        "ground-track",
        "GroundTrack",
        "kerbin-lko-equator",
        [0, 0, 12, 8],
        {
          first: orbitFirstScene(),
          track: "orbit",
        },
      ),
      place("current-orbit", "CurrentOrbit", "circular-lko", [0, 8, 12, 6]),
      place("orbit-view", "OrbitView", "lko-circular", [12, 0, 10, 9]),
      place("comm-signal", "CommSignal", "strong-direct-ksc", [12, 9, 10, 5]),
    ],
    { orbit: toStageFrames(orbitFrames()) },
  );
}

/** The transfer: the system view follows a craft out to the Mun above the controls that run the clock and the link. */
function transferHero(): StageSpec {
  return gridStage(
    HERO_COLS,
    16,
    [
      place(
        "system-view",
        "SystemView",
        "kerbin-mun-encounter",
        [0, 0, 22, 9],
        {
          first: transferFirstScene(),
          track: "transfer",
        },
      ),
      place("warp-control", "WarpControl", "realtime-1x", [0, 9, 7, 7]),
      place("comm-signal", "CommSignal", "strong-direct-ksc", [7, 9, 8, 7]),
      place("crew-status", "CrewStatus", "valentina-solo-orbit", [15, 9, 7, 7]),
    ],
    { transfer: toStageFrames(transferFrames()) },
    { transfer: 0.6 },
  );
}

/** The dashboard compositions proposed for the README, by letter. */
export const HERO_STAGES: Record<string, () => StageSpec> = {
  a: ascentHero,
  b: orbitHero,
  c: transferHero,
};
