import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { describe, expect, it } from "vitest";
import {
  type CompletedEntry,
  computeCompletionUpdate,
} from "./BurnCompletionTracker";
import {
  type BurnContext,
  type BurnWatch,
  type OrbitShape,
  orbitShape,
} from "./burnFlown";

const BEFORE: OrbitShape = orbitShape(700_000, 0.01, 0);
const AFTER: OrbitShape = orbitShape(900_000, 0.2, 0);

function node(
  over: Partial<ParsedManeuverNode> & { target?: OrbitShape } = {},
): ParsedManeuverNode {
  const { target, ...rest } = over;
  const t = target ?? AFTER;
  return {
    id: "0",
    UT: 1000,
    deltaV: [0, 0, 30],
    frame: null,
    deltaVMagnitude: 30,
    ignitionUt: 990,
    cutoffUt: 1010,
    orbitPatches: [
      {
        sma: t.sma,
        ecc: t.ecc,
        inc: t.inc,
      },
    ] as never,
    ...rest,
  };
}

const ctx = (over: Partial<BurnContext>): BurnContext => ({
  nowUt: 500,
  current: BEFORE,
  thrust: { thrusting: false, lastThrustEndUt: null },
  ...over,
});

const AFTER_BURN = ctx({
  nowUt: 1012,
  current: AFTER,
  thrust: { thrusting: false, lastThrustEndUt: 1009 },
});

describe("computeCompletionUpdate", () => {
  it("does nothing while the burn has not been flown", () => {
    const current = new Map<number, CompletedEntry>();
    const watches = new Map<number, BurnWatch>();
    const result = computeCompletionUpdate(
      current,
      [node()],
      watches,
      ctx({}),
      1000,
    );
    expect(result).toBe(current);
    expect(watches.get(1000)?.mismatchSeen).toBe(true);
  });

  it("marks a node complete once its burn was flown", () => {
    const current = new Map<number, CompletedEntry>();
    const watches = new Map<number, BurnWatch>();
    const planned = node();
    computeCompletionUpdate(current, [planned], watches, ctx({}), 1000);
    computeCompletionUpdate(
      current,
      [planned],
      watches,
      ctx({
        nowUt: 995,
        thrust: { thrusting: true, lastThrustEndUt: null },
      }),
      1500,
    );
    const result = computeCompletionUpdate(
      current,
      [planned],
      watches,
      AFTER_BURN,
      2000,
    );
    expect(result.get(1000)).toEqual({ snapshot: planned, completedAt: 2000 });
  });

  it("never completes a node trimmed under the old half-metre threshold", () => {
    const current = new Map<number, CompletedEntry>();
    const watches = new Map<number, BurnWatch>();
    computeCompletionUpdate(current, [node()], watches, ctx({}), 1000);
    const trimmed = node({
      deltaV: [0, 0, 0.3],
      deltaVMagnitude: 0.3,
      target: orbitShape(700_100, 0.01, 0),
    });
    computeCompletionUpdate(current, [trimmed], watches, ctx({}), 1100);
    const result = computeCompletionUpdate(
      current,
      [trimmed],
      watches,
      ctx({
        nowUt: 1012,
        thrust: { thrusting: false, lastThrustEndUt: 1009 },
      }),
      1200,
    );
    expect(result).toBe(current);
  });

  it("never completes a node whose time passed with no thrust", () => {
    const current = new Map<number, CompletedEntry>();
    const watches = new Map<number, BurnWatch>();
    computeCompletionUpdate(current, [node()], watches, ctx({}), 1000);
    const result = computeCompletionUpdate(
      current,
      [node()],
      watches,
      ctx({ nowUt: 1012 }),
      2000,
    );
    expect(result).toBe(current);
  });

  it("never completes a burn stopped short of its orbit", () => {
    const current = new Map<number, CompletedEntry>();
    const watches = new Map<number, BurnWatch>();
    computeCompletionUpdate(current, [node()], watches, ctx({}), 1000);
    const result = computeCompletionUpdate(
      current,
      [node()],
      watches,
      ctx({
        nowUt: 1012,
        current: orbitShape(800_000, 0.1, 0),
        thrust: { thrusting: false, lastThrustEndUt: 1004 },
      }),
      2000,
    );
    expect(result).toBe(current);
  });

  it("uses UT as the stable key across KSP renumbering", () => {
    const current = new Map<number, CompletedEntry>();
    const watches = new Map<number, BurnWatch>();
    computeCompletionUpdate(current, [node({ id: "0" })], watches, ctx({}), 1);
    computeCompletionUpdate(
      current,
      [node({ id: "1" })],
      watches,
      ctx({
        nowUt: 995,
        thrust: { thrusting: true, lastThrustEndUt: null },
      }),
      2,
    );
    const result = computeCompletionUpdate(
      current,
      [node({ id: "1" })],
      watches,
      AFTER_BURN,
      3,
    );
    expect(result.get(1000)?.snapshot.id).toBe("1");
  });

  it("forgets the watch of a node that left the plan", () => {
    const current = new Map<number, CompletedEntry>();
    const watches = new Map<number, BurnWatch>();
    computeCompletionUpdate(current, [node()], watches, ctx({}), 1);
    computeCompletionUpdate(current, [], watches, ctx({}), 2);
    expect(watches.size).toBe(0);
  });
});
