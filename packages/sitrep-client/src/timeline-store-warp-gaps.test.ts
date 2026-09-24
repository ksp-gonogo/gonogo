import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * Whether a chart's line between two samples crosses a span nothing observed
 * and the topic's own model will not carry. The two ways it can go wrong fail
 * in opposite directions: breaking a quiet 1x channel because its gap is
 * longer than the model reaches, and joining a warped one because the model
 * was never asked.
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

function warp(observationQuantumUt: number | null) {
  return { warpRate: 1, observationQuantumUt };
}

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
function gapAt(s: TimelineStore, topic: string): boolean {
  s.beginFrame();
  const [before, after] = s.sampleRange<unknown>(
    topic,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ) ?? [undefined, undefined];
  if (!before || !after) throw new Error("the scene needs two samples");
  return s.gapOutrunsModel(topic, before, after);
}

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

describe("TimelineStore.gapOutrunsModel", () => {
  it("breaks a dead-reckoned distance across a tick nothing observed", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(2000)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(2000, dock(1100)));

    expect(gapAt(s, "vessel.dock.distance")).toBe(true);
  });

  /**
   * The model declines past thirty seconds, and this gap is forty, but at 1x
   * the mod looked every second: only the last second went unseen, and the
   * rest is a channel that did not change.
   */
  it("leaves the same distance joined at 1x, where the sampling saw the gap", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(1)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(40, dock(120)));

    expect(gapAt(s, "vessel.dock.distance")).toBe(false);
  });

  it("leaves an on-rails conic joined across the same warped tick", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(2000)));
    s.ingest("system.bodies", point(0, { bodies: [] }));
    s.ingest("vessel.orbit", point(0, orbit()));
    s.ingest(
      "vessel.orbit",
      point(2000, orbit({ meanAnomalyAtEpoch: value("rad", 1) })),
    );

    expect(gapAt(s, "vessel.orbit.meanAnomalyAtEpoch")).toBe(false);
    // Joined because the conic carries the gap, not because it was silent.
    expect(s.sampleReading("vessel.orbit").reckoning.status).toBe("available");
  });

  it("breaks the conic where the patch ends inside the tick", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(2000)));
    s.ingest("system.bodies", point(0, { bodies: [] }));
    s.ingest(
      "vessel.orbit",
      point(0, orbit({ encounter: { transitionUt: value("ut", 1000) } })),
    );
    s.ingest(
      "vessel.orbit",
      point(2000, orbit({ meanAnomalyAtEpoch: value("rad", 1) })),
    );

    expect(gapAt(s, "vessel.orbit.meanAnomalyAtEpoch")).toBe(true);
  });

  /** The dock model carries `relativeVelocity` verbatim; that is no claim about the gap. */
  it("makes no claim for a field the model copies rather than moves", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(2000)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(2000, dock(1100)));

    expect(gapAt(s, "vessel.dock.relativeVelocity")).toBe(false);
  });

  it("makes no claim where the host reported no quantum", () => {
    const s = store();
    s.ingest("time.warp", point(0, warp(null)));
    s.ingest("vessel.dock", point(0, dock(100)));
    s.ingest("vessel.dock", point(2000, dock(1100)));

    expect(gapAt(s, "vessel.dock.distance")).toBe(false);
  });
});
