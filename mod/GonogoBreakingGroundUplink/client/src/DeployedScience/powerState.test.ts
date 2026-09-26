import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { type DeployedBase, parseBases } from "./index";

/**
 * Proves a deployed base's power and controller state come from the derived `power` and `controllerConnected` fields, never the localised prose.
 * Every case sets the prose to something that would give the wrong answer.
 */

/** One flat wire entry through the real parser, failing at the fixture if it stops parsing. */
function baseWith(opts: {
  power: DeployedPowerState | null;
  controllerConnected?: boolean | null;
  /** Deliberately misleading prose, to prove nothing reads it. */
  powerState?: string;
  connectionState?: string;
}): DeployedBase[] {
  const bases = parseBases([
    {
      vesselName: "Mun Base",
      partName: "deployedSolarPanel",
      body: "Mun",
      situation: "Landed",
      biome: "Highlands",
      experimentId: "seismicScan",
      scienceCompletedPercentage: 0.5,
      scienceTransmittedPercentage: 0.5,
      scienceValue: 10,
      scienceLimit: 20,
      powerState: opts.powerState ?? "N/A",
      connectionState: opts.connectionState ?? "Not Connected",
      power: opts.power,
      controllerConnected: opts.controllerConnected ?? true,
      deployedOnGround: true,
    },
  ]);
  if (bases === null) throw new Error("the fixture entry did not parse");
  return bases;
}

describe("deployed-science power state", () => {
  it("reads Powered as powered, even when the prose says otherwise", () => {
    const [base] = baseWith({
      power: DeployedPowerState.Powered,
      // A translated "Powered".
      powerState: "Alimentado",
    });
    expect(base?.powered).toBe(true);
    expect(base?.partialPower).toBe(false);
  });

  // The four states that mean not powered, each carrying the prose "Powered".
  it.each([
    ["Unpowered", DeployedPowerState.Unpowered],
    ["ControllerDisabled", DeployedPowerState.ControllerDisabled],
    ["Disabled", DeployedPowerState.Disabled],
    ["NotConnected", DeployedPowerState.NotConnected],
  ])("reads %s as NOT powered", (_name, power) => {
    const [base] = baseWith({ power, powerState: "Powered" });
    expect(base?.powered).toBe(false);
    expect(base?.partialPower).toBe(false);
  });

  // No derived state is a third answer, not "not powered".
  it("reads an absent power state as neither powered nor unpowered", () => {
    const [base] = baseWith({ power: null, powerState: "Powered" });
    expect(base?.powered).toBeNull();
    expect(base?.partialPower).toBe(false);
  });

  // Stock has no partial power state, so nothing may report one.
  it("never reports partial power, for any state", () => {
    for (const power of [
      DeployedPowerState.Powered,
      DeployedPowerState.Unpowered,
      DeployedPowerState.ControllerDisabled,
      DeployedPowerState.Disabled,
      DeployedPowerState.NotConnected,
      null,
    ]) {
      expect(baseWith({ power })[0]?.partialPower).toBe(false);
    }
  });

  it("reads controller attachment from the derived boolean, not the prose", () => {
    expect(
      baseWith({
        power: DeployedPowerState.Powered,
        controllerConnected: true,
        connectionState: "Not Connected",
      })[0]?.controllerEnabled,
    ).toBe(true);
    expect(
      baseWith({
        power: DeployedPowerState.NotConnected,
        controllerConnected: false,
        connectionState: "Connected",
      })[0]?.controllerEnabled,
    ).toBe(false);
  });
});
