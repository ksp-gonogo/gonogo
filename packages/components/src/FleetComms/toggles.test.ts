import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetFleetCommsTogglesForTests,
  getFleetCommsToggles,
  setShowCommandTraffic,
  setShowCommlinks,
  subscribeFleetCommsToggles,
} from "./toggles";

describe("FleetComms toggle store", () => {
  beforeEach(() => {
    __resetFleetCommsTogglesForTests();
  });
  afterEach(() => {
    __resetFleetCommsTogglesForTests();
  });

  it("defaults both toggles on", () => {
    expect(getFleetCommsToggles()).toEqual({
      showCommlinks: true,
      showCommandTraffic: true,
    });
  });

  it("setShowCommlinks flips only that toggle", () => {
    setShowCommlinks(false);
    expect(getFleetCommsToggles()).toEqual({
      showCommlinks: false,
      showCommandTraffic: true,
    });
  });

  it("setShowCommandTraffic flips only that toggle", () => {
    setShowCommandTraffic(false);
    expect(getFleetCommsToggles()).toEqual({
      showCommlinks: true,
      showCommandTraffic: false,
    });
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeFleetCommsToggles(() => {
      calls++;
    });
    setShowCommlinks(false);
    expect(calls).toBe(1);
    unsubscribe();
    setShowCommandTraffic(false);
    expect(calls).toBe(1);
  });

  it("returns a referentially stable snapshot when nothing changed", () => {
    const a = getFleetCommsToggles();
    const b = getFleetCommsToggles();
    expect(a).toBe(b);
    setShowCommlinks(false);
    const c = getFleetCommsToggles();
    expect(c).not.toBe(a);
  });
});
