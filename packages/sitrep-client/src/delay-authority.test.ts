import { CommsDelaySource, Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { COMMS_DELAY_TOPIC, DelayAuthority } from "./delay-authority";
import { createFakeWallClock } from "./fake-wall-clock";
import type { OrbitElements } from "./kepler";
import { solve } from "./kepler";
import { makeMeta, StubTransport } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import type { VesselOrbitPayload } from "./vessel-state";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock } from "./view-clock";

/**
 * DelayAuthority tests (SDK legibility layer). Enforcement is
 * server-side (the mod's reveal gate already withheld samples); these tests
 * cover only the client's job — read `comms.delay` and size the
 * predicted-present horizon so the delay becomes LEGIBLE, never earlier.
 */
describe("DelayAuthority", () => {
  it("holds the latest comms.delay oneWaySeconds", () => {
    const authority = new DelayAuthority();
    expect(authority.delaySeconds()).toBe(0); // before any observation

    authority.observe({
      oneWaySeconds: 4.2,
      source: CommsDelaySource.SignalDelay,
    });
    expect(authority.delaySeconds()).toBe(4.2);

    authority.observe({
      oneWaySeconds: 9,
      source: CommsDelaySource.SignalDelay,
    });
    expect(authority.delaySeconds()).toBe(9);
  });

  it("reads CommsDelaySource.None as 0 (typed absence, never a measured zero)", () => {
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: 7,
      source: CommsDelaySource.SignalDelay,
    });
    expect(authority.delaySeconds()).toBe(7);

    // Source flips to None (delay authority dropped) — must collapse to 0
    // even if a stale oneWaySeconds tags along.
    authority.observe({ oneWaySeconds: 7, source: CommsDelaySource.None });
    expect(authority.delaySeconds()).toBe(0);
  });

  it("fail-safes malformed / non-finite / negative payloads to 0 (LAN passthrough)", () => {
    const authority = new DelayAuthority();
    for (const bad of [
      undefined,
      null,
      42,
      "5",
      {},
      { oneWaySeconds: Number.NaN, source: CommsDelaySource.SignalDelay },
      {
        oneWaySeconds: Number.POSITIVE_INFINITY,
        source: CommsDelaySource.SignalDelay,
      },
      { oneWaySeconds: -3, source: CommsDelaySource.SignalDelay },
    ]) {
      authority.observe(bad);
      expect(authority.delaySeconds()).toBe(0);
    }
  });

  it("attach subscribes comms.delay on a real client and stays current on delivery", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const authority = new DelayAuthority();

    const detach = authority.attach(client);
    expect(transport.isSubscribed(COMMS_DELAY_TOPIC)).toBe(true);

    transport.emit(COMMS_DELAY_TOPIC, {
      oneWaySeconds: 3.5,
      source: CommsDelaySource.SignalDelay,
    });
    expect(authority.delaySeconds()).toBe(3.5);

    transport.emit(COMMS_DELAY_TOPIC, {
      oneWaySeconds: 0,
      source: CommsDelaySource.None,
    });
    expect(authority.delaySeconds()).toBe(0);

    detach();
    expect(transport.isSubscribed(COMMS_DELAY_TOPIC)).toBe(false);
    client.dispose();
  });
});

describe("DelayAuthority → ViewClock (predicted-present horizon)", () => {
  /**
   * With a fixed delay, the predicted-present estimate leads the
   * confirmed edge by exactly the delay — this is the PREDICT-FORWARD horizon
   * a delayed vessel is dead-reckoned across.
   */
  it("utNowEstimate() leads confirmedEdgeUt() by the delay when the estimate is the binding constraint", () => {
    const wall = createFakeWallClock(0);
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: 6,
      source: CommsDelaySource.SignalDelay,
    });

    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: authority.delaySeconds,
    });

    // Observe a sample far ahead so the sample-clamp isn't the binding side of
    // confirmedEdgeUt's min() — the delay is.
    clock.observeSample(10_000, 100);
    wall.advanceBy(0); // utNowEstimate == anchorUt == 100

    expect(clock.utNowEstimate()).toBe(100);
    expect(clock.confirmedEdgeUt()).toBe(94); // 100 − 6
    expect(clock.utNowEstimate() - clock.confirmedEdgeUt()).toBe(6);
  });

  it("delay 0 ⇒ predicted == confirmed (byte-identical LAN passthrough)", () => {
    const wall = createFakeWallClock(0);
    const authority = new DelayAuthority(); // never observed ⇒ 0
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: authority.delaySeconds,
    });

    clock.observeSample(10_000, 250);
    expect(authority.delaySeconds()).toBe(0);
    expect(clock.confirmedEdgeUt()).toBe(clock.utNowEstimate());
  });

  it("certaintyFor() splits confirmed (≤ edge) from predicted (beyond) at the delayed horizon", () => {
    const wall = createFakeWallClock(0);
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: 5,
      source: CommsDelaySource.SignalDelay,
    });
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: authority.delaySeconds,
    });

    clock.observeSample(10_000, 100);
    const horizon = clock.confirmedEdgeUt(); // 95

    expect(horizon).toBe(95);
    expect(clock.certaintyFor(horizon)).toBe("confirmed"); // at the edge
    expect(clock.certaintyFor(horizon - 1)).toBe("confirmed"); // before it
    expect(clock.certaintyFor(horizon + 0.001)).toBe("predicted"); // beyond it
    // utNowEstimate (the predicted present) sits past the horizon by the delay.
    expect(clock.certaintyFor(clock.utNowEstimate())).toBe("predicted");
  });

  it("a live delay change moves the horizon without any re-plumbing (single wiring point)", () => {
    const wall = createFakeWallClock(0);
    const authority = new DelayAuthority();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: authority.delaySeconds,
    });
    clock.observeSample(10_000, 100);

    authority.observe({
      oneWaySeconds: 2,
      source: CommsDelaySource.SignalDelay,
    });
    expect(clock.confirmedEdgeUt()).toBe(98);

    // Vessel moves farther out → light-time grows → horizon falls back.
    authority.observe({
      oneWaySeconds: 12,
      source: CommsDelaySource.SignalDelay,
    });
    expect(clock.confirmedEdgeUt()).toBe(88);
  });
});

