import type { BodyEntry, TargetAvailable } from "@ksp-gonogo/sitrep-sdk";
import { TargetKind, TargetKnowledge, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { TopicReading } from "./reading";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * The range to a craft the active one only knows of, carried along both
 * orbits to the view time.
 *
 * Such an entry has no measured range: the active craft holds its orbit as it
 * was last heard or sighted, and where that puts it now is a model. The
 * fixture is one planet at the origin, the active craft on a circular
 * equatorial orbit starting at +X, and a known craft on a circular orbit whose
 * period is exactly twice the active craft's. Half an active period on, the
 * active craft is at 180 degrees and the known one at 90, so the range is the
 * hypotenuse of the two radii and can be written down.
 */

const PLANET_INDEX = 1;
const PLANET_MU = 3.5316e12;
const CRAFT_SMA = 2_000_000;
const CRAFT_PERIOD = 2 * Math.PI * Math.sqrt(CRAFT_SMA ** 3 / PLANET_MU);
const KNOWN_SMA = CRAFT_SMA * Math.cbrt(4);
const HALF_ORBIT = CRAFT_PERIOD / 2;
const LIGHT_TIME_SECONDS = 10;

function wire(magnitude: number) {
  return { magnitude } as BodyEntry["gravParameter"];
}

const SYSTEM = {
  bodies: [
    {
      index: PLANET_INDEX,
      name: "Kerbin",
      radius: wire(600_000),
      gravParameter: wire(PLANET_MU),
      rotationPeriod: wire(21_600),
      initialRotation: wire(0),
    } as BodyEntry,
  ],
};

function circular(sma: number) {
  return {
    sma: value("m", sma),
    ecc: value("1", 0),
    inc: value("°", 0),
    lan: value("°", 0),
    argPe: value("°", 0),
    meanAnomalyAtEpoch: value("rad", 0),
    epoch: value("ut", 0),
  };
}

const ACTIVE_ORBIT = {
  ...circular(CRAFT_SMA),
  referenceBodyIndex: PLANET_INDEX,
  mu: value("m³/s²", PLANET_MU),
  horizon: { kind: 1, trajectoryKind: 1 },
};

const IN_RANGE = 0;
const KNOWN = 1;
const KNOWN_WITHOUT_AN_ORBIT = 2;

const ROSTER: TargetAvailable = {
  entries: [
    {
      kind: TargetKind.Vessel,
      name: "Alongside",
      vesselId: "a",
      source: TargetKnowledge.InRange,
      distance: value("m", 500),
      isCurrent: false,
    },
    {
      kind: TargetKind.Vessel,
      name: "Relay",
      vesselId: "b",
      source: TargetKnowledge.CommandCentre,
      asOfUt: value("ut", 0),
      via: "KSC",
      orbit: circular(KNOWN_SMA),
      orbitBodyIndex: PLANET_INDEX,
      isCurrent: false,
    },
    {
      kind: TargetKind.Vessel,
      name: "Rumour",
      vesselId: "c",
      source: TargetKnowledge.CommandCentre,
      asOfUt: value("ut", 0),
      isCurrent: false,
    },
  ],
};

function scene(options: { activeOrbit?: boolean } = {}) {
  const point = <Payload>(
    validAt: number,
    payload: Payload,
  ): TimelinePoint<Payload> => ({
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt + LIGHT_TIME_SECONDS,
      source: "vessel:probe",
    }),
    epoch: 0,
  });
  let wall = LIGHT_TIME_SECONDS;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => LIGHT_TIME_SECONDS,
  });
  const store = new TimelineStore(clock, {});
  store.setTransportConnected(false);
  store.ingest("system.bodies", point(0, SYSTEM));
  if (options.activeOrbit !== false) {
    store.ingest("vessel.orbit", point(0, ACTIVE_ORBIT));
  }
  store.ingest("target.available", point(0, ROSTER));
  return {
    at(scetUt: number): TopicReading<TargetAvailable> {
      wall = scetUt;
      store.beginFrame();
      return store.sampleReading<TargetAvailable>("target.available");
    },
  };
}

function reckonedRange(
  roster: TopicReading<TargetAvailable>,
  index: number,
): number | undefined {
  const range = roster.entries[index]?.distance;
  return range?.reckoning.status === "available"
    ? range.reckoning.modelled?.magnitude
    : undefined;
}

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

describe("the range to a craft the active one only knows of", () => {
  it("is carried along both orbits to the view time, and marked as a model", () => {
    const roster = scene().at(HALF_ORBIT);

    expect(reckonedRange(roster, KNOWN)).toBeCloseTo(
      Math.hypot(CRAFT_SMA, KNOWN_SMA),
      3,
    );
    const range = roster.entries[KNOWN]?.distance;
    expect(
      range?.reckoning.status === "available"
        ? range.reckoning.basis
        : undefined,
    ).toBe("kepler-propagation");
  });

  it("leaves a craft the active one sees at the range it measured", () => {
    const roster = scene().at(HALF_ORBIT);

    expect(reckonedRange(roster, IN_RANGE)).toBeUndefined();
  });

  it("offers nothing for a craft known without an orbit", () => {
    const roster = scene().at(HALF_ORBIT);

    expect(reckonedRange(roster, KNOWN_WITHOUT_AN_ORBIT)).toBeUndefined();
  });

  it("offers nothing while the active craft's own orbit has not arrived", () => {
    const roster = scene({ activeOrbit: false }).at(HALF_ORBIT);

    expect(reckonedRange(roster, KNOWN)).toBeUndefined();
  });
});
