import {
  CELESTIAL_FACTS,
  type CelestialFacts,
  DELTA_V_BUDGET,
  type DeltaVBudget,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  type FakeWallClock,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateProcessor,
  clearProcessorRuntime,
  getProcessorValue,
  setActiveTimelineStore,
  setProcessorEvaluationRecorder,
  subscribeProcessor,
} from "./processorEvaluator";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * The two shared Processors the SDK publishes, exercised against the REAL
 * evaluator and a real `TimelineStore`.
 *
 * The point of a Processor is that one derivation serves every consumer, and a
 * test that only checks the value cannot see whether that holds: the four
 * widgets this replaces each computed a correct answer four times a frame.
 * So every case here counts something, and the counts are in the names.
 *
 * Deliberately no `clearProcessors()`: these two register at SDK module load,
 * and emptying the registry would leave the imported handles pointing at
 * nothing while every assertion below went on passing against `undefined`.
 */

/** A store whose view time only moves when `wall.advanceBy` says so. */
function makeStore(): { store: TimelineStore; wall: FakeWallClock } {
  const wall = createFakeWallClock();
  return {
    store: new TimelineStore(
      new ViewClock({
        nowWall: wall.now,
        delaySeconds: () => 0,
        warpRate: () => 1,
      }),
    ),
    wall,
  };
}

function point<T>(validAt: number, payload: T): TimelinePoint<T> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;

const SYSTEM = {
  bodies: [
    {
      index: 0,
      name: "Kerbol",
      parentIndex: null,
      radius: 261_600_000,
      gravParameter: KERBOL_MU,
      orbit: null,
    },
    {
      index: 1,
      name: "Kerbin",
      parentIndex: 0,
      radius: 600_000,
      gravParameter: KERBIN_MU,
      // On the wire, not derived: KSP's own Mass / GeeASL / hillSphere.
      mass: 5.2915158e22,
      surfaceGravity: 1,
      hillSphere: 84_159_286,
      orbit: {
        sma: 13_599_840_256,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 3.14,
        epoch: 0,
      },
    },
    {
      index: 2,
      name: "Mun",
      parentIndex: 1,
      radius: 200_000,
      gravParameter: 6.5138398e10,
      orbit: {
        sma: 12_000_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 1.7,
        epoch: 0,
      },
    },
  ],
};

/** A three-stage launcher, in the mod's own `StageDeltaVEntry` field names. */
const DV_STAGES = [
  {
    stage: 2,
    dvVac: 1800,
    dvAsl: 1500,
    dvActual: 1500,
    twrVac: 2.1,
    twrAsl: 1.8,
    twrActual: 1.8,
    startMass: 40,
    endMass: 20,
    dryMass: 8,
    fuelMass: 12,
    burnTime: 120,
    thrustVac: 900,
    thrustAsl: 800,
    thrustActual: 800,
  },
  {
    stage: 1,
    dvVac: 1700,
    dvAsl: 1400,
    dvActual: 1600,
    twrVac: 1.4,
    twrAsl: 1.1,
    twrActual: 1.3,
    startMass: 18,
    endMass: 9,
    dryMass: 4,
    fuelMass: 5,
    burnTime: 90,
    thrustVac: 240,
    thrustAsl: 200,
    thrustActual: 230,
  },
  // A decoupler-only stage: the wire carries no ΔV or TWR figure at all.
  { stage: 0, startMass: 3, endMass: 3, dryMass: 3, fuelMass: 0 },
];

const DV_SUMMARY = {
  stageCount: 3,
  totalDvVac: 3500,
  totalDvAsl: 2900,
  totalDvActual: 3100,
  totalBurnTime: 210,
};

let store: TimelineStore;
let wall: FakeWallClock;

beforeEach(() => {
  clearProcessorRuntime();
  ({ store, wall } = makeStore());
  setActiveTimelineStore(store);
});

afterEach(() => {
  setActiveTimelineStore(undefined);
  clearProcessorRuntime();
});

/** Counts every `compute` run in the block, via the evaluator's own budget seam. */
function countEvaluations(): { get: () => number; stop: () => void } {
  let n = 0;
  setProcessorEvaluationRecorder(() => {
    n++;
  });
  return {
    get: () => n,
    stop: () => setProcessorEvaluationRecorder(() => {}),
  };
}

/**
 * The counter above is the instrument every once-per-frame assertion rests on,
 * so it gets its own control: a counter that cannot exceed one-per-frame would
 * report success no matter what the evaluator did. Two DISTINCT processors,
 * each activated twice, must read 2 per frame, which is the shape the migrated
 * widgets would have produced had each kept deriving for itself.
 */
