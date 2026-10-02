import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import type { ReckoningDecline } from "../reading";
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
  type ConicThrustInput,
  keplerAdmissibility,
  type LoadedCoastEvidence,
} from "./kepler-reckoning";

/**
 * Which reason each of `keplerAdmissibility`'s withdrawals carries, and that
 * `"under-physics"` means one condition and only one.
 *
 * A widget told a craft is under physics tells the operator the orbit exists
 * and the craft is loaded. That sentence is only true while the reason is
 * emitted for that condition alone, which is why the last case here scans every
 * production source rather than trusting this function to stay the only
 * emitter: a new withdrawal, anywhere, that reused the member would make every
 * consumer of it mislabel a craft with no type error to say so.
 */

const KERBIN_MU = 3.5316e12;
const ANALYTIC = { kind: Reach.Unbounded, trajectoryKind: Shape.Analytic };

/** 800 km radius round a 600 km body: 200 km up, on rails, no encounter. */
function orbitPoint(
  overrides: Partial<ConicOrbitInput> = {},
  quality: Quality = Quality.OnRails,
): TimelinePoint<ConicOrbitInput> {
  return {
    validAt: 0,
    epoch: 0,
    meta: makeMeta({ validAt: 0, deliveredAt: 0, quality }),
    payload: {
      referenceBodyIndex: 1,
      sma: value("m", 800_000),
      ecc: value("1", 0),
      inc: value("°", 0),
      lan: value("°", 0),
      argPe: value("°", 0),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 0),
      mu: value("m³/s²", KERBIN_MU),
      horizon: ANALYTIC,
      ...overrides,
    },
  };
}

function bodies(atmosphereDepth: number | null): ConicBodiesInput {
  return {
    bodies: [
      {
        index: 1,
        radius: value("m", 600_000),
        atmosphere: {
          depth: atmosphereDepth === null ? null : value("m", atmosphereDepth),
        },
      },
    ],
  };
}

function reasonOf(
  point: TimelinePoint<ConicOrbitInput> | undefined,
  air: number | null = null,
  viewUt = 300,
): ReckoningDecline["reason"] | "ok" {
  const answer = keplerAdmissibility(point, bodies(air), viewUt);
  return "ok" in answer ? "ok" : answer.declined.reason;
}

describe("keplerAdmissibility names each withdrawal", () => {
  it("advances an analytic coast above the air", () => {
    expect(reasonOf(orbitPoint())).toBe("ok");
  });

  it("gives every condition the reason it means", () => {
    expect({
      absent: reasonOf(undefined),
      integrated: reasonOf(
        orbitPoint({
          horizon: { kind: Reach.Unbounded, trajectoryKind: Shape.Integrated },
        }),
      ),
      unstated: reasonOf(
        orbitPoint({
          horizon: { kind: Reach.Unbounded, trajectoryKind: Shape.Unspecified },
        }),
      ),
      loaded: reasonOf(orbitPoint({}, Quality.Loaded)),
      pastTransition: reasonOf(
        orbitPoint({ encounter: { transitionUt: value("ut", 100) } }),
      ),
      pastReach: reasonOf(
        orbitPoint({
          horizon: {
            kind: Reach.Until,
            untilUt: 100,
            trajectoryKind: Shape.Analytic,
          },
        }),
      ),
      inAir: reasonOf(orbitPoint(), 250_000),
    }).toEqual({
      absent: "input-absent",
      integrated: "model-inapplicable",
      unstated: "model-inapplicable",
      loaded: "under-physics",
      pastTransition: "beyond-horizon",
      pastReach: "beyond-horizon",
      inAir: "beyond-horizon",
    });
  });

  /**
   * The ordering that matters for the label: a craft under physics that is
   * ALSO off an integrated provider is refused on the authority, which is the
   * permanent fact. Calling it under physics would be true and misleading.
   */
  it("does not call a craft under physics when the authority rules it out first", () => {
    expect(
      reasonOf(
        orbitPoint(
          {
            horizon: {
              kind: Reach.Unbounded,
              trajectoryKind: Shape.Integrated,
            },
          },
          Quality.Loaded,
        ),
      ),
    ).toBe("model-inapplicable");
  });
});

