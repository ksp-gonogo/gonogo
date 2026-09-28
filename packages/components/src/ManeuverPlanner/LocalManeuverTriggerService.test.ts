import {
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { CommandErrorCode, value } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { LocalManeuverTriggerService } from "./LocalManeuverTriggerService";
import type { FrozenPlanInputs } from "./triggerTypes";

// Driven through the service over a real TimelineStore, since computePlan cannot see where its body radius came from.
const PINNED_UT = 1_000_000;

const ORBIT = {
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
};

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
  let answer: unknown = null;
  let breaks = false;
  transport.setCommandHandler((command, args) => {
    commands.push(command);
    calls.push({ command, args });
    if (breaks) throw new Error("handler threw");
    return answer;
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
  emit("vessel.orbit", ORBIT);
  emit("vessel.identity", {
    vesselId: "test-vessel",
    name: "Test Vessel",
    vesselType: 0,
    situation: 0,
    parentBodyIndex: 1,
  });

  return {
    commands,
    calls,
    /** What the mod answers every command with from here on. */
    answerWith(result: unknown) {
      answer = result;
    },
    /** Every command from here on comes back as an error frame with no typed reason. */
    breakHandler() {
      breaks = true;
    },
    emit,
  };
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

/** The first listed trigger's dispatch failure, once one has been recorded. */
async function failureOf(svc: LocalManeuverTriggerService) {
  await vi.waitFor(() =>
    expect(svc.snapshot().triggers[0]?.failure).toBeDefined(),
  );
  const failure = svc.snapshot().triggers[0].failure;
  if (failure?.kind !== "dispatch") throw new Error(`no dispatch failure`);
  return failure;
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

  it("plans a node from the received edge, and sends one that lands in time", async () => {
    const { calls } = fixture();
    // A light-time of 240 s: the craft is at PINNED_UT, the screen has it from 240 s earlier, and a command lands 240 s later.
    setActiveViewClockForTests({
      viewUt: () => PINNED_UT - 240,
      scetUt: () => PINNED_UT,
      commandArrivalUt: () => PINNED_UT + 240,
    });
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: {
          ...FROZEN,
          preset: "custom-ut",
          prograde: 10,
          burnInSeconds: 1_000,
        },
      });
      await vi.waitFor(() =>
        expect(calls.map((c) => c.command)).toContain("vessel.maneuver.add"),
      );
      const args = calls.find((c) => c.command === "vessel.maneuver.add")?.args;
      const ut =
        typeof args === "object" && args !== null && "ut" in args
          ? args.ut
          : undefined;
      expect(ut).toBeCloseTo(PINNED_UT - 240 + 1_000, 0);
    } finally {
      svc.dispose();
    }
  });

  it("sends nothing for a node that would land after its own time, and lists the trigger with its refusal", async () => {
    const { calls } = fixture();
    setActiveViewClockForTests({
      viewUt: () => PINNED_UT - 240,
      scetUt: () => PINNED_UT,
      commandArrivalUt: () => PINNED_UT + 240,
    });
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: {
          ...FROZEN,
          preset: "custom-ut",
          prograde: 10,
          burnInSeconds: 60,
        },
      });
      const [refusal] = (await failureOf(svc)).refused;
      expect(refusal.errorCode).toBe(CommandErrorCode.Range);
      expect(refusal.command).toBe("vessel.maneuver.add");
      expect(refusal.detail).toMatch(/at or after the time it acts at/);
      expect(calls.map((c) => c.command)).not.toContain("vessel.maneuver.add");
    } finally {
      svc.dispose();
    }
  });

  it("lists a fired trigger with the mod's own refusal", async () => {
    const { answerWith } = fixture();
    answerWith({
      success: false,
      errorCode: CommandErrorCode.NoVessel,
      detail: "no active vessel",
    });
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: FROZEN,
      });
      const refusals = (await failureOf(svc)).refused;
      expect(refusals.length).toBeGreaterThan(0);
      expect(
        refusals.every((r) => r.errorCode === CommandErrorCode.NoVessel),
      ).toBe(true);
      expect(refusals[0].detail).toBe("no active vessel");
    } finally {
      svc.dispose();
    }
  });

  it("clears a trigger whose nodes were taken, and lists no refusal for it", async () => {
    const { commands } = fixture();
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: FROZEN,
      });
      await vi.waitFor(() => expect(commands).toContain("vessel.maneuver.add"));
      // The answers settle on microtasks; give every one of them its turn before looking.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(svc.snapshot().triggers).toEqual([]);
    } finally {
      svc.dispose();
    }
  });

  it("never fires a refused trigger again, and dismissing it removes it", async () => {
    const { commands, answerWith } = fixture();
    answerWith({ success: false, errorCode: CommandErrorCode.NoVessel });
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: { ...FROZEN, preset: "custom-ut", prograde: 10 },
      });
      await failureOf(svc);
      const sent = commands.length;
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 99_000_000,
        inputs: FROZEN,
      });
      expect(commands).toHaveLength(sent);
      const refused = svc.snapshot().triggers.find((t) => t.failure);
      svc.cancel(refused?.id ?? "");
      expect(svc.snapshot().triggers.some((t) => t.failure)).toBe(false);
    } finally {
      svc.dispose();
    }
  });

  it("lists a fired trigger whose plan cannot be computed, with nothing sent, and never fires it again", () => {
    const { commands } = fixture();
    const svc = new LocalManeuverTriggerService();
    try {
      // A rendezvous with no target: the orbit is there, the plan is not.
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: { ...FROZEN, preset: "hohmann-rendezvous-target" },
      });
      const [trigger] = svc.snapshot().triggers;
      expect(trigger.failure).toEqual({ kind: "no-plan", reason: "no-target" });
      expect(commands).toEqual([]);
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 99_000_000,
        inputs: FROZEN,
      });
      expect(commands).toEqual([]);
      svc.cancel(trigger.id);
      expect(svc.snapshot().triggers.some((t) => t.failure)).toBe(false);
    } finally {
      svc.dispose();
    }
  });

  it("lists a fired trigger with no orbit to plan from", () => {
    const { commands, emit } = fixture();
    const { horizon: _horizon, ...unbounded } = ORBIT;
    emit("vessel.orbit", unbounded);
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: FROZEN,
      });
      expect(svc.snapshot().triggers[0]?.failure).toEqual({
        kind: "no-plan",
        reason: "no-orbit",
      });
      expect(commands).toEqual([]);
    } finally {
      svc.dispose();
    }
  });

  it("lists a fired trigger whose node came back as an error frame as failed, not refused", async () => {
    const { breakHandler } = fixture();
    breakHandler();
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: { ...FROZEN, preset: "custom-ut", prograde: 10 },
      });
      const failure = await failureOf(svc);
      expect(failure.failed).toHaveLength(1);
      expect(failure.failed[0].command).toBe("vessel.maneuver.add");
      expect(failure.refused).toEqual([]);
    } finally {
      svc.dispose();
    }
  });

  it("lists a trigger fired with no stream mounted as never sent", async () => {
    fixture();
    setActiveTelemetryClientForTests(undefined);
    const svc = new LocalManeuverTriggerService();
    try {
      svc.arm({
        dataKey: "vessel.orbit.sma",
        op: ">=",
        value: 6_000_000,
        inputs: { ...FROZEN, preset: "custom-ut", prograde: 10 },
      });
      const failure = await failureOf(svc);
      expect(failure.undelivered).toHaveLength(1);
      expect(failure.refused).toEqual([]);
      expect(failure.failed).toEqual([]);
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
