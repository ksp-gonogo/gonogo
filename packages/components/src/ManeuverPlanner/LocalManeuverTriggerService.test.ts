import {
  StubTransport,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { LocalManeuverTriggerService } from "./LocalManeuverTriggerService";
import type { FrozenPlanInputs } from "./triggerTypes";

/**
 * The in-process trigger service, driven over a real `TimelineStore`.
 *
 * <p>The host twin in `@ksp-gonogo/app` has this coverage already; this is the
 * copy the widget falls back to when it is rendered without a
 * `<ManeuverTriggerProvider>`, and it resolved the body radius the same wrong
 * way. `computePlan` takes a `bodyRadius` and cannot see where it came from, so
 * the case has to go through the service.</p>
 */
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
  store.registerDerivedChannel(vesselStateChannel);
  client.attachStore(store);
  // `StubTransport.emit` is subscription-gated: without these it delivers
  // nothing and the store never sees a body at all.
  client.subscribe("vessel.orbit", () => {});
  client.subscribe("vessel.identity", () => {});
  client.subscribe("system.bodies", () => {});

  const commands: string[] = [];
  transport.setCommandHandler((command) => {
    commands.push(command);
    return null;
  });

  setActiveViewClockForTests({ viewUt: () => PINNED_UT });
  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);

  const emit = (topic: string, payload: unknown) => {
    transport.emit(topic, payload);
    store.beginFrame();
  };

  /*
   * An Earth-sized body under a name no stock table carries, which is what RSS
   * hands RP-1. Real `Value`s, because `wrap-units` hydrates every declared
   * quantity as the payload is decoded and a bare `{ magnitude, unit }` is a
   * shape the stream never delivers.
   */
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
    // The reach and shape a live sample states. The service reads the conic
    // over these elements, so without them it has no orbit to plan against.
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
  });
  emit("vessel.identity", {
    vesselId: "test-vessel",
    name: "Test Vessel",
    vesselType: 0,
    situation: 0,
    parentBodyIndex: 1,
  });

  return { commands };
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
  store.registerDerivedChannel(vesselStateChannel);
  client.attachStore(store);
  client.subscribe("vessel.orbit", () => {});
  setActiveTimelineStoreForTests(store);
  return () => store.beginFrame();
}

/**
 * Every id the service is still guarding against a second fire whose trigger
 * is no longer listed.
 *
 * Reaches into `fired` on purpose: the guard only has an observable effect
 * while its trigger is still listed, so a set that has been accumulating all
 * session behaves exactly like a pruned one from outside.
 */
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
      // apoapsisRadius is 6_771_000 · 1.01, so the condition is already true
      // and the trigger fires at arm time.
      svc.arm({
        dataKey: "vessel.state.apoapsisRadius",
        op: ">=",
        value: 6_000_000,
        inputs: FROZEN,
      });
      await vi.waitFor(() => expect(commands).toContain("vessel.maneuver.add"));
    } finally {
      svc.dispose();
    }
  });

  it("holds no fired id for a trigger that is no longer listed", () => {
    fixture();
    const svc = new LocalManeuverTriggerService();
    try {
      // apoapsisRadius is 6_838_710, so this one stays pending.
      svc.arm({
        dataKey: "vessel.state.apoapsisRadius",
        op: ">=",
        value: 99_000_000,
        inputs: FROZEN,
      });
      // Already true, so this one fires as it is armed and leaves the list, putting its id in `fired`.
      svc.arm({
        dataKey: "vessel.state.apoapsisRadius",
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
        dataKey: "vessel.state.apoapsisRadius",
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
