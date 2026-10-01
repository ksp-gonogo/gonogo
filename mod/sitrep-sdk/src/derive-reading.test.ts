import { describe, expect, it } from "vitest";
import {
  deriveReading,
  pickReading,
  type TopicCurrency,
  type TopicReckoning,
} from "./reading";
import { value } from "./unit-system/value";

interface Orbit {
  epoch: number;
  phase: number;
}

const OBSERVED_AT = value("ut", 1_000);
const SCET = value("ut", 1_240);

function observedOrbit(
  reckoning: TopicReckoning<Orbit>,
): TopicCurrency<Orbit, TopicReckoning<Orbit>> {
  return {
    state: "observed",
    value: { epoch: 1_000, phase: 10 },
    atUt: OBSERVED_AT,
    reckoning,
  };
}

const carried: TopicReckoning<Orbit> = {
  status: "available",
  value: { epoch: 1_240, phase: 34 },
  atUt: SCET,
  beyondReceived: true,
  basis: "kepler-propagation",
  modelled: [{ path: "phase", basis: "kepler-propagation" }],
  owner: "core",
};

function availableFor<Payload>(modelled: Payload): TopicReckoning<Payload> {
  return {
    status: "available",
    value: modelled,
    atUt: SCET,
    beyondReceived: true,
    basis: "kepler-propagation",
    modelled: [],
    owner: "core",
  };
}

describe("deriveReading", () => {
  it("draws the observation, and the model's figure at the instant the model answered for", () => {
    const seen: number[] = [];
    const derived = deriveReading(
      observedOrbit(carried),
      (orbit) => orbit.phase,
      (orbit, atUt) => {
        seen.push(atUt.magnitude);
        return orbit.phase;
      },
    );
    expect(derived.state).toBe("observed");
    expect(derived.value).toBe(10);
    expect(derived.reckoning).toEqual({
      status: "available",
      modelled: 34,
      atUt: SCET,
      beyondReceived: true,
      basis: "kepler-propagation",
    });
    expect(seen).toEqual([1_240]);
  });

  it("overlays what the model moved on the observation it moved it from", () => {
    const derived = deriveReading(
      observedOrbit({ ...carried, value: { phase: 34 } as Orbit }),
      () => 0,
      (orbit) => orbit.epoch,
    );
    expect(
      derived.reckoning.status === "available" && derived.reckoning.modelled,
    ).toBe(1_000);
  });

  it("hands the reckoned arm an array payload as an array, whole as the model answered it", () => {
    const seen: unknown[] = [];
    const crew: TopicCurrency<number[], TopicReckoning<number[]>> = {
      state: "observed",
      value: [1, 2, 3],
      atUt: OBSERVED_AT,
      reckoning: availableFor([4, 5, 6]),
    };
    const derived = deriveReading(
      crew,
      (levels) => levels.length,
      (levels) => {
        seen.push(levels);
        return levels.length;
      },
    );
    expect(seen).toEqual([[4, 5, 6]]);
    expect(Array.isArray(seen[0])).toBe(true);
    expect(derived.reckoning.status).toBe("available");
  });

  it("hands the reckoned arm a bare value as the model answered it", () => {
    const seen: unknown[] = [];
    deriveReading<number, number>(
      {
        state: "observed",
        value: 1,
        atUt: OBSERVED_AT,
        reckoning: availableFor(2),
      },
      (n) => n,
      (n) => {
        seen.push(n);
        return n;
      },
    );
    expect(seen).toEqual([2]);
  });

  it("carries a decline through, and never runs the modelled arm for one", () => {
    let ran = false;
    const derived = deriveReading(
      observedOrbit({
        status: "declined",
        declined: { reason: "under-physics" },
      }),
      (orbit) => orbit.phase,
      () => {
        ran = true;
        return 0;
      },
    );
    expect(derived.reckoning).toEqual({
      status: "declined",
      declined: { reason: "under-physics" },
    });
    expect(ran).toBe(false);
  });

  it("says nothing modelled where the modelled arm has no figure", () => {
    const derived = deriveReading(
      observedOrbit(carried),
      (orbit) => orbit.phase,
      () => undefined,
    );
    expect(derived.reckoning).toEqual({ status: "none" });
  });

  it("keeps a held reading's grade and instant", () => {
    const derived = deriveReading<Orbit, number>(
      {
        state: "held",
        value: { epoch: 1_000, phase: 10 },
        asOfUt: OBSERVED_AT,
        grade: "held",
        reckoning: carried,
      },
      (orbit) => orbit.phase,
      (orbit) => orbit.phase,
    );
    expect(derived).toMatchObject({
      state: "held",
      value: 10,
      asOfUt: OBSERVED_AT,
      grade: "held",
    });
  });

  it("has nothing to derive from a reading with no observation", () => {
    expect(
      deriveReading<Orbit, number>(
        { state: "pending", reckoning: { status: "none" } },
        (orbit) => orbit.phase,
        (orbit) => orbit.phase,
      ),
    ).toEqual({ state: "pending", reckoning: { status: "none" } });
  });
});

describe("pickReading", () => {
  it("takes the same figure off the observation and the model", () => {
    const derived = deriveReading(
      observedOrbit(carried),
      (orbit) => orbit,
      (orbit) => orbit,
    );
    const phase = pickReading(derived, (orbit) => orbit.phase);
    expect(phase.value).toBe(10);
    expect(
      phase.reckoning.status === "available" && phase.reckoning.modelled,
    ).toBe(34);
  });

  it("drops the model where the modelled value has no such figure", () => {
    const derived = deriveReading(
      observedOrbit(carried),
      (orbit) => orbit,
      (orbit) => orbit,
    );
    const phase = pickReading(derived, (orbit) =>
      orbit.phase === 34 ? undefined : orbit.phase,
    );
    expect(phase.value).toBe(10);
    expect(phase.reckoning).toEqual({ status: "none" });
  });
});
