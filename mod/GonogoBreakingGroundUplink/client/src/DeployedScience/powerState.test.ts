import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { stationReport } from "../test/deployedStations";
import { parseStation } from "./index";

/**
 * Proves a deployed station's power state comes from the derived `power` ordinal, never from prose.
 * The report carries no prose to read, so the only way to get it wrong is to read the wrong field.
 */

/** One station report through the real parser, failing at the fixture if it stops parsing. */
function stationWith(power: DeployedPowerState | null) {
  const station = parseStation("s", stationReport({ power }));
  if (station === null) throw new Error("the fixture report did not parse");
  return station;
}

describe("deployed-science power state", () => {
  it("reads Powered as powered", () => {
    expect(stationWith(DeployedPowerState.Powered).powered).toBe(true);
  });

  // The four states that mean not powered.
  it.each([
    ["Unpowered", DeployedPowerState.Unpowered],
    ["ControllerDisabled", DeployedPowerState.ControllerDisabled],
    ["Disabled", DeployedPowerState.Disabled],
    ["NotConnected", DeployedPowerState.NotConnected],
  ])("reads %s as NOT powered", (_name, power) => {
    expect(stationWith(power).powered).toBe(false);
  });

  // No derived state is a third answer, not "not powered".
  it("reads an absent power state as neither powered nor unpowered", () => {
    expect(stationWith(null).powered).toBeNull();
  });
});