const CIRCULAR_ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12, // Kerbin's GM
};

const CIRCULAR_ELEMENTS: OrbitElements = {
  sma: CIRCULAR_ORBIT.sma,
  ecc: CIRCULAR_ORBIT.ecc,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: CIRCULAR_ORBIT.meanAnomalyAtEpoch,
  epoch: CIRCULAR_ORBIT.epoch,
  mu: CIRCULAR_ORBIT.mu,
};

function orbitPoint(
  payload: VesselOrbitPayload,
  validAt: number,
): TimelinePoint<VesselOrbitPayload> {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      quality: Quality.OnRails,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

describe("DelayAuthority → dead-reckon at one view UT (single-view-time)", () => {
  /**
   * A delayed vessel is propagated FORWARD from its
   * last confirmed elements to the predicted-present view UT, and any
   * deterministic object (a body) resolves at that SAME view UT — never a
   * different instant. Here the delay authority sets the lead, predicted mode
   * projects the vessel to `utNowEstimate()`, and an independent Kepler solve
   * standing in for a deterministic body uses the identical frame UT.
   */
  it("propagates the vessel to the predicted-present view UT while a deterministic solve conforms to the same UT", () => {
    const wall = createFakeWallClock(0);
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: 8,
      source: CommsDelaySource.SignalDelay,
    });

    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: authority.delaySeconds,
    });
    const store = new TimelineStore(clock);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest("vessel.orbit", orbitPoint(CIRCULAR_ORBIT, 100));

    clock.setMode("predicted");
    wall.advanceBy(50); // utNowEstimate = 100 + 50 = 150 (delayed present)
    store.beginFrame();

    const frame = store.currentFrame();
    expect(frame.viewUt).toBe(150);
    expect(frame.certainty).toBe("predicted");
    // Horizon stayed at the confirmed sample (100); the 8s delay would clamp
    // it further back once the estimate is the binding side, but the sample
    // clamp binds first here — the point is the estimate LEADS it.
    expect(store.certaintyHorizonUt()).toBe(100);

    const state = store.sample<{
      position: readonly [number, number, number] | null;
      velocity: readonly [number, number, number] | null;
      basis: string;
    }>("vessel.state");

    // The vessel dead-reckons to the frame's single view UT...
    const vesselExpected = solve(CIRCULAR_ELEMENTS, frame.viewUt);
    expect(state?.payload?.basis).toBe("propagated");
    expect(state?.payload?.position).toEqual(vesselExpected.position);

    // ...and a deterministic body, solved at the SAME frame UT, uses the
    // identical instant — no per-object time. Solving the body at any other
    // UT would disagree, proving the shared frame UT is load-bearing.
    const bodyAtFrameUt = solve(CIRCULAR_ELEMENTS, frame.viewUt);
    const bodyAtConfirmedEdge = solve(
      CIRCULAR_ELEMENTS,
      store.certaintyHorizonUt(),
    );
    expect(bodyAtFrameUt.position).toEqual(vesselExpected.position);
    expect(bodyAtFrameUt.position).not.toEqual(bodyAtConfirmedEdge.position);
  });

  it("delay 0 ⇒ predicted vessel state equals the confirmed read (LAN passthrough)", () => {
    const wall = createFakeWallClock(0);
    const authority = new DelayAuthority(); // 0
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: authority.delaySeconds,
    });
    const store = new TimelineStore(clock);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest("vessel.orbit", orbitPoint(CIRCULAR_ORBIT, 100));
    store.beginFrame();

    // No wall advance, no delay: confirmed edge == estimate == 100.
    expect(clock.confirmedEdgeUt()).toBe(clock.utNowEstimate());
    const confirmed = store.sample<{
      position: readonly [number, number, number] | null;
    }>("vessel.state");
    expect(confirmed?.payload?.position).toEqual(
      solve(CIRCULAR_ELEMENTS, 100).position,
    );
  });
});
