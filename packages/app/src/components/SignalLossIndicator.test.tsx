import { describe, expect, it } from "vitest";
import { deriveState } from "./SignalLossIndicator";

// deriveState(connected, signalStrength, controlState, hasConfirmedConnection)
// A healthy strength for the cases not exercising the 0%-signal path.
const OK = 0.87;

describe("SignalLossIndicator — deriveState", () => {
  it("treats absent telemetry as connected (warmup hides the banner)", () => {
    expect(deriveState(undefined, undefined, undefined, false)).toBe(
      "connected",
    );
    expect(deriveState(undefined, undefined, undefined, true)).toBe(
      "connected",
    );
  });

  it("does not flash the banner when controlState arrives before connected", () => {
    // Cold-start order can land controlState=0 before comm.connected. Until
    // `connected` has been confirmed true we have no business asserting a
    // blackout or partial-control state.
    expect(deriveState(undefined, OK, 0, false)).toBe("connected");
    expect(deriveState(undefined, OK, 1, false)).toBe("connected");
    expect(deriveState(undefined, OK, 2, false)).toBe("connected");
  });

  it("reports connected when comm.connected is true and controlState is full", () => {
    expect(deriveState(true, OK, 2, true)).toBe("connected");
  });

  it("does NOT report lost on a cold-start false (hasConfirmedConnection = false)", () => {
    // Mirrors BufferedDataSource's gate: a user whose KSP reports false
    // without ever asserting true (CommNet off, no antenna, no vessel)
    // should see data flow AND a quiet banner, not a flashing blackout.
    expect(deriveState(false, OK, 2, false)).toBe("connected");
    expect(deriveState(false, OK, 1, false)).toBe("connected");
    expect(deriveState(false, OK, 0, false)).toBe("connected");
    expect(deriveState(false, undefined, undefined, false)).toBe("connected");
  });

  it("does NOT report lost on cold-start 0% signal (hasConfirmedConnection = false)", () => {
    // A 0% reading before any confirmed link (no antenna) must stay quiet,
    // same gate as a cold-start false.
    expect(deriveState(undefined, 0, undefined, false)).toBe("connected");
    expect(deriveState(true, 0, 2, false)).toBe("connected");
  });

  it("reports lost when we've seen a confirmed link and it dropped", () => {
    expect(deriveState(false, OK, 2, true)).toBe("lost");
    expect(deriveState(false, 0, 0, true)).toBe("lost");
    expect(deriveState(false, undefined, undefined, true)).toBe("lost");
  });

  it("reports lost on 0% signal even when connected was never observed false", () => {
    // A link that decayed to nothing (0% strength) reads as SIGNAL LOSS once a
    // link has been confirmed, regardless of the connected flag's last value.
    expect(deriveState(true, 0, 2, true)).toBe("lost");
    expect(deriveState(undefined, 0, undefined, true)).toBe("lost");
  });

  it("does NOT report lost on a weak-but-present link", () => {
    // 1% is weak but present — not SIGNAL LOSS.
    expect(deriveState(true, 0.01, 2, true)).toBe("connected");
  });

  it("reports partial for reduced-control states while connected is confirmed true", () => {
    expect(deriveState(true, OK, 1, true)).toBe("partial");
    expect(deriveState(true, OK, 0, true)).toBe("partial");
  });
});
