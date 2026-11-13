import { describe, expect, it } from "vitest";
import type {
  CommandCentreEntry,
  CommsHop,
  SystemBodies,
  TrackingStationCatalog,
} from "../__generated__/contract";
import {
  CommsDelaySource,
  CommsHopKind,
  PropagationHorizonKind,
  Situation,
  TrajectoryKind,
  VesselType,
} from "../__generated__/contract";
import { value } from "../unit-system/value";
import {
  estimateOneWayDelaySeconds,
  lightSecondsPerMetre,
} from "./delay-estimate";

const hop = (metres: number | null): CommsHop => ({
  from: "mk1",
  to: "KSC",
  fromIsHome: false,
  toIsHome: true,
  kind: CommsHopKind.Home,
  distanceMeters: metres === null ? null : value("m", metres),
});

describe("lightSecondsPerMetre", () => {
  it("is the delay over the length of the whole route", () => {
    expect(
      lightSecondsPerMetre({
        hops: [hop(1_000), hop(3_000)],
        oneWaySeconds: 8,
        source: CommsDelaySource.SignalDelay,
      }),
    ).toBeCloseTo(0.002);
  });

  it("gives no rate for a configured zero, a hop with no length, or no route", () => {
    const base = { hops: [hop(1_000)], oneWaySeconds: 8 };
    expect(
      lightSecondsPerMetre({ ...base, source: CommsDelaySource.None }),
    ).toBeNull();
    expect(
      lightSecondsPerMetre({
        hops: [hop(null)],
        oneWaySeconds: 8,
        source: CommsDelaySource.SignalDelay,
      }),
    ).toBeNull();
    expect(
      lightSecondsPerMetre({
        hops: [],
        oneWaySeconds: 8,
        source: CommsDelaySource.SignalDelay,
      }),
    ).toBeNull();
  });
});

const BODIES: SystemBodies = {
  bodies: [
    {
      index: 1,
      name: "Kerbin",
      radius: value("m", 600_000),
      gravParameter: value("m³/s²", 3.5316e12),
      rotationPeriod: value("s", 21_549.425),
      initialRotation: value("°", 0),
      horizon: {
        kind: PropagationHorizonKind.Unbounded,
        trajectoryKind: TrajectoryKind.Analytic,
      },
    },
  ],
};

const ROSTER: CommandCentreEntry[] = [
  {
    id: "ground:KSC",
    displayName: "KSC",
    active: true,
    isHome: true,
    isHomeFallback: false,
    bodyIndex: 1,
    latitude: value("°", 0),
    longitude: value("°", 0),
  },
];

const CATALOG: TrackingStationCatalog = {
  entries: [
    {
      vesselId: "probe",
      name: "Probe",
      vesselType: VesselType.Probe,
      situation: Situation.Orbiting,
      bodyIndex: 1,
      orbit: {
        sma: value("m", 900_000),
        ecc: value("1", 0),
        inc: value("°", 0),
        lan: value("°", 0),
        argPe: value("°", 0),
        meanAnomalyAtEpoch: value("rad", 0),
        epoch: value("ut", 0),
      },
    },
  ],
};

describe("estimateOneWayDelaySeconds", () => {
  const input = {
    secondsPerMetre: 1e-3,
    roster: ROSTER,
    bodies: BODIES,
    catalog: CATALOG,
    vesselId: "probe",
    atUt: 100,
  };

  it("is the home centre's straight-line distance to the craft's catalog orbit at the measured scale", () => {
    const seconds = estimateOneWayDelaySeconds(input);
    // The craft is between 300 km and 1500 km from a point on the surface of a 600 km body, 1 ms to the kilometre.
    expect(seconds).not.toBeNull();
    expect(seconds as number).toBeGreaterThan(290);
    expect(seconds as number).toBeLessThan(1_510);
  });

  it("says nothing when the craft, the home centre or the scale is missing", () => {
    expect(
      estimateOneWayDelaySeconds({ ...input, vesselId: "stranger" }),
    ).toBeNull();
    expect(estimateOneWayDelaySeconds({ ...input, roster: [] })).toBeNull();
    expect(
      estimateOneWayDelaySeconds({ ...input, secondsPerMetre: 0 }),
    ).toBeNull();
  });
});
