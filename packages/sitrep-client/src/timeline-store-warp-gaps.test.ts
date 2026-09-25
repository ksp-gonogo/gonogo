import { isValue, Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { type GapModel, TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * What a topic's own model says happened across the part of a gap nothing
 * observed. The two ways it can go wrong fail in opposite directions: refusing a
 * quiet 1x channel because its gap is longer than the model reaches, and
 * handing a warped one to the chart as carried when the model was never asked.
 */

const PLANET_MU = 3.5316e12;

function point<T>(validAt: number, payload: T, quality = Quality.OnRails) {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      source: "vessel:probe",
      quality,
    }),
    epoch: 0,
  } as TimelinePoint<T>;
}

/**
 * A `time.warp` sample stating `observationQuantumUt`, beside the mod's
 * one-second `sampleIntervalUt`. 10,000 is the capped quantum at 100,000x, a
 * tenth of a real second of game time.
 */
function warp(
  observationQuantumUt: number | null,
  sampleIntervalUt: number | null = 1,
) {
  return { warpRate: 1, observationQuantumUt, sampleIntervalUt };
}

const AT_100000X = 10_000;

function dock(distance: number) {
  return {
    relativePosition: { x: distance, y: 0, z: 0 },
    relativeVelocity: { x: 0.5, y: 0, z: 0 },
    distance,
  };
}

function orbit(extra: Record<string, unknown> = {}) {
  return {
    referenceBodyIndex: 1,
    sma: value("m", 2_000_000),
    ecc: value("1", 0),
    inc: value("°", 0),
    lan: value("°", 0),
    argPe: value("°", 0),
    meanAnomalyAtEpoch: value("rad", 0),
    epoch: value("ut", 0),
    mu: value("m³/s²", PLANET_MU),
    horizon: { kind: 1, trajectoryKind: 1 },
    ...extra,
  };
}

function store() {
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const s = new TimelineStore(clock);
  s.setTransportConnected(false);
  return s;
}

/** The judgement on the gap between the only two samples of `topic`. */
function gapAt(s: TimelineStore, topic: string): GapModel | undefined {
  s.beginFrame();
  const [before, after] = s.sampleRange<unknown>(
    topic,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ) ?? [undefined, undefined];
  if (!before || !after) throw new Error("the scene needs two samples");
  return s.gapModel(topic, before, after);
}

const magnitudes = (gap: GapModel | undefined) =>
  gap?.carried ? gap.v.map((v) => (isValue(v) ? v.magnitude : Number.NaN)) : [];

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