/**
 * A loaded craft is carried as a coast only on positive evidence of one, and
 * every refusal still says "under-physics", naming the input that withheld it.
 */
describe("keplerAdmissibility carries a loaded coast", () => {
  const COLD: ConicThrustInput = {
    currentThrust: value("kN", 0),
    thrustStartedUt: null,
    lastThrustEndUt: null,
  };

  function loaded(
    coast: Partial<LoadedCoastEvidence> | undefined,
    air: number | null = null,
    viewUt = 300,
    validAt = 0,
  ): { reason: ReckoningDecline["reason"]; input?: string } | "ok" {
    const point = orbitPoint({}, Quality.Loaded);
    const answer = keplerAdmissibility(
      { ...point, validAt },
      bodies(air),
      viewUt,
      coast === undefined
        ? undefined
        : { thrust: undefined, pending: undefined, ...coast },
    );
    return "ok" in answer
      ? "ok"
      : { reason: answer.declined.reason, input: answer.declined.input };
  }

  function command(dispatchedAt: number, oneWaySeconds: number) {
    return {
      pending: [
        {
          dispatchedAt: value("ut", dispatchedAt),
          oneWaySeconds: value("s", oneWaySeconds),
        },
      ],
    };
  }

  it("advances a cold craft in vacuum", () => {
    expect(loaded({ thrust: COLD })).toBe("ok");
  });

  it("withholds every other loaded case as under physics, naming why", () => {
    expect({
      noEvidence: loaded(undefined),
      engineUnreported: loaded({}),
      firing: loaded({ thrust: { ...COLD, currentThrust: value("kN", 50) } }),
      burnInProgress: loaded({
        thrust: { ...COLD, thrustStartedUt: value("ut", 0) },
      }),
      elementsBeforeBurnEnded: loaded({
        thrust: { ...COLD, lastThrustEndUt: value("ut", 10) },
      }),
      noRoster: (() => {
        const answer = keplerAdmissibility(
          orbitPoint({}, Quality.Loaded),
          undefined,
          300,
          { thrust: COLD, pending: undefined },
        );
        return "ok" in answer ? "ok" : answer.declined;
      })(),
      inAir: loaded({ thrust: COLD }, 250_000),
      commandInGap: loaded({ thrust: COLD, pending: command(100, 10) }),
    }).toMatchObject({
      noEvidence: { reason: "under-physics", input: "@vessel.propulsion" },
      engineUnreported: {
        reason: "under-physics",
        input: "@vessel.propulsion",
      },
      firing: { reason: "under-physics", input: "@vessel.propulsion" },
      burnInProgress: { reason: "under-physics", input: "@vessel.propulsion" },
      elementsBeforeBurnEnded: {
        reason: "under-physics",
        input: "@vessel.propulsion",
      },
      noRoster: { reason: "under-physics", input: "@system.bodies" },
      inAir: { reason: "under-physics", input: "@system.bodies" },
      commandInGap: {
        reason: "under-physics",
        input: "@system.uplink.pending",
      },
    });
  });

  it("advances up to a command's arrival and not across it", () => {
    const pending = command(100, 10);
    expect(loaded({ thrust: COLD, pending }, null, 109)).toBe("ok");
    expect(loaded({ thrust: COLD, pending }, null, 110)).toMatchObject({
      input: "@system.uplink.pending",
    });
  });

  it("ignores a command that reached the craft before the elements were taken", () => {
    expect(
      loaded({ thrust: COLD, pending: command(0, 10) }, null, 300, 20),
    ).toBe("ok");
  });

  it("accepts elements taken after the last burn ended", () => {
    expect(
      loaded(
        { thrust: { ...COLD, lastThrustEndUt: value("ut", 10) } },
        null,
        300,
        20,
      ),
    ).toBe("ok");
  });
});
