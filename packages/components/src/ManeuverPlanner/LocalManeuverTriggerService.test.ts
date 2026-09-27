import {
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { LocalManeuverTriggerService } from "./LocalManeuverTriggerService";
import type { FrozenPlanInputs } from "./triggerTypes";

// Driven through the service over a real TimelineStore, since computePlan cannot see where its body radius came from.
const PINNED_UT = 1_000_000;

function fixture() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.scrubTo(PINNED_UT);
  const store = new TimelineStore(clock);
  client.attachStore(store);
  // StubTransport delivers only to subscribed channels.
  client.subscribe("vessel.orbit", () => {});
  client.subscribe("vessel.identity", () => {});
  client.subscribe("system.bodies", () => {});

  const commands: string[] = [];
  const calls: Array<{ command: string; args: unknown }> = [];
  transport.setCommandHandler((command, args) => {
    commands.push(command);
    calls.push({ command, args });
    return null;
  });

  setActiveViewClockForTests({ viewUt: () => PINNED_UT });
  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);

  const emit = (topic: string, payload: unknown) => {
    transport.emit(topic, payload);
    store.beginFrame();
  };

  // An Earth-sized body no stock table carries, as real Values because the stream hydrates every declared quantity.
  emit("system.bodies", {
    bodies: [{ index: 1, name: "Earth", radius: value("m", 6_371_000) }],
  });
  emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: 6_771_000,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: PINNED_UT,
    mu: 3.986e14,
    patches: [],
    // Without a stated horizon the service has no conic to plan against.
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
  });
  emit("vessel.identity", {
    vesselId: "test-vessel",
    name: "Test Vessel",
    vesselType: 0,
    situation: 0,
    parentBodyIndex: 1,
  });

  return { commands, calls };
}

/**
 * Registers a second store carrying the orbit but no vessel identity, the
 * shape a provider remount leaves behind until the first identity frame
 * lands. Returns a driver for a frame against it.
 */
function remountWithoutIdentity(): () => void {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.scrubTo(PINNED_UT);
  const store = new TimelineStore(clock);
  client.attachStore(store);
  client.subscribe("vessel.orbit", () => {});
  setActiveTimelineStoreForTests(store);
  return () => store.beginFrame();
}

/** Fired ids whose trigger is no longer listed, read privately because such a guard is unobservable from outside. */
function strandedFiredIds(svc: LocalManeuverTriggerService): string[] {
  const listed = svc.snapshot().triggers.map((t) => t.id);
  // biome-ignore lint/complexity/useLiteralKeys: `fired` is private, so dot access does not compile
  return [...svc["fired"]].filter((id) => !listed.includes(id));
}

const FROZEN: FrozenPlanInputs = {
  preset: "hohmann-to-altitude",
  prograde: 0,
  normal: 0,
  radial: 0,
  burnInSeconds: 60,
  utMode: "relative",
  burnAtUT: 0,
  targetInclination: 0,
  targetAltitudeKm: 200,
  standoffMeters: 500,
};

describe("LocalManeuverTriggerService", () => {
  afterEach(() => {
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
  });

  it("plans a transfer around a body the stock table has never heard of", async () => {
    const { commands } = fixture();
    const svc = new LocalManeuverTriggerService();
    try {
      // sma is 6_771_000, so the condition is already true and the trigger fires at arm time.
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: FROZEN,
      });
      await vi.waitFor(() => expect(commands).toContain("vessel.maneuver.add"));
    } finally {
      svc.dispose();
    }
  });

  it("plans a node from the craft's present, not from the received edge", async () => {
    const { calls } = fixture();
    // A light-time of 240 s: the craft is at PINNED_UT, the screen has received it up to 240 s earlier.
    setActiveViewClockForTests({
      viewUt: () => PINNED_UT - 240,
      scetUt: () => PINNED_UT,
    });
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: { ...FROZEN, preset: "circularize-apo" },
      });
      await vi.waitFor(() =>
        expect(calls.map((c) => c.command)).toContain("vessel.maneuver.add"),
      );
      const args = calls.find((c) => c.command === "vessel.maneuver.add")?.args;
      const ut =
        typeof args === "object" && args !== null && "ut" in args
          ? args.ut
          : undefined;
      const halfPeriod = Math.PI * Math.sqrt(6_771_000 ** 3 / 3.986e14);
      // The craft is at periapsis at PINNED_UT, so apoapsis is half an orbit on.
      expect(ut).toBeCloseTo(PINNED_UT + halfPeriod, 0);
    } finally {
      svc.dispose();
    }
  });

  it("holds no fired id for a trigger that is no longer listed", () => {
    fixture();
    const svc = new LocalManeuverTriggerService();
    try {
      // sma is 6_771_000, so this one stays pending.
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 99_000_000,
        inputs: FROZEN,
      });
      // Already true, so this one fires as it is armed and leaves the list, putting its id in `fired`.
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: FROZEN,
      });
      expect(svc.snapshot().triggers).toHaveLength(1);
      expect(strandedFiredIds(svc)).toEqual([]);
    } finally {
      svc.dispose();
    }
  });

  it("keeps a trigger armed against a named vessel when the identity read goes away", () => {
    fixture();
    const svc = new LocalManeuverTriggerService();
    try {
      // Stays pending, so nothing here depends on the fired-id bookkeeping.
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 99_000_000,
        inputs: FROZEN,
      });
      expect(svc.snapshot().triggers[0].vesselName).toBe("Test Vessel");

      const frame = remountWithoutIdentity();
      frame();

      expect(svc.snapshot().triggers).toHaveLength(1);
      expect(svc.snapshot().triggers[0].vesselName).toBe("Test Vessel");
    } finally {
      svc.dispose();
    }
  });
});