describe("TimelineStore.gapModel", () => {
  it("withdraws a dead-reckoned distance across a tick nothing observed", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(AT_100000X)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(AT_100000X, dock(1100)));

    expect(gapAt(s, "vessel.dock.distance")).toEqual({ carried: false });
  });

  it("carries the same distance at 1x, across the one second between samples", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(1)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(1, dock(100.5)));

    expect(gapAt(s, "vessel.dock.distance")).toMatchObject({
      carried: true,
      basis: "linear-dead-reckoning",
    });
  });

  /**
   * The model declines past thirty seconds, and this gap is forty, but at 1x
   * the mod looked every second: the record was confirmed unchanged until the
   * last second, so that second is the span, asked from where it opens.
   */
  it("asks a quiet 1x channel about its last second only, from where it opens", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(1)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(40, dock(100.5)));

    const gap = gapAt(s, "vessel.dock.distance");
    expect(gap).toMatchObject({ carried: true });
    if (!gap?.carried) throw new Error("unreachable");
    expect(Math.min(...gap.t)).toBeGreaterThan(39);
    expect(Math.max(...gap.t)).toBeLessThan(40);
  });

  /**
   * Carried, and carried as what it is: the craft goes round once in the span,
   * so the model's own answers sweep the whole orbit, where the chord between
   * the two samples moves by one radian.
   */
  it("hands back an on-rails conic's own path across a warped tick", () => {
    // A tick longer than this orbit's 9458 s period.
    const s = store();
    s.ingest("time.warp", point(0, warp(10_000)));
    s.ingest("system.bodies", point(0, { bodies: [] }));
    s.ingest("vessel.orbit", point(0, orbit()));
    s.ingest(
      "vessel.orbit",
      point(10_000, orbit({ meanAnomalyAtEpoch: value("rad", 1) })),
    );

    const gap = gapAt(s, "vessel.orbit.meanAnomalyAtEpoch");
    expect(gap).toMatchObject({ carried: true, basis: "kepler-propagation" });
    const phases = magnitudes(gap);
    expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(Math.PI);
  });

  it("withdraws the conic where the patch ends inside the tick", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(AT_100000X)));
    s.ingest("system.bodies", point(0, { bodies: [] }));
    s.ingest(
      "vessel.orbit",
      point(0, orbit({ encounter: { transitionUt: value("ut", 5000) } })),
    );
    s.ingest(
      "vessel.orbit",
      point(AT_100000X, orbit({ meanAnomalyAtEpoch: value("rad", 1) })),
    );

    expect(gapAt(s, "vessel.orbit.meanAnomalyAtEpoch")).toEqual({
      carried: false,
    });
  });

  /**
   * Both ends are at apoapsis, well above the air, and the periapsis between
   * them is inside it. Only asking across the span finds that.
   */
  it("withdraws the conic where it dips into air between two samples above it", () => {
    const s = store();
    const period = 2 * Math.PI * Math.sqrt(2_000_000 ** 3 / PLANET_MU);
    const apo = {
      ecc: value("1", 0.5),
      meanAnomalyAtEpoch: value("rad", Math.PI),
    };
    s.ingest("time.warp", point(0, warp(10_000)));
    s.ingest(
      "system.bodies",
      point(0, {
        bodies: [{ index: 1, radius: 900_000, atmosphere: { depth: 200_000 } }],
      }),
    );
    s.ingest("vessel.orbit", point(0, orbit(apo)));
    s.ingest("vessel.orbit", point(period, orbit(apo)));

    expect(gapAt(s, "vessel.orbit.epoch")).toEqual({ carried: false });
  });

  /**
   * Judged once per pair of samples, not once per frame: a 1x chart holds
   * hundreds of them, and each is a model asked two dozen times.
   */
  it("keeps a judgement across frames while nothing it was judged from moves", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(1)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(1, dock(100.5)));

    expect(gapAt(s, "vessel.dock.distance")).toBe(
      gapAt(s, "vessel.dock.distance"),
    );
  });

  /**
   * An input that lands after the first judgement is asked about again. Here
   * the input is the body roster under an altitude: the altitude is measured
   * from the body's radius, which only the roster publishes, so without it the
   * flight model declines at the sample and makes no claim, the warped span is
   * unclaimed, and a judgement kept from then would say so for as long as the
   * sample stays in the window.
   */
  it("asks again once a declared input arrives", () => {
    const s = store();
    const flight = (altitude: number) => ({
      altitudeAsl: value("m", altitude),
      atmDensity: 0,
    });
    s.ingest("time.warp", point(0, warp(AT_100000X)));
    s.ingest("vessel.orbit", point(0, orbit()));
    s.ingest("vessel.flight", point(0, flight(1_400_000)));
    s.ingest("vessel.flight", point(AT_100000X, flight(1_400_000 + 1)));
    expect(gapAt(s, "vessel.flight.altitudeAsl")).toEqual({
      carried: false,
      unclaimed: true,
    });

    s.ingest(
      "system.bodies",
      point(0, { bodies: [{ index: 1, radius: 600_000 }] }),
    );
    expect(gapAt(s, "vessel.flight.altitudeAsl")).toMatchObject({
      carried: true,
    });
  });

  /**
   * The dock model carries `relativeVelocity` verbatim, which is no claim about
   * the gap, so a warped span across it is unclaimed like any other.
   */
  it("leaves a warped span unclaimed for a field the model copies rather than moves", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(AT_100000X)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(AT_100000X, dock(1100)));

    expect(gapAt(s, "vessel.dock.relativeVelocity")).toEqual({
      carried: false,
      unclaimed: true,
    });
  });

  it("makes no claim where the host reported no quantum", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(null)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(AT_100000X, dock(1100)));

    expect(gapAt(s, "vessel.dock.distance")).toBeUndefined();
  });
});

describe("TimelineStore.gapModel where no model claims the value", () => {
  const charge = (current: number) => ({
    resources: { ElectricCharge: { current, max: 200, active: true } },
  });
  const topic = "vessel.resources.resources.ElectricCharge.current";

  /**
   * Five orbits of charge and discharge fit between these two samples, and
   * nothing models electric charge, so nothing stands behind a chord.
   */
  it("calls a warped span nothing claims unclaimed", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(AT_100000X)));
    s.ingest("vessel.resources", point(0, charge(40)));
    s.ingest("vessel.resources", point(AT_100000X, charge(150)));

    expect(gapAt(s, topic)).toEqual({ carried: false, unclaimed: true });
  });

  /** At 1x the span is the one-second resolution every chart has always drawn. */
  it("leaves the same value alone at the sampling's own resolution", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(1)));
    s.ingest("vessel.resources", point(0, charge(40)));
    s.ingest("vessel.resources", point(1, charge(40.4)));

    expect(gapAt(s, topic)).toBeUndefined();
  });

  /** A quiet 1x channel was looked at every second; only its last one was missed. */
  it("leaves a quiet 1x channel alone however long its gap", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(1)));
    s.ingest("vessel.resources", point(0, charge(40)));
    s.ingest("vessel.resources", point(40, charge(40.4)));

    expect(gapAt(s, topic)).toBeUndefined();
  });

  it("makes no claim where the host states no warp-free interval", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(AT_100000X, null)));
    s.ingest("vessel.resources", point(0, charge(40)));
    s.ingest("vessel.resources", point(AT_100000X, charge(150)));

    expect(gapAt(s, topic)).toBeUndefined();
  });
});