describe("the evaluation counter", () => {
  it("counts per DERIVATION, not per frame: 2 processors over 5 frames reads 10", () => {
    const counter = countEvaluations();
    const off = [
      activateProcessor(CELESTIAL_FACTS.id),
      activateProcessor(CELESTIAL_FACTS.id),
      activateProcessor(DELTA_V_BUDGET.id),
      activateProcessor(DELTA_V_BUDGET.id),
    ];

    for (let i = 0; i < 5; i++) store.beginFrame();

    expect(counter.get()).toBe(10);

    counter.stop();
    for (const deactivate of off) deactivate();
  });
});

describe("CELESTIAL_FACTS", () => {
  it("evaluates ONCE per frame for 4 consumers: 5 frames, 4 activations, 5 evaluations", () => {
    const counter = countEvaluations();
    // Four activations stands for the four sites that each re-derived the whole
    // catalogue every frame: SystemView's body, SystemView's config component,
    // TransferWindow, and useBodyRotation (which OrbitView calls).
    const off = [1, 2, 3, 4].map(() => activateProcessor(CELESTIAL_FACTS.id));

    store.ingest("system.bodies", point(0, SYSTEM));
    for (let i = 0; i < 5; i++) store.beginFrame();

    expect(counter.get()).toBe(5);

    counter.stop();
    for (const deactivate of off) deactivate();
  });

  it("carries the 3 game-authored almanac fields verbatim, and derives 2 more", () => {
    const off = activateProcessor(CELESTIAL_FACTS.id);
    store.ingest("system.bodies", point(0, SYSTEM));
    store.beginFrame();

    const facts = getProcessorValue<CelestialFacts>(CELESTIAL_FACTS.id);
    expect(facts?.bodies).toHaveLength(3);
    const kerbin = facts?.bodies[1];
    expect(kerbin?.referenceBody).toBe("Kerbol");

    // CARRIED. These were derived from gravParameter until the contract grew
    // them; the surface-gravity derivation ran KSP's own arithmetic backwards
    // (the game derives mass and gravParameter FROM GeeASL), and the hill-sphere
    // derivation used the textbook ∛(m/3M) where KSP uses (m/M)^(1/3).
    expect(kerbin?.mass).toBe(5.2915158e22);
    expect(kerbin?.geeASL).toBe(1);
    expect(kerbin?.hillSphere).toBe(84_159_286);

    // DERIVED, because the game has no answer: CelestialBody carries no
    // escape-velocity member at all.
    expect(kerbin?.escapeVelocity).toBeCloseTo(
      Math.sqrt((2 * KERBIN_MU) / 600_000),
      6,
    );
    // DERIVED, and this one by choice: Orbit.period exists but is
    // 2π/√(μ/a³), the same expression, so there is no authority to defer to.
    expect(kerbin?.period).toBeCloseTo(
      2 * Math.PI * Math.sqrt(13_599_840_256 ** 3 / KERBOL_MU),
      3,
    );

    off();
  });

  it("reads a hill sphere the wire did not send as null, never as a guess", () => {
    // The root star: KSP's own hillSphere is PositiveInfinity there and the
    // host's non-finite-is-absent rule drops it. Nothing bounds the star, and a
    // client-side reconstruction would have invented a number for it.
    const off = activateProcessor(CELESTIAL_FACTS.id);
    store.ingest("system.bodies", point(0, SYSTEM));
    store.beginFrame();

    const kerbol = getProcessorValue<CelestialFacts>(CELESTIAL_FACTS.id)
      ?.bodies[0];
    expect(kerbol?.name).toBe("Kerbol");
    expect(kerbol?.hillSphere).toBeNull();
    expect(kerbol?.mass).toBeNull();

    off();
  });

  it("goes quiet while the stream is still: 10 frames, 4 consumers, 4 wakes", () => {
    // The measurement that matters against PROCESSOR_NOTIFY_BUDGET, and it came
    // out an order of magnitude better than expected. `trueAnomaly` is solved
    // for the frame's VIEW time, and the view time is keyframed to the stream
    // rather than free-running, so with no new sample it does not move and the
    // catalogue is byte-identical frame to frame. Each consumer is woken once,
    // when the first value lands, and then not again.
    const off = [1, 2, 3, 4].map(() => activateProcessor(CELESTIAL_FACTS.id));
    const listeners = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const unsubs = listeners.map((cb) =>
      subscribeProcessor(CELESTIAL_FACTS.id, cb),
    );

    store.ingest("system.bodies", point(0, SYSTEM));
    for (let i = 0; i < 10; i++) {
      store.beginFrame();
      wall.advanceBy(1);
    }

    expect(listeners.reduce((n, cb) => n + cb.mock.calls.length, 0)).toBe(4);

    for (const unsub of unsubs) unsub();
    for (const deactivate of off) deactivate();
  });

  it("wakes all 4 again when the view time actually advances", () => {
    // The other arm, so the case above cannot pass by the processor being
    // wedged. A later sample moves the confirmed edge, the Kepler solve answers
    // for a new instant, and every consumer is told exactly once more.
    const off = [1, 2, 3, 4].map(() => activateProcessor(CELESTIAL_FACTS.id));
    const listeners = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const unsubs = listeners.map((cb) =>
      subscribeProcessor(CELESTIAL_FACTS.id, cb),
    );

    store.ingest("system.bodies", point(0, SYSTEM));
    store.beginFrame();
    expect(listeners.reduce((n, cb) => n + cb.mock.calls.length, 0)).toBe(4);

    // A full Kerbin day later: the bodies have measurably moved along.
    store.ingest("system.bodies", point(21_600, SYSTEM));
    store.beginFrame();

    expect(listeners.reduce((n, cb) => n + cb.mock.calls.length, 0)).toBe(8);

    for (const unsub of unsubs) unsub();
    for (const deactivate of off) deactivate();
  });

  it("carries both index lookups for the 3 bodies, keyed both ways", () => {
    const off = activateProcessor(CELESTIAL_FACTS.id);
    store.ingest("system.bodies", point(0, SYSTEM));
    store.beginFrame();

    const facts = getProcessorValue<CelestialFacts>(CELESTIAL_FACTS.id);
    expect(facts?.nameByIndex).toEqual({ 0: "Kerbol", 1: "Kerbin", 2: "Mun" });
    expect(facts?.indexByName).toEqual({ Kerbol: 0, Kerbin: 1, Mun: 2 });

    off();
  });

  it("keeps the catalogue when the link drops, because a body list is a fact", () => {
    const off = activateProcessor(CELESTIAL_FACTS.id);
    store.ingest("system.bodies", point(0, SYSTEM));
    store.beginFrame();
    store.setTransportConnected(false);
    store.beginFrame();

    expect(
      getProcessorValue<CelestialFacts>(CELESTIAL_FACTS.id)?.bodies,
    ).toHaveLength(3);

    off();
  });

  it("is an empty catalogue, not a crash, before system.bodies lands", () => {
    const off = activateProcessor(CELESTIAL_FACTS.id);
    store.beginFrame();

    const facts = getProcessorValue<CelestialFacts>(CELESTIAL_FACTS.id);
    expect(facts?.bodies).toEqual([]);
    expect(facts?.nameByIndex).toEqual({});

    off();
  });
});

