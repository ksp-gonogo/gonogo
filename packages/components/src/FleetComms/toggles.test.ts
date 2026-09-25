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
    expect(getFleetCommsToggles("sv")).toEqual({
      showCommlinks: true,
      showCommandTraffic: true,
    });
  });

  it("setShowCommlinks flips only that toggle", () => {
    setShowCommlinks("sv", false);
    expect(getFleetCommsToggles("sv")).toEqual({
      showCommlinks: false,
      showCommandTraffic: true,
    });
  });

  it("setShowCommandTraffic flips only that toggle", () => {
    setShowCommandTraffic("sv", false);
    expect(getFleetCommsToggles("sv")).toEqual({
      showCommlinks: true,
      showCommandTraffic: false,
    });
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeFleetCommsToggles(() => {
      calls++;
    });
    setShowCommlinks("sv", false);
    expect(calls).toBe(1);
    unsubscribe();
    setShowCommandTraffic("sv", false);
    expect(calls).toBe(1);
  });

  it("keeps each instance's toggles apart", () => {
    setShowCommlinks("sv", false);
    expect(getFleetCommsToggles("sv").showCommlinks).toBe(false);
    expect(getFleetCommsToggles("other").showCommlinks).toBe(true);
  });

  it("returns a referentially stable snapshot when nothing changed", () => {
    const a = getFleetCommsToggles("sv");
    const b = getFleetCommsToggles("sv");
    expect(a).toBe(b);
    setShowCommlinks("sv", false);
    const c = getFleetCommsToggles("sv");
    expect(c).not.toBe(a);
  });
});
