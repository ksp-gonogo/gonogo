import { DashboardItemContext, PerfBudget } from "@ksp-gonogo/core";
import { DelayAuthority } from "@ksp-gonogo/sitrep-client";
import { CommsDelaySource, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRigReplay } from "../test/replayRig";
import { GroundTrackComponent } from "./index";

/**
 * A craft in a 100 km circular orbit at a one-way delay of about 2.4 s, with
 * data arriving at 2 Hz. The view is the craft as it was a delay ago, so the
 * position is reckoned forward to the craft's present on every frame: the
 * observed position is drawn beside the modelled one, and the modelled one must
 * not drop in and out between samples.
 */

const VESSEL = "vessel:fe9bd1e1-3783-6bdf-d033-20eb03452ec7";
const ROTATION_PERIOD = 21549.4251830899;
const MU = 3.5316e12;
const SMA = 700000;
const MEAN_MOTION = Math.sqrt(MU / SMA ** 3);
const START_UT = 13000;
const SAMPLES_PER_SECOND = 2;
const SECONDS = 40;
const LINK_DELAY = 2.4;
/** The delay the mod stamps on each sample, which differs from the figure the view clock is timed by. */
const STAMPED_DELAY = 1.92;

function frame(
  topic: string,
  payload: object,
  validAt: number,
  deliveredAt: number,
  seq: number,
): string {
  return JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "system",
      validAt,
      seq,
      deliveredAt,
      vantage: "ground:Kerbin: KSC",
      active: true,
      staleness: 0,
      timelineEpoch: 1,
      sampleId: seq,
    },
  });
}

function ack(topic: string): string {
  return JSON.stringify({
    type: "event",
    topic,
    name: "subscribed",
    meta: {
      source: "system",
      validAt: START_UT,
      seq: 1,
      deliveredAt: START_UT,
      vantage: "ground:Kerbin: KSC",
      quality: 0,
      active: true,
      staleness: 0,
      timelineEpoch: 1,
    },
    keyframeIntervalUt: 30,
  });
}

/** The elements as KSP publishes them for the active craft: one patch, restarted at the sample's own instant. */
function orbitAt(ut: number, inertialLongitude: number) {
  const patch = {
    sma: SMA,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: inertialLongitude,
    epoch: ut,
    period: (2 * Math.PI) / MEAN_MOTION,
    startUt: ut,
    endUt: ut + 1e7,
    patchStartTransition: 0,
    patchEndTransition: 0,
    peA: 100000,
    apA: 100000,
    semiLatusRectum: SMA,
    semiMinorAxis: SMA,
    referenceBody: "Kerbin",
    referenceBodyIndex: 1,
    mu: MU,
  };
  return {
    referenceBodyIndex: 1,
    sma: SMA,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: inertialLongitude,
    epoch: ut,
    mu: MU,
    timeToAp: 1,
    timeToPe: 1,
    encounter: null,
    patches: [patch],
    horizon: { kind: 1, trajectoryKind: 1, untilUt: null, departure: null },
    meta: { source: VESSEL, quality: 1 },
  };
}

function frames(): string[] {
  const topics = [
    "vessel.orbit",
    "vessel.propulsion",
    "vessel.flight",
    "vessel.identity",
    "trackingStation.bodies",
  ];
  const out = topics.map(ack);
  out.push(
    frame(
      "trackingStation.bodies",
      {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
            rotationPeriod: ROTATION_PERIOD,
          },
        ],
      },
      START_UT,
      START_UT,
      1,
    ),
    frame(
      "vessel.identity",
      {
        name: "MkI",
        situation: 3,
        parentBodyIndex: 1,
        meta: { source: VESSEL },
      },
      START_UT,
      START_UT,
      2,
    ),
    frame(
      "vessel.propulsion",
      {
        totalMass: 2.28,
        dryMass: 2.23,
        currentThrust: 0,
        availableThrust: 0,
        thrustStartedUt: null,
        lastThrustEndUt: null,
        massFlow: 0,
        meta: { source: VESSEL },
      },
      START_UT,
      START_UT,
      3,
    ),
  );
  for (let i = 0; i < SECONDS * SAMPLES_PER_SECOND; i++) {
    const ut = START_UT + 3 + i / SAMPLES_PER_SECOND;
    const inertial = (MEAN_MOTION * (ut - START_UT)) % (2 * Math.PI);
    const longitude =
      ((inertial * 180) / Math.PI - (360 * (ut - START_UT)) / ROTATION_PERIOD) %
      360;
    const seq = 100 + 2 * i;
    out.push(
      frame(
        "vessel.flight",
        {
          latitude: 0,
          longitude: longitude > 180 ? longitude - 360 : longitude,
          altitudeAsl: 100000,
          altitudeTerrain: 100000,
          verticalSpeed: 0,
          surfaceSpeed: 2040,
          orbitalSpeed: 2246,
          gForce: 0,
          dynamicPressureKPa: 0,
          mach: 0,
          atmDensity: 0,
          meta: { source: VESSEL },
        },
        ut,
        ut + STAMPED_DELAY,
        seq,
      ),
      frame(
        "vessel.orbit",
        orbitAt(ut, inertial),
        ut,
        ut + STAMPED_DELAY,
        seq + 1,
      ),
    );
  }
  return out;
}

describe("GroundTrack with live data at a one-way delay of 2.4 s", () => {
  let restoreResizeObserver: () => void;
  beforeEach(() => {
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 800,
      height: 400,
    });
  });
  afterEach(() => restoreResizeObserver());

  it("keeps the modelled position on every frame, never dropping back to a lone marker between samples", () => {
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: value("s", LINK_DELAY),
      source: CommsDelaySource.SignalDelay,
      meta: { source: VESSEL },
    });
    const replay = startRigReplay(
      { frames: frames() },
      { delayAuthority: authority },
    );
    const { container } = render(
      <replay.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "delayed-live" }}>
          <GroundTrackComponent id="delayed-live" w={12} h={8} />
        </DashboardItemContext.Provider>
      </replay.Provider>,
    );
    const canvas = () =>
      container.querySelector("[data-testid=ground-track-data-canvas]");

    const modelled: boolean[] = [];
    for (let s = 0; s < SECONDS; s += 0.05) {
      act(() => replay.advanceTo(s));
      if (s >= 10) {
        modelled.push(canvas()?.hasAttribute("data-vessel-modelled") ?? false);
      }
    }

    // The replay steps twenty frames per game second as fast as the machine runs, so a rate budget measured against the wall clock reads many times its real load.
    for (const budget of PerfBudget.getAll()) budget.reset();

    expect(modelled.length).toBeGreaterThan(500);
    expect(modelled.filter((m) => !m)).toHaveLength(0);
  });
});
