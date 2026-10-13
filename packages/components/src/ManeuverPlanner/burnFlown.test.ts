import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { describe, expect, it } from "vitest";
import {
  type BurnContext,
  type BurnWatch,
  burnFlown,
  burnPhase,
  type OrbitShape,
  orbitShape,
  shapesDiffer,
  watchBurn,
} from "./burnFlown";

const BEFORE: OrbitShape = orbitShape(700_000, 0.01, 0);
const AFTER: OrbitShape = orbitShape(900_000, 0.2, 0);

function patchOf(shape: OrbitShape) {
  return {
    sma: shape.sma,
    ecc: shape.ecc,
    inc: shape.inc,
  };
}

function node(
  over: Partial<ParsedManeuverNode> & { target?: OrbitShape } = {},
): ParsedManeuverNode {
  const { target, ...rest } = over;
  return {
    id: "n",
    UT: 1000,
    deltaV: [0, 0, 30],
    frame: null,
    deltaVMagnitude: 30,
    ignitionUt: 990,
    cutoffUt: 1010,
    orbitPatches: [patchOf(target ?? AFTER)] as never,
    ...rest,
  };
}

const IDLE = { thrusting: false, lastThrustEndUt: null };
const ctx = (over: Partial<BurnContext>): BurnContext => ({
  nowUt: 500,
  current: BEFORE,
  thrust: IDLE,
  ...over,
});

/** Runs the watch through successive contexts, as the tracker does on each sample. */
function run(n: ParsedManeuverNode, steps: BurnContext[]): BurnWatch {
  let watch: BurnWatch | undefined;
  for (const step of steps) watch = watchBurn(watch, n, step);
  return watch as BurnWatch;
}

const FLOWN_STEPS = [
  ctx({ nowUt: 500 }),
  ctx({ nowUt: 995, thrust: { thrusting: true, lastThrustEndUt: null } }),
  ctx({
    nowUt: 1012,
    current: AFTER,
    thrust: { thrusting: false, lastThrustEndUt: 1009 },
  }),
];

describe("burnFlown", () => {
  it("is true for a burn that was seen to differ, was thrust on, and now matches its target", () => {
    const n = node();
    const watch = run(n, FLOWN_STEPS);
    expect(burnFlown(watch, n, FLOWN_STEPS[2])).toBe(true);
  });

  it("is false for a node trimmed to almost nothing, however the clock and engines move", () => {
    const planned = node();
    const trimmed = node({
      deltaV: [0, 0, 0.3],
      deltaVMagnitude: 0.3,
      // Within tolerance of where the craft already is.
      target: orbitShape(700_100, 0.01, 0),
    });
    let watch = run(planned, [ctx({ nowUt: 400 })]);
    watch = watchBurn(watch, trimmed, ctx({ nowUt: 500 }));
    const late = ctx({
      nowUt: 1012,
      thrust: { thrusting: false, lastThrustEndUt: 1009 },
    });
    watch = watchBurn(watch, trimmed, late);
    expect(burnFlown(watch, trimmed, late)).toBe(false);
  });

  it("is false for a node whose time passed with no thrust", () => {
    const n = node();
    const late = ctx({ nowUt: 1012 });
    const watch = run(n, [ctx({ nowUt: 500 }), late]);
    expect(burnFlown(watch, n, late)).toBe(false);
  });

  it("is false for a burn stopped short of its target", () => {
    const n = node();
    const stopped = ctx({
      nowUt: 1012,
      current: orbitShape(800_000, 0.1, 0),
      thrust: { thrusting: false, lastThrustEndUt: 1004 },
    });
    const watch = run(n, [ctx({ nowUt: 500 }), stopped]);
    expect(burnFlown(watch, n, stopped)).toBe(false);
  });

  it("is false while the engines are still lit, even on target", () => {
    const n = node();
    const lit = ctx({
      nowUt: 1012,
      current: AFTER,
      thrust: { thrusting: true, lastThrustEndUt: null },
    });
    const watch = run(n, [ctx({ nowUt: 500 }), lit]);
    expect(burnFlown(watch, n, lit)).toBe(false);
  });

  it("is false when the plan was first seen after ignition, since its target cannot be trusted then", () => {
    const n = node();
    const mid = ctx({
      nowUt: 995,
      thrust: { thrusting: true, lastThrustEndUt: null },
    });
    const done = ctx({
      nowUt: 1012,
      current: AFTER,
      thrust: { thrusting: false, lastThrustEndUt: 1009 },
    });
    const watch = run(n, [mid, done]);
    expect(burnFlown(watch, n, done)).toBe(false);
  });

  it("holds the target taken before ignition when the solver re-solves the patch during the burn", () => {
    const n = node();
    const resolved = node({ target: orbitShape(1_100_000, 0.4, 0) });
    let watch = run(n, FLOWN_STEPS.slice(0, 2));
    watch = watchBurn(watch, resolved, FLOWN_STEPS[2]);
    expect(burnFlown(watch, resolved, FLOWN_STEPS[2])).toBe(true);
  });

  it("is false without a burn-duration model, since nothing says when the burn ended", () => {
    const n = node({ ignitionUt: null, cutoffUt: null });
    const watch = run(n, FLOWN_STEPS);
    expect(burnFlown(watch, n, FLOWN_STEPS[2])).toBe(false);
  });

  it("is false without a thrust observation or a current orbit", () => {
    const n = node();
    const blind = ctx({ nowUt: 1012, current: null, thrust: undefined });
    const watch = run(n, [ctx({ nowUt: 500 }), blind]);
    expect(burnFlown(watch, n, blind)).toBe(false);
  });
});

