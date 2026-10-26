import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import { makeMeta } from "../testing/stub-transport";
import type { TimelinePoint } from "../timeline";
import { value } from "../unit-system/value";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import {
  type ConicBodiesInput,
  type ConicOrbitInput,
  type ConicPatchInput,
  keplerAdmissibilityAcrossPatches,
} from "./kepler-reckoning";

const MUN_MU = 6.5138e10;
const KERBIN_MU = 3.5316e12;
const ANALYTIC = { kind: Reach.Unbounded, trajectoryKind: Shape.Analytic };
const TRANSITION = 1000;

const BODIES: ConicBodiesInput = {
  bodies: [
    {
      index: 1,
      radius: value("m", 600_000),
      atmosphere: { depth: value("m", 70_000) },
      sphereOfInfluence: value("m", 84_159_286),
    },
    {
      index: 2,
      radius: value("m", 200_000),
      atmosphere: { depth: null },
      sphereOfInfluence: value("m", 2_429_559),
    },
  ],
};

const KERBIN_PATCH: ConicPatchInput = {
  referenceBodyIndex: 1,
  sma: value("m", 13_000_000),
  ecc: value("1", 0.32),
  inc: value("°", 0.6),
  lan: value("°", 10),
  argPe: value("°", 20),
  meanAnomalyAtEpoch: value("rad", 0.5),
  epoch: value("ut", TRANSITION),
  startUt: value("ut", TRANSITION),
  endUt: null,
  mu: value("m³/s²", KERBIN_MU),
};

function munPoint(
  patches: readonly ConicPatchInput[],
): TimelinePoint<ConicOrbitInput> {
  return {
    validAt: 900,
    epoch: 900,
    meta: makeMeta({
      validAt: 900,
      deliveredAt: 900,
      quality: Quality.OnRails,
    }),
    payload: {
      referenceBodyIndex: 2,
      sma: value("m", -2_000_000),
      ecc: value("1", 1.7),
      inc: value("°", 0),
      lan: value("°", 0),
      argPe: value("°", 0),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 900),
      mu: value("m³/s²", MUN_MU),
      horizon: ANALYTIC,
      encounter: { transitionUt: value("ut", TRANSITION) },
      patches: [
        { ...KERBIN_PATCH, referenceBodyIndex: 2, startUt: value("ut", 900) },
        ...patches,
      ],
    },
  };
}

describe("keplerAdmissibilityAcrossPatches", () => {
  it("keeps the current patch before the transition", () => {
    const answer = keplerAdmissibilityAcrossPatches(
      munPoint([KERBIN_PATCH]),
      BODIES,
      950,
    );

    expect(answer).toMatchObject({ ok: true, carried: false });
  });

  it("carries the craft onto the next patch once the view time passes the transition", () => {
    const answer = keplerAdmissibilityAcrossPatches(
      munPoint([KERBIN_PATCH]),
      BODIES,
      1005,
    );

    expect(answer).toMatchObject({
      ok: true,
      carried: true,
      orbit: { referenceBodyIndex: 1 },
    });
  });

  it("still withdraws when the chain carries no patch for the craft to be on", () => {
    const answer = keplerAdmissibilityAcrossPatches(munPoint([]), BODIES, 1005);

    expect(answer).toMatchObject({
      declined: { reason: "beyond-horizon", input: "@vessel.orbit" },
    });
  });

  it.each([
    ["gravitational parameter", { mu: null }],
    ["body", { referenceBodyIndex: null }],
    ["phase", { meanAnomalyAtEpoch: null }],
  ])("does not guess a patch that lacks its %s", (_name, missing) => {
    const answer = keplerAdmissibilityAcrossPatches(
      munPoint([{ ...KERBIN_PATCH, ...missing }]),
      BODIES,
      1005,
    );

    expect("declined" in answer).toBe(true);
  });

  it("withdraws when the next patch has ended too", () => {
    const answer = keplerAdmissibilityAcrossPatches(
      munPoint([{ ...KERBIN_PATCH, endUt: value("ut", 1003) }]),
      BODIES,
      1005,
    );

    expect("declined" in answer).toBe(true);
  });
});
