import { beforeEach, describe, expect, it } from "vitest";
import { AlarmStateMachine } from "./AlarmStateMachine";
import type { Alarm, ThresholdTrigger } from "./types";
import { isScetTrigger, migrateAlarm, scetThresholdAddress } from "./types";

/**
 * A threshold armed on the craft's clock is the mod's to evaluate, and these
 * pin the two halves of that on this side: the client does not decide it, and
 * the address it was armed with survives a reload.
 *
 * There is no comparison to test here on purpose. The comparison runs in
 * `Sitrep.Host.Alarms.ScetAlarmRoster`, against the value the simulation holds,
 * and duplicating it here would be a second implementation drifting from the
 * one that actually decides.
 */
function thresholdAlarm(trigger: Partial<ThresholdTrigger> = {}): Alarm {
  return {
    id: "a1",
    name: "Above 100 km",
    trigger: {
      kind: "threshold",
      dataKey: "vessel.flight.altitudeAsl",
      op: ">=",
      value: 100_000,
      sustainSeconds: 30,
      ...trigger,
    },
    state: "pending",
    createdBy: "main",
    createdAt: 0,
    matchSinceUT: null,
  };
}

function scetAlarm(trigger: Partial<ThresholdTrigger> = {}): Alarm {
  return thresholdAlarm({
    vantage: "scet",
    topic: "vessel.flight",
    fieldPath: "altitudeAsl",
    ...trigger,
  });
}

describe("SCET threshold trigger", () => {
  let now: number;
  let alarms: Alarm[];
  let sm: AlarmStateMachine;

  beforeEach(() => {
    now = 1000;
    alarms = [];
    sm = new AlarmStateMachine(
      () => alarms,
      () => now,
    );
  });

  it("is a SCET trigger, and a command-vantage threshold is not", () => {
    expect(isScetTrigger(scetAlarm().trigger)).toBe(true);
    expect(isScetTrigger(thresholdAlarm().trigger)).toBe(false);
  });

  it("does not track the match here, and does not touch the latch", () => {
    const alarm = scetAlarm();
    alarms.push(alarm);
    // The latch is the field the mod's fire notice writes. Tracking it from
    // this side would clear one the mod set, or set one the mod never will,
    // off a reading that is a light-time old by construction.
    expect(sm.updateThresholdTracking(alarm, now, now - 1)).toBe(false);
    expect(alarm.matchSinceUT).toBeNull();
  });

  it("stays pending until the notice latches it, then runs the banner window", () => {
    const alarm = scetAlarm();
    alarms.push(alarm);
    expect(sm.deriveState(alarm, now, now - 1)).toBe("pending");

    // What `AlarmHostService.onScetFired` does with the mod's notice.
    alarm.matchSinceUT = now;
    expect(sm.deriveState(alarm, now, now - 1)).toBe("firing");
    expect(sm.deriveState(alarm, now + 5, now)).toBe("fired");
  });

  it("does not wait out its own sustain window, because the mod already did", () => {
    const alarm = scetAlarm({ sustainSeconds: 600 });
    alarms.push(alarm);
    alarm.matchSinceUT = now;
    /* A command-vantage threshold comes due at `matchSinceUT + sustain`. This
       one is latched by a notice the mod only sends once the window is already
       satisfied, so adding the window again here would hold the banner back by
       a second copy of a wait that has happened. */
    expect(sm.deriveState(alarm, now, now - 1)).toBe("firing");
  });

  it("is not a warp-to target, because the stop happens upstream of us", () => {
    const scet = scetAlarm();
    const ordinary = thresholdAlarm();
    ordinary.id = "a2";
    alarms.push(scet);
    expect(sm.findEligiblePendingAlarm()).toBeNull();
    // And it never caps the ladder as an unmodelable one would: there is
    // nothing for extra ticks to buy.
    expect(sm.hasUnmodelableThresholdOther(ordinary)).toBe(false);

    alarms.push(ordinary);
    expect(sm.findEligiblePendingAlarm()?.id).toBe("a2");
  });

  it("keeps the command-vantage threshold evaluating exactly as before", () => {
    const alarm = thresholdAlarm({ sustainSeconds: 0 });
    alarms.push(alarm);
    // No stream behind it, so the read fails and the latch is left alone: the
    // three-answer rule, unchanged by the SCET arm existing.
    expect(sm.updateThresholdTracking(alarm, now, now - 1)).toBe(false);
    expect(sm.deriveState(alarm, now, now - 1)).toBe("pending");
  });
});

describe("SCET threshold migration", () => {
  function persisted(trigger: Record<string, unknown>): unknown {
    return {
      id: "a1",
      name: "Above 100 km",
      state: "pending",
      createdBy: "main",
      createdAt: 0,
      trigger: {
        kind: "threshold",
        dataKey: "vessel.flight.altitudeAsl",
        op: ">=",
        value: 100_000,
        sustainSeconds: 0,
        ...trigger,
      },
    };
  }

  it("keeps an addressed SCET threshold on the craft's clock", () => {
    const alarm = migrateAlarm(
      persisted({
        vantage: "scet",
        topic: "vessel.flight",
        fieldPath: "altitudeAsl",
      }),
    );
    expect(alarm?.trigger).toMatchObject({
      vantage: "scet",
      topic: "vessel.flight",
      fieldPath: "altitudeAsl",
    });
    expect(alarm ? scetThresholdAddress(alarm.trigger) : null).toEqual({
      topic: "vessel.flight",
      fieldPath: "altitudeAsl",
    });
  });

  it("demotes a SCET threshold that carries no address", () => {
    const alarm = migrateAlarm(persisted({ vantage: "scet" }));
    /* There is nothing to arm, so on the craft's clock it would sit pending
       for ever with nothing on screen saying why. On the command vantage it is
       at least an alarm the operator can watch working. */
    expect(alarm?.trigger).toMatchObject({ vantage: "command" });
    expect(alarm ? scetThresholdAddress(alarm.trigger) : "x").toBeNull();
  });

  it("reads an absent vantage as the command one", () => {
    const alarm = migrateAlarm(persisted({}));
    // Every threshold persisted before this arm existed has no vantage field,
    // and must keep the behaviour it had.
    expect(alarm?.trigger).toMatchObject({ vantage: "command" });
  });
});
