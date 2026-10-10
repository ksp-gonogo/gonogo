import { getContributionsForSlot, registerStockBodies } from "@ksp-gonogo/core";
import { type TopicId, value, wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
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
import { emitsOf, playbackOf, type StoryWorld } from "./landingPlaybackModel";

/**
 * Every story played frame by frame through the widget's own plots, as an operator watches it: nothing on screen may jump further between two frames than the craft itself moved.
 * A jump the craft's motion does not explain is the window re-anchoring, or the fixture's own figures leaping, and either reads as a glitch.
 */
registerStockBodies();

/** How far the picture may re-frame itself between two frames on top of the craft's own motion, as a share of the frame: the window follows the craft smoothly, a few tenths of a percent a frame. */
const REFRAME_ALLOWANCE = 0.015;

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
];

/** Each Topic a frame sends, as a contribution's `compute` is handed it: the payload in its units, current. */
function topicsOf(frame: Frame, world: StoryWorld): Record<string, unknown> {
  const topics: Record<string, unknown> = {};
  for (const e of emitsOf(frame, world)) {
    topics[e.channel] = {
      state: "observed",
      value: wrapTopicPayload<unknown>(
        e.channel as TopicId,
        structuredClone(e.value),
      ),
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
  }));

  it.each([
    ["the cross-section", "cross", "vessel"],
    ["the touchdown plot", "site", "vessel"],
    ["the touchdown plot", "site", "site"],
  ] as const)("never jumps %s's %s further than the craft moved", (_plot, key, mark) => {
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
      ).toBeLessThanOrEqual(explained + REFRAME_ALLOWANCE);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("keeps the touchdown plot closing in to the ground: no two frames in a row of the descent show the same window", () => {
    const shown = plots.filter((p) => p.site != null);
    expect(shown.length).toBeGreaterThan(10);
    for (let i = 1; i < shown.length; i++) {
      const before = shown[i - 1].site?.frame.xDomain;
      const after = shown[i].site?.frame.xDomain;
      if (shown[i].frame.aglMeters === shown[i - 1].frame.aglMeters) continue;
      expect(
        after,
        `frame ${i} at ${shown[i].frame.aglMeters.toFixed(1)} m`,
      ).not.toEqual(before);
    }
  });

  it("never widens the dispersion ring while the craft comes down", () => {
    const radii = plots
      .map((p) => p.site?.layers.find((l) => l.id === "landing-zone")?.points)
      .filter((points) => points != null)
      .map((points) => Math.max(...points.map((p) => Math.hypot(p.x, p.y))));
    expect(radii.length).toBeGreaterThan(10);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i], `frame ${i}`).toBeLessThanOrEqual(radii[i - 1] + 1e-6);
    }
  });
});