describe("a plan whose quantities arrived as plain JSON", () => {
  it("is read like any other, without throwing", () => {
    const plain = {
      ...node(),
      orbitPatches: [
        {
          sma: { magnitude: 900_000, unit: "m" },
          ecc: { magnitude: 0.2, unit: "1" },
          inc: { magnitude: 0, unit: "°" },
        },
      ] as never,
    };
    const watch = run(plain, FLOWN_STEPS);
    expect(burnFlown(watch, plain, FLOWN_STEPS[2])).toBe(true);
  });
});

describe("shapesDiffer", () => {
  it("tolerates a delta-v error of about a metre per second and no more", () => {
    expect(shapesDiffer(BEFORE, orbitShape(700_400, 0.01, 0))).toBe(false);
    expect(shapesDiffer(BEFORE, orbitShape(702_000, 0.01, 0))).toBe(true);
    expect(shapesDiffer(BEFORE, orbitShape(700_000, 0.0115, 0))).toBe(false);
    expect(shapesDiffer(BEFORE, orbitShape(700_000, 0.02, 0))).toBe(true);
    expect(shapesDiffer(BEFORE, orbitShape(700_000, 0.01, 0.05))).toBe(false);
    expect(shapesDiffer(BEFORE, orbitShape(700_000, 0.01, 0.5))).toBe(true);
  });
});

describe("burnPhase", () => {
  const n = node();
  const watch = run(n, [ctx({ nowUt: 500 })]);

  it("is unknown without a burn-duration model or a clock", () => {
    const bare = node({ ignitionUt: null, cutoffUt: null });
    expect(burnPhase(watch, bare, ctx({}))).toBe("unknown");
    expect(burnPhase(watch, n, ctx({ nowUt: null }))).toBe("unknown");
  });

  it("is not-started before ignition and while no thrust has been seen", () => {
    expect(burnPhase(watch, n, ctx({ nowUt: 500 }))).toBe("not-started");
    expect(burnPhase(watch, n, ctx({ nowUt: 1012 }))).toBe("not-started");
  });

  it("is in-progress while thrusting and stopped-short once thrust ceased off target", () => {
    expect(
      burnPhase(
        watch,
        n,
        ctx({
          nowUt: 995,
          thrust: { thrusting: true, lastThrustEndUt: null },
        }),
      ),
    ).toBe("in-progress");
    expect(
      burnPhase(
        watch,
        n,
        ctx({
          nowUt: 1000,
          thrust: { thrusting: false, lastThrustEndUt: 998 },
        }),
      ),
    ).toBe("stopped-short");
  });

  it("is delivered only when the burn was flown", () => {
    const w = run(n, FLOWN_STEPS);
    expect(burnPhase(w, n, FLOWN_STEPS[2])).toBe("delivered");
  });

  it("is unknown without a thrust observation", () => {
    expect(burnPhase(watch, n, ctx({ nowUt: 995, thrust: undefined }))).toBe(
      "unknown",
    );
  });
});