describe("DELTA_V_BUDGET", () => {
  function ingestCraft(): void {
    store.ingest("dv.summary", point(0, DV_SUMMARY));
    store.ingest("dv.stages", point(0, DV_STAGES));
    store.ingest("vessel.structure", point(0, { currentStage: 1 }));
  }

  it("evaluates ONCE per frame for 4 consumers: 5 frames, 4 activations, 5 evaluations", () => {
    const counter = countEvaluations();
    // FuelStatus, ManeuverPlanner, TransferWindow, LandingStatus.
    const off = [1, 2, 3, 4].map(() => activateProcessor(DELTA_V_BUDGET.id));

    ingestCraft();
    for (let i = 0; i < 5; i++) store.beginFrame();

    expect(counter.get()).toBe(5);

    counter.stop();
    for (const deactivate of off) deactivate();
  });

  it("wakes 4 consumers ONCE over 10 unchanging frames, not 40 times", () => {
    // The half a value-only assertion cannot see. Before the evaluator learned
    // to compare a `Value`, a budget carrying `Value<"m/s">` totals compared
    // unequal on every frame and this was 40.
    const off = [1, 2, 3, 4].map(() => activateProcessor(DELTA_V_BUDGET.id));
    const listeners = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const unsubs = listeners.map((cb) =>
      subscribeProcessor(DELTA_V_BUDGET.id, cb),
    );

    ingestCraft();
    for (let i = 0; i < 10; i++) store.beginFrame();

    const woken = listeners.reduce((n, cb) => n + cb.mock.calls.length, 0);
    expect(woken).toBe(4);

    for (const unsub of unsubs) unsub();
    for (const deactivate of off) deactivate();
  });

  it("wakes all 4 again the frame the craft actually stages", () => {
    const off = [1, 2, 3, 4].map(() => activateProcessor(DELTA_V_BUDGET.id));
    const listeners = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const unsubs = listeners.map((cb) =>
      subscribeProcessor(DELTA_V_BUDGET.id, cb),
    );

    ingestCraft();
    for (let i = 0; i < 5; i++) store.beginFrame();
    store.ingest("vessel.structure", point(1, { currentStage: 0 }));
    store.beginFrame();

    const woken = listeners.reduce((n, cb) => n + cb.mock.calls.length, 0);
    expect(woken).toBe(8);

    for (const unsub of unsubs) unsub();
    for (const deactivate of off) deactivate();
  });

  it("takes the vessel total off dv.summary, never a sum of the 3 stage rows", () => {
    const off = activateProcessor(DELTA_V_BUDGET.id);
    ingestCraft();
    store.beginFrame();

    const budget = getProcessorValue<DeltaVBudget>(DELTA_V_BUDGET.id);
    // The rows sum to 3500 here only because the fixture is consistent; what
    // matters is WHICH number is reported. `dv.stages` is OperatingStageInfo and
    // `dv.summary` is accumulated over WorkingStageInfo, so in flight the two
    // lists differ and only the wire's own total is the game's answer.
    expect(budget?.totalVac).toEqual(value("m/s", 3500));
    expect(budget?.totalAsl).toEqual(value("m/s", 2900));
    expect(budget?.totalActual).toEqual(value("m/s", 3100));
    expect(budget?.stageCount).toEqual(value("count", 3));

    off();
  });

  it("spells a stage with no engine NaN, not 0, across all 6 dv/twr fields", () => {
    const off = activateProcessor(DELTA_V_BUDGET.id);
    ingestCraft();
    store.beginFrame();

    const decouplerOnly = getProcessorValue<DeltaVBudget>(
      DELTA_V_BUDGET.id,
    )?.stages.find((s) => s.stage === 0);
    for (const figure of [
      decouplerOnly?.deltaVVac,
      decouplerOnly?.deltaVASL,
      decouplerOnly?.deltaVActual,
      decouplerOnly?.TWRVac,
      decouplerOnly?.TWRASL,
      decouplerOnly?.TWRActual,
    ]) {
      expect(figure).toBeNaN();
    }
    // The masses it DOES carry survive, so the row is still usable.
    expect(decouplerOnly?.dryMass).toBe(3);

    off();
  });

  it("picks the active stage out of the 3 rows by vessel.structure.currentStage", () => {
    const off = activateProcessor(DELTA_V_BUDGET.id);
    ingestCraft();
    store.beginFrame();

    const budget = getProcessorValue<DeltaVBudget>(DELTA_V_BUDGET.id);
    expect(budget?.activeStage?.stage).toBe(1);
    expect(budget?.activeStage?.deltaVActual).toBe(1600);

    off();
  });

  it("carries the budget when the link drops, and dates it", () => {
    const off = activateProcessor(DELTA_V_BUDGET.id);
    ingestCraft();
    store.beginFrame();
    store.setTransportConnected(false);
    store.beginFrame();

    const budget = getProcessorValue<DeltaVBudget>(DELTA_V_BUDGET.id);
    // Carried, never withheld: a number that only falls by burning is still the
    // number, and blanking it is what re-enabled ManeuverPlanner's commit.
    expect(budget?.totalVac).toEqual(value("m/s", 3500));
    expect(budget?.budget.state).toBe("stale");
    expect(budget?.budget.asOfUt).toEqual(value("ut", 0));
    expect(budget?.budget.ageSec).toBeGreaterThanOrEqual(0);

    off();
  });

  it("is a pending budget of nulls, not zeros, before anything arrives", () => {
    const off = activateProcessor(DELTA_V_BUDGET.id);
    store.beginFrame();

    const budget = getProcessorValue<DeltaVBudget>(DELTA_V_BUDGET.id);
    expect(budget?.totalVac).toBeNull();
    expect(budget?.stages).toEqual([]);
    expect(budget?.activeStage).toBeNull();
    expect(budget?.budget.state).toBe("pending");
    expect(budget?.budget.confirmedAbsent).toBe(false);

    off();
  });

  it("says a confirmed-no-figure craft apart from one nothing has arrived for", () => {
    const off = activateProcessor(DELTA_V_BUDGET.id);
    store.ingest("dv.summary", point(0, null));
    store.beginFrame();

    const budget = getProcessorValue<DeltaVBudget>(DELTA_V_BUDGET.id);
    expect(budget?.budget.state).toBe("absent");
    expect(budget?.budget.confirmedAbsent).toBe(true);
    expect(budget?.totalVac).toBeNull();

    off();
  });
});
