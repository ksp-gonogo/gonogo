import { getContributionsForSlot, registerStockBodies } from "@ksp-gonogo/core";
import { type TopicId, value, wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  EVE_AIR,
  integrateAtmosphere,
  LOW_DESCENT,
} from "../../components/scripts/landingAtmosphereModel";
import {
  DEG,
  type Frame,
  integrate,
  R,
  SHALLOW_DESCENT,
} from "../../components/scripts/landingDescentModel";
// The widget's own plots, registered as its import registers them.
import "../../components/src/LandingStatus/descentLayers";
import "../../components/src/LandingStatus/crossSectionPlot";
import "../../components/src/LandingStatus/touchdownReticlePlot";
import "../../components/src/LandingStatus/vesselViewPlot";
import { emitsOf, playbackOf, type StoryWorld } from "./landingPlaybackModel";

/**
 * Every story played frame by frame through the widget's own plots, as an operator watches it: nothing on screen may jump further between two frames than the craft itself moved.
 * A jump the craft's motion does not explain is the window re-anchoring, or the fixture's own figures leaping, and either reads as a glitch. The touchdown view is a camera aimed at the site, so its mark never leaves the middle and its field of view only narrows.
 */
registerStockBodies();

/** How far the picture may re-frame itself between two frames on top of the craft's own motion, as a share of the frame: the window follows the craft smoothly, a few tenths of a percent a frame. */
const REFRAME_ALLOWANCE = 0.015;

/** The same for the touchdown map, whose window is the frame's footprint and so closes in with the field of view as well as following the craft: a few percent a frame at the one-second steps of the high descent, a few tenths at the pace it is played. */
const MAP_REFRAME_ALLOWANCE = 0.04;

const STORIES: readonly [string, readonly Frame[], boolean, StoryWorld][] = [
  ["the crash", integrate({ crash: true }), true, "mun"],
  ["the safe landing", integrate(), false, "mun"],
  ["the shallow approach", integrate({ start: SHALLOW_DESCENT }), false, "mun"],
  [
    "the atmospheric approach",
    integrateAtmosphere({ ocean: false }),
    false,
    "kerbin-land",
  ],
  [
    "the ocean landing",
    integrateAtmosphere({ ocean: true }, LOW_DESCENT),
    false,
    "kerbin-ocean",
  ],
  [
    "the Eve ocean landing",
    integrateAtmosphere({ ocean: true, body: EVE_AIR }, LOW_DESCENT),
    false,
    "eve-ocean",
  ],
];

/** Each Topic a frame sends, as a contribution's `compute` is handed it: the payload in its units, current. */
function topicsOf(
  frame: Frame,
  world: StoryWorld,
  roll = 0,
): Record<string, unknown> {
  // Nothing is on record as a crash while a descent is in flight.
  const topics: Record<string, unknown> = {
    "crash.lastCrash": { state: "absent", atUt: value("ut", 100) },
    "crash.hasRecent": { state: "absent", atUt: value("ut", 100) },
  };
  for (const e of emitsOf(frame, world)) {
    const cloned = structuredClone(e.value);
    const payload: Record<string, unknown> =
      typeof cloned === "object" && cloned !== null ? { ...cloned } : {};
    if (e.channel === "vessel.attitude") {
      payload.roll = roll;
      payload.rollRootFrame = roll;
    }
    topics[e.channel] = {
      state: "observed",
      value: wrapTopicPayload<unknown>(e.channel as TopicId, payload),
      atUt: value("ut", 100),
      reckoning: { status: "none" },
    };
  }
  return topics;
}

interface Drawn {
  frame: { xDomain: [number, number]; yDomain: [number, number] };
  layers: {
    id: string;
    kind: string;
    at?: { x: number; y: number };
    points?: { x: number; y: number }[];
  }[];
}

function plotOf(id: string, topics: Record<string, unknown>): Drawn | null {
  const contribution = getContributionsForSlot("plots").find(
    (c) => c.id === id,
  );
  if (!contribution) throw new Error(`the ${id} contribution is missing`);
  const out = contribution.compute(topics) as Drawn[] | null;
  return out?.[0] ?? null;
}

