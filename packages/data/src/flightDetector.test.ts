import { beforeEach, describe, expect, it } from "vitest";
import { FlightDetector } from "./flightDetector";

describe("FlightDetector", () => {
  let d: FlightDetector;

  beforeEach(() => {
    d = new FlightDetector();
  });

  it("mints a new flight on the first sample", () => {
    const res = d.observe({
      vesselName: "Kerbal X",
      missionTime: 0,
      now: 1000,
    });
    expect(res.kind).toBe("new");
    expect(res.flight.vesselName).toBe("Kerbal X");
    expect(res.flight.sampleCount).toBe(1);
    expect(d.getCurrent()).toBe(res.flight);
  });

  it("appends to the current flight when vessel + mission time are consistent", () => {
    const a = d.observe({ vesselName: "KX", missionTime: 0, now: 1000 });
    const b = d.observe({ vesselName: "KX", missionTime: 10, now: 11_000 });
    expect(b.kind).toBe("append");
    expect(b.flight.id).toBe(a.flight.id);
    expect(b.flight.sampleCount).toBe(2);
    expect(b.flight.lastMissionTime).toBe(10);
  });

  it("mints a new flight when mission time reverts significantly", () => {
    const a = d.observe({ vesselName: "KX", missionTime: 100, now: 1000 });
    const b = d.observe({ vesselName: "KX", missionTime: 5, now: 2000 });
    expect(b.kind).toBe("new");
    expect(b.flight.id).not.toBe(a.flight.id);
  });

  it("does not mint a new flight on tiny backward drift", () => {
    d.observe({ vesselName: "KX", missionTime: 100, now: 1000 });
    const b = d.observe({
      vesselName: "KX",
      missionTime: 99.5,
      now: 1500,
    });
    expect(b.kind).toBe("append");
  });

  it("resumes a known vessel when seeing it again in-session", () => {
    // First flight.
    const first = d.observe({
      vesselName: "KX",
      missionTime: 10,
      now: 1_000,
    });
    // Control switches to another vessel.
    d.observe({ vesselName: "Lander", missionTime: 0, now: 2_000 });
    expect(d.getCurrent()?.vesselName).toBe("Lander");

    // Control switches back: mission time has advanced a bit.
    const back = d.observe({
      vesselName: "KX",
      missionTime: 20,
      now: 3_000,
    });
    expect(back.kind).toBe("resume");
    expect(back.flight.id).toBe(first.flight.id);
    expect(d.getCurrent()?.id).toBe(first.flight.id);
  });

  it("mints a new flight when a same-named vessel has a fresh mission time (relaunch)", () => {
    const first = d.observe({
      vesselName: "KX",
      missionTime: 120,
      now: 1_000,
    });
    // Another vessel briefly.
    d.observe({ vesselName: "Other", missionTime: 0, now: 2_000 });
    // "KX" returns, but mission time is near zero: relaunch of a ship
    // with the same name.
    const relaunch = d.observe({
      vesselName: "KX",
      missionTime: 0,
      now: 3_000,
    });
    expect(relaunch.kind).toBe("new");
    expect(relaunch.flight.id).not.toBe(first.flight.id);
  });

  it("refuses to resume if too much wall-clock time has passed relative to mission time", () => {
    const first = d.observe({
      vesselName: "KX",
      missionTime: 100,
      now: 1_000,
    });
    // 10 minutes of wall clock, but only 1 second of mission time gained.
    // Too much idle for a resume; treat as new.
    d.observe({ vesselName: "Other", missionTime: 0, now: 2_000 });
    const later = d.observe({
      vesselName: "KX",
      missionTime: 101,
      now: 1_000 + 10 * 60_000,
    });
    expect(later.kind).toBe("new");
    expect(later.flight.id).not.toBe(first.flight.id);
  });

  it("hydrate + resume: survives reload with known vessels", () => {
    const seed = {
      id: "seed-1",
      vesselName: "KX",
      vesselUid: null,
      launchedAt: 0,
      lastSampleAt: 500,
      lastMissionTime: 50,
      sampleCount: 5,
    };
    d.hydrate([seed]);
    // First sample after hydration: same vessel, mission time continues.
    const res = d.observe({
      vesselName: "KX",
      missionTime: 51,
      now: 1_000,
    });
    expect(res.kind).toBe("resume");
    expect(res.flight.id).toBe("seed-1");
    expect(res.flight.sampleCount).toBe(6);
  });

  it("uses vesselUid as the primary key when present", () => {
    const a = d.observe({
      vesselName: "KX",
      vesselUid: "uid-42",
      missionTime: 0,
      now: 1_000,
    });
    // Rename the vessel; UID stays the same, continuation, so "append".
    const b = d.observe({
      vesselName: "KX 2",
      vesselUid: "uid-42",
      missionTime: 10,
      now: 2_000,
    });
    expect(b.kind).toBe("append");
    expect(b.flight.id).toBe(a.flight.id);
  });

  it("resumes via vesselUid after switching to another ship", () => {
    const a = d.observe({
      vesselName: "KX",
      vesselUid: "uid-42",
      missionTime: 0,
      now: 1_000,
    });
    // Switch to a different ship.
    d.observe({
      vesselName: "Other",
      vesselUid: "uid-99",
      missionTime: 0,
      now: 2_000,
    });
    // Switch back: name has been changed, but UID identifies it.
    const back = d.observe({
      vesselName: "Renamed",
      vesselUid: "uid-42",
      missionTime: 10,
      now: 3_000,
    });
    expect(back.kind).toBe("resume");
    expect(back.flight.id).toBe(a.flight.id);
  });

  it("backfills vesselUid onto a heuristically-detected flight once it arrives", () => {
    const a = d.observe({
      vesselName: "KX",
      missionTime: 0,
      now: 1_000,
    });
    expect(a.flight.vesselUid).toBeNull();

    const b = d.observe({
      vesselName: "KX",
      vesselUid: "uid-99",
      missionTime: 1,
      now: 1_250,
    });
    expect(b.flight.id).toBe(a.flight.id);
    expect(b.flight.vesselUid).toBe("uid-99");

    // And a subsequent sample with the UID-only lookup still finds it.
    const c = d.observe({
      vesselName: "Renamed",
      vesselUid: "uid-99",
      missionTime: 2,
      now: 1_500,
    });
    expect(c.flight.id).toBe(a.flight.id);
  });

  it("forget clears the current flight and the next sample mints anew", () => {
    const a = d.observe({
      vesselName: "KX",
      missionTime: 0,
      now: 1_000,
    });
    d.forget(a.flight.id);
    expect(d.getCurrent()).toBeNull();
    const b = d.observe({
      vesselName: "KX",
      missionTime: 1,
      now: 1_500,
    });
    expect(b.kind).toBe("new");
    expect(b.flight.id).not.toBe(a.flight.id);
  });

  it("forgetAll resets every map", () => {
    d.observe({ vesselName: "A", missionTime: 0, now: 1_000 });
    d.observe({ vesselName: "B", missionTime: 0, now: 2_000 });
    d.forgetAll();
    expect(d.getCurrent()).toBeNull();
    const fresh = d.observe({
      vesselName: "A",
      missionTime: 5,
      now: 3_000,
    });
    expect(fresh.kind).toBe("new");
  });
});
