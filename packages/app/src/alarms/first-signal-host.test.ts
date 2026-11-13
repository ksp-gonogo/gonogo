import { memoryStorage } from "@ksp-gonogo/core/test";
import {
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmHostService } from "./AlarmHostService";

/**
 * A switch of craft, end to end through the alarm host: the game's own
 * statement of the active craft starts a wait, the craft's delay sizes it, a
 * warp toward it runs on the warp-to ladder, and the craft's own first reading
 * ends both.
 */
function stream() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  client.attachStore(store);
  const subscribed = new Set<string>();
  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);
  return {
    publish(topic: string, payload: unknown, meta = {}) {
      if (!subscribed.has(topic)) {
        subscribed.add(topic);
        client.subscribe(topic, () => {});
      }
      transport.emit(topic, payload, {
        validAt: 500,
        deliveredAt: 500,
        ...meta,
      });
      store.beginFrame();
    },
  };
}

describe("the alarm host across a switch of craft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
  });

  /*
   * The frames below are the shapes a real switch puts on the wire (see
   * tests/fixtures/wire/switch-probe-to-unlinked-craft.jsonl): the old craft's
   * delay, then a null delay naming the game while the scene loads, then the
   * new craft's own.
   */
  const delayOf = (source: string, oneWaySeconds: number | null) => ({
    oneWaySeconds,
    source: oneWaySeconds === null ? 0 : 1,
    meta: { source },
  });
  const ground = { source: "ground:KSC" };

  function host() {
    return new AlarmHostService(null, {
      nowMs: () => 0,
      tickIntervalMs: 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => 0,
    });
  }

  const KERBIN = {
    index: 1,
    name: "Kerbin",
    radius: 600_000,
    gravParameter: 3.5316e12,
    rotationPeriod: 21_549.425,
    initialRotation: 0,
  };

  /** What the centre knows before the switch: the old craft's measured delay over its route, the home centre, the bodies and the new craft's catalog entry. */
  function beforeTheSwitch(telemetry: ReturnType<typeof stream>) {
    telemetry.publish("trackingStation.bodies", { bodies: [KERBIN] });
    telemetry.publish("commandCentre.roster", [
      {
        id: "ground:KSC",
        displayName: "KSC",
        isHome: true,
        bodyIndex: 1,
        latitude: 0,
        longitude: 0,
      },
    ]);
    telemetry.publish("trackingStation.catalog", {
      entries: [
        {
          vesselId: "probe",
          name: "Mun Probe",
          vesselType: 3,
          situation: 32,
          bodyIndex: 1,
          orbit: {
            sma: 900_000,
            ecc: 0,
            inc: 0,
            lan: 0,
            argPe: 0,
            meanAnomalyAtEpoch: 0,
            epoch: 0,
          },
        },
      ],
    });
    telemetry.publish("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    telemetry.publish("comms.path", {
      hops: [
        { from: "mk1", to: "KSC", toIsHome: true, distanceMeters: 1_000_000 },
      ],
    });
    // 1 000 s over 1 000 km: a millisecond to the kilometre.
    telemetry.publish("comms.delay", delayOf("vessel:mk1", 1_000), ground);
  }

  it("announces the wait at the switch with an estimate, warps with no target, swaps in the real delay, and clears only on the craft's own observed data", () => {
    const telemetry = stream();
    setActiveViewClockForTests({
      viewUt: () => 100,
      utNowEstimate: () => 5_000,
    });
    const service = host();
    beforeTheSwitch(telemetry);
    vi.advanceTimersByTime(1000);
    expect(service.snapshot().firstSignal ?? null).toBeNull();

    // The statement of the new craft carries a stamp a delay early, as a replay does.
    telemetry.publish(
      "ksp.activeVessel",
      { vesselId: "probe", name: "Mun Probe" },
      { validAt: 4_970, deliveredAt: 4_970 },
    );
    telemetry.publish(
      "vessel.flight",
      { altitudeAsl: 70, meta: { source: "vessel:mk1" } },
      ground,
    );
    // The scene load: a null delay that names the game, which says nothing of the craft.
    telemetry.publish("comms.delay", delayOf("game", null), ground);
    vi.advanceTimersByTime(1000);
    const announced = service.snapshot().firstSignal;
    expect(announced).toMatchObject({
      vesselName: "Mun Probe",
      estimated: true,
    });
    // Between 300 and 1 500 km from the home centre, at a millisecond to the kilometre.
    expect(announced?.owltSeconds).toBeGreaterThan(290);
    expect(announced?.owltSeconds).toBeLessThan(1_510);

    // The button works from the switch: the warp has no target to wait for.
    service.beginWarpToFirstSignal();
    expect(service.snapshot().warpTo?.alarmId).toBe("first-signal");
    expect(service.snapshot().warpTo?.targetIndex).toBeGreaterThan(0);

    telemetry.publish("comms.delay", delayOf("vessel:probe", 1_800), ground);
    vi.advanceTimersByTime(1000);
    expect(service.snapshot().firstSignal).toEqual({
      vesselName: "Mun Probe",
      owltSeconds: 1_800,
      estimated: false,
    });
    expect(service.snapshot().warpTo?.alarmId).toBe("first-signal");

    telemetry.publish(
      "vessel.flight",
      { altitudeAsl: 1_200, meta: { source: "vessel:probe" } },
      ground,
    );
    vi.advanceTimersByTime(1000);
    expect(service.snapshot().firstSignal ?? null).toBeNull();
    expect(service.snapshot().warpTo).toBeNull();
    service.dispose();
  });

  it("shows no figure, and still offers the warp, when no estimate can be made", () => {
    const telemetry = stream();
    setActiveViewClockForTests({
      viewUt: () => 100,
      utNowEstimate: () => 5_000,
    });
    const service = host();
    telemetry.publish("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    vi.advanceTimersByTime(1000);
    telemetry.publish("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });
    telemetry.publish("comms.delay", delayOf("game", null), ground);
    vi.advanceTimersByTime(1000);
    expect(service.snapshot().firstSignal).toEqual({
      vesselName: "Mun Probe",
      owltSeconds: null,
      estimated: false,
    });
    service.beginWarpToFirstSignal();
    expect(service.snapshot().warpTo?.alarmId).toBe("first-signal");
    service.dispose();
  });

  it("offers no wait for a craft with no route, once the craft's own null delay arrives", () => {
    const telemetry = stream();
    setActiveViewClockForTests({
      viewUt: () => 100,
      utNowEstimate: () => 5_000,
    });
    const service = host();
    telemetry.publish("ksp.activeVessel", { vesselId: "mk1", name: "MkI" });
    vi.advanceTimersByTime(1000);
    telemetry.publish("ksp.activeVessel", {
      vesselId: "probe",
      name: "Mun Probe",
    });
    telemetry.publish("comms.delay", delayOf("game", null), ground);
    vi.advanceTimersByTime(1000);
    expect(service.snapshot().firstSignal).toMatchObject({
      owltSeconds: null,
    });

    telemetry.publish("comms.delay", delayOf("vessel:probe", null), ground);
    vi.advanceTimersByTime(1000);
    expect(service.snapshot().firstSignal ?? null).toBeNull();
    service.beginWarpToFirstSignal();
    expect(service.snapshot().warpTo).toBeNull();
    service.dispose();
  });
});
