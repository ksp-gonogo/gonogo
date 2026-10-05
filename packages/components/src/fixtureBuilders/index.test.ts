import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  analyticHorizon,
  integratedHorizon,
  orbitMeta,
  topicFixture,
  vesselMeta,
} from "./index";

const complete = {
  referenceBodyIndex: 1,
  sma: { magnitude: 700000, unit: "m" },
  ecc: { magnitude: 0, unit: "1" },
  inc: { magnitude: 0, unit: "°" },
  meanAnomalyAtEpoch: { magnitude: 0, unit: "rad" },
  epoch: { magnitude: 0, unit: "ut" },
  mu: { magnitude: 3.5316e12, unit: "m³/s²" },
  patches: [],
  horizon: analyticHorizon(),
  meta: orbitMeta("abc", Quality.OnRails),
} as const;

describe("topicFixture", () => {
  it("accepts a complete payload and returns it untouched", () => {
    const { referenceBodyIndex, sma, ecc, inc, ...rest } = complete;
    const payload = topicFixture("vessel.orbit", {
      referenceBodyIndex,
      sma,
      ecc,
      inc,
      ...rest,
      patches: [],
    });
    expect(payload.meta).toEqual({ source: "vessel:abc", quality: 0 });
  });

  it("refuses a required field left out, at compile time", () => {
    const { meta: _meta, ...withoutMeta } = complete;
    // @ts-expect-error `meta` is required on the wire
    topicFixture("vessel.orbit", { ...withoutMeta, patches: [] });
    const { horizon: _horizon, ...withoutHorizon } = complete;
    // @ts-expect-error `horizon` is required on the wire
    topicFixture("vessel.orbit", { ...withoutHorizon, patches: [] });
    // @ts-expect-error a field the contract never declared
    topicFixture("vessel.orbit", { ...complete, invented: 1, patches: [] });
  });

  it("types a Value as the pair a JSON fixture holds", () => {
    // @ts-expect-error a bare number is the wire form, not the fixture form
    topicFixture("vessel.orbit", { ...complete, sma: 700000, patches: [] });
  });
});

describe("meta and horizon helpers", () => {
  it("write what the mod sends", () => {
    expect(vesselMeta("abc")).toEqual({ source: "vessel:abc" });
    expect(analyticHorizon()).toEqual({ kind: 1, trajectoryKind: 1 });
    expect(integratedHorizon(5)).toEqual({
      kind: 2,
      trajectoryKind: 2,
      untilUt: { magnitude: 5, unit: "ut" },
    });
  });
});
