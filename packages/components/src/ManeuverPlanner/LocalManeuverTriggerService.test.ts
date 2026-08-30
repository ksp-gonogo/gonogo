import {
  StubTransport,
  setActiveCarriedChannelsForTests,
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
  setActiveCarriedChannelsForTests(new Set(["vessel.maneuver.add"]));

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
    setActiveCarriedChannelsForTests(undefined);
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
});