/** Where a mark is drawn, as a share of the frame each way. */
function onScreen(plot: Drawn, mark: string): { x: number; y: number } | null {
  const at = plot.layers.find((l) => l.id === mark)?.at;
  if (!at) return null;
  const [x0, x1] = plot.frame.xDomain;
  const [y0, y1] = plot.frame.yDomain;
  return { x: (at.x - x0) / (x1 - x0), y: (at.y - y0) / (y1 - y0) };
}

/** How far the craft moved between two frames, metres: along the ground and in height. */
function travelled(a: Frame, b: Frame): number {
  return Math.hypot((b.lon - a.lon) * DEG * R, b.aglMeters - a.aglMeters);
}

describe.each(STORIES)("%s, frame by frame", (_name, all, crash, world) => {
  const { played } = playbackOf(all, crash);
  const flying = played.filter((f) => !f.landed);
  const plots = flying.map((f) => ({
    frame: f,
    cross: plotOf("core:cross-section", topicsOf(f, world)),
    site: plotOf("core:touchdown-reticle", topicsOf(f, world)),
    view: plotOf("core:vessel-view", topicsOf(f, world)),
  }));

  it.each([
    ["the cross-section", "cross", "vessel"],
    ["the touchdown map", "site", "vessel"],
    ["the touchdown map", "site", "site"],
  ] as const)("never jumps %s's %s further than the craft moved", (plot, key, mark) => {
    let checked = 0;
    for (let i = 1; i < plots.length; i++) {
      const before = plots[i - 1][key];
      const after = plots[i][key];
      if (!before || !after) continue;
      const a = onScreen(before, mark);
      const b = onScreen(after, mark);
      if (!a || !b) continue;
      const span = before.frame.xDomain[1] - before.frame.xDomain[0];
      const explained = travelled(plots[i - 1].frame, plots[i].frame) / span;
      expect(
        Math.hypot(b.x - a.x, b.y - a.y),
        `frame ${i} (t=${plots[i].frame.t.toFixed(1)} s, ${plots[i].frame.aglMeters.toFixed(0)} m up)`,
      ).toBeLessThanOrEqual(
        explained +
          (plot === "the touchdown map"
            ? MAP_REFRAME_ALLOWANCE
            : REFRAME_ALLOWANCE),
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("draws the same three plots whatever the vessel's roll", () => {
    for (const f of flying.filter((_, i) => i % 3 === 0)) {
      for (const id of [
        "core:cross-section",
        "core:touchdown-reticle",
        "core:vessel-view",
      ]) {
        expect(
          JSON.stringify(plotOf(id, topicsOf(f, world, 63))),
          `${id} at t=${f.t.toFixed(1)} s`,
        ).toBe(JSON.stringify(plotOf(id, topicsOf(f, world, 0))));
      }
    }
  }, 60_000);

  it("slides the ground lattice under the craft: the dots move across the map while the craft moves", () => {
    const dotsAt = (i: number) =>
      plots[i].site?.layers.find((l) => l.id === "lattice-dots");
    let moved = 0;
    for (let i = 1; i < plots.length; i++) {
      const before = dotsAt(i - 1)?.points;
      const after = dotsAt(i)?.points;
      if (before && after && before.length === after.length) {
        const shift = before.some(
          (p, k) =>
            Math.abs(p.x - after[k].x) + Math.abs(p.y - after[k].y) > 1e-6,
        );
        if (shift) moved++;
      }
    }
    expect(moved).toBeGreaterThan(5);
  });

  it("narrows the vessel view's field of view as the craft comes down, and never widens it", () => {
    const fovs = plots.flatMap((p) => {
      const layer = p.view?.layers.find((l) => l.id === "fov");
      return layer && "text" in layer && typeof layer.text === "string"
        ? [Number.parseFloat(layer.text.slice(4))]
        : [];
    });
    expect(fovs.length).toBeGreaterThan(10);
    for (let i = 1; i < fovs.length; i++) {
      expect(fovs[i], `frame ${i}`).toBeLessThanOrEqual(fovs[i - 1]);
    }
    expect(fovs[fovs.length - 1]).toBeLessThan(fovs[0] - 20);
  });
});
