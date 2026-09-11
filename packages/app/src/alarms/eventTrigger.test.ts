import type { EventOccurrence } from "@ksp-gonogo/sitrep-client";
import { beforeEach, describe, expect, it } from "vitest";
import { AlarmStateMachine } from "./AlarmStateMachine";
import type { Alarm, EventTrigger } from "./types";
import { migrateAlarm } from "./types";

function eventAlarm(trigger: Partial<EventTrigger> = {}): Alarm {
  return {
    id: "a1",
    name: "Event alarm",
    trigger: { kind: "event", topic: "spaceweather.storm", ...trigger },
    state: "pending",
    createdBy: "main",
    createdAt: 0,
    matchSinceUT: null,
  };
}

function occ(ut: number, kind: string): EventOccurrence {
  return { ut, kind, payload: null, epoch: 0 };
}

describe("event alarm trigger", () => {
  let now: number;
  let revealed: EventOccurrence[];
  let alarms: Alarm[];
  let sm: AlarmStateMachine;

  beforeEach(() => {
    now = 100;
    revealed = [];
    alarms = [];
    sm = new AlarmStateMachine(
      () => alarms,
      () => now,
      () => revealed,
    );
  });

  /** One host-style tick: update tracking, then derive + commit state. */
  function tick(alarm: Alarm): void {
    sm.updateEventTracking(alarm, now);
    alarm.state = sm.deriveState(alarm, now);
  }

  it("stays pending on the first tick (establishes the watch baseline)", () => {
    const alarm = eventAlarm();
    alarms.push(alarm);
    revealed.push(occ(105, "storm-arrived"));
    tick(alarm);
    // First tick only records the baseline; nothing fires yet even though an
    // occurrence sits in the buffer.
    expect(alarm.state).toBe("pending");
    expect(alarm.matchSinceUT).toBeNull();
  });

  it("does not replay an occurrence that happened before watching began", () => {
    const alarm = eventAlarm();
    alarms.push(alarm);
    revealed.push(occ(50, "storm-arrived")); // before now=100
    tick(alarm); // baseline = 100
    now = 101;
    tick(alarm);
    expect(alarm.state).toBe("pending");
    expect(alarm.matchSinceUT).toBeNull();
  });

  it("latches and fires on a matching occurrence revealed after watch start", () => {
    const alarm = eventAlarm();
    alarms.push(alarm);
    tick(alarm); // baseline = 100
    // Occurrence happens and reveals after the baseline.
    revealed.push(occ(105, "storm-arrived"));
    now = 106;
    tick(alarm);
    expect(alarm.state).toBe("firing");
    expect(alarm.matchSinceUT).toBe(106); // reveal UT, not the occurrence's ut
    // Settles to fired once the 2s banner window passes.
    now = 109;
    tick(alarm);
    expect(alarm.state).toBe("fired");
  });

  it("keeps the occurrence's own UT, which reveal UT cannot stand in for", () => {
    /*
     * `matchSinceUT` is the REVEAL UT and has to stay that way (it opens the
     * firing window). The occurrence's own `ut` is the number the operator
     * actually asked for, "when did it happen", and under delay the two are
     * far apart: the matcher had it in hand and threw it away.
     */
    const alarm = eventAlarm();
    alarms.push(alarm);
    tick(alarm); // baseline = 100
    revealed.push(occ(105, "storm-arrived"));
    now = 140; // revealed 35s after it happened
    tick(alarm);
    expect(alarm.matchSinceUT).toBe(140);
    expect(alarm.eventUT).toBe(105);
  });

  it("keeps the FIRST matching occurrence's UT when several reveal together", () => {
    const alarm = eventAlarm({ eventKind: "storm-arrived" });
    alarms.push(alarm);
    tick(alarm); // baseline = 100
    revealed.push(occ(104, "storm-ended"));
    revealed.push(occ(106, "storm-arrived"));
    revealed.push(occ(108, "storm-arrived"));
    now = 120;
    tick(alarm);
    expect(alarm.eventUT).toBe(106);
  });

  it("honours the eventKind filter", () => {
    const alarm = eventAlarm({ eventKind: "storm-arrived" });
    alarms.push(alarm);
    tick(alarm); // baseline = 100
    revealed.push(occ(105, "storm-ended")); // different kind
    now = 106;
    tick(alarm);
    expect(alarm.state).toBe("pending");
    // The right kind fires it.
    revealed.push(occ(107, "storm-arrived"));
    now = 108;
    tick(alarm);
    expect(alarm.state).toBe("firing");
  });

  it("stays fired once latched even if the occurrence leaves the buffer", () => {
    const alarm = eventAlarm();
    alarms.push(alarm);
    tick(alarm);
    revealed.push(occ(105, "storm-arrived"));
    now = 106;
    tick(alarm); // firing
    now = 110;
    revealed.length = 0; // buffer evicted the occurrence
    tick(alarm);
    expect(alarm.state).toBe("fired");
  });

  it("is not warp-targetable", () => {
    const alarm = eventAlarm();
    alarms.push(alarm);
    tick(alarm);
    expect(sm.findEligiblePendingAlarm()).toBeNull();
  });

  it("defaults to never firing when no revealed-events reader is wired", () => {
    // The host constructs the state machine without a reader today, an event
    // alarm must sit pending, not throw.
    const bare = new AlarmStateMachine(
      () => alarms,
      () => now,
    );
    const alarm = eventAlarm();
    alarms.push(alarm);
    bare.updateEventTracking(alarm, now);
    now = 200;
    bare.updateEventTracking(alarm, now);
    expect(bare.deriveState(alarm, now)).toBe("pending");
  });
});

describe("migrateAlarm: event trigger", () => {
  it("round-trips a persisted event alarm", () => {
    const migrated = migrateAlarm({
      id: "e1",
      name: "Storm",
      state: "pending",
      createdBy: "main",
      createdAt: 123,
      trigger: {
        kind: "event",
        topic: "spaceweather.storm",
        eventKind: "storm-arrived",
      },
    });
    expect(migrated?.trigger).toEqual({
      kind: "event",
      topic: "spaceweather.storm",
      eventKind: "storm-arrived",
    });
  });

  it("carries the latched occurrence UT across a reload", () => {
    const migrated = migrateAlarm({
      id: "e3",
      name: "Storm",
      state: "fired",
      createdBy: "main",
      createdAt: 123,
      matchSinceUT: 900,
      eventUT: 460,
      trigger: { kind: "event", topic: "spaceweather.storm" },
    });
    expect(migrated?.eventUT).toBe(460);
  });

  it("rejects an event trigger with no topic", () => {
    const migrated = migrateAlarm({
      id: "e2",
      name: "Bad",
      trigger: { kind: "event" },
    });
    expect(migrated).toBeNull();
  });
});
