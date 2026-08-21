import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { parseBases } from "./index";

/**
 * A deployed base's power readout, against what the mod actually sends.
 *
 * This is the one item in the 2026-08-21 KSP-enum sweep that was NOT an enum
 * problem, and the distinction is the whole fix.
 * `ModuleGroundSciencePart.PowerState` and `.ConnectionState` are `public string`
 * fields that `UpdateModuleUI()` assigns LOCALISED PROSE to, out of
 * `Localizer`. Decompiled from the installed build:
 *
 * ```
 * PowerState      #autoLOC_7003285 "N/A"       | 8002241 "Powered"
 *                 8002242 "Unpowered"          | 8002253 "Controller Disabled"
 *                 8002243 "Disabled"
 * ConnectionState #autoLOC_8002240 "Connected" | 8002244 "Not Connected"
 * ```
 *
 * So there was no ordinal to put on the wire, and no comparison against those
 * strings could be made correct. The old client tested `=== "Powered"` and
 * `=== "NoPower"` - a string KSP has never emitted - so `Unpowered`,
 * `Disabled`, `Controller Disabled` and `N/A` all fell off the end into
 * `powered: true`, and an unpowered cluster painted as a working one on a
 * reduced supply. In English. The localised half was worse: a translated
 * "Powered" also read partially-powered, and a translated "Connected" read
 * not-connected.
 *
 * The mod now derives `power` (our own `DeployedPowerState` ordinal) and
 * `controllerConnected` from the four booleans stock's own readout branches on,
 * and the prose rides along as the display label it always was. These tests feed
 * the derived fields and, crucially, feed them ALONGSIDE prose that disagrees:
 * every case below would pass by accident if the widget were still reading the
 * strings, so each one sets the prose to something that would give the wrong
 * answer.
 */

function baseWith(opts: {
  power: DeployedPowerState | null;
  controllerConnected?: boolean | null;
  /** Deliberately misleading prose, to prove nothing reads it. */
  powerState?: string;
  connectionState?: string;
}) {
  return parseBases([
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
}

describe("deployed-science power state", () => {
  it("reads Powered as powered, even when the prose says otherwise", () => {
    const [base] = baseWith({
      power: DeployedPowerState.Powered,
      // A translated "Powered": the old code read this as partially powered.
      powerState: "Alimentado",
    });
    expect(base?.powered).toBe(true);
    expect(base?.partialPower).toBe(false);
  });

  /**
   * The four states that mean NOT POWERED. Every one of them used to read
   * `powered: true`. Each carries the prose "Powered" here, so the only way to
   * get the right answer is to ignore it.
   */
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

  /**
   * No derived state at all - an older mod build, or a cluster the capture could
   * not read. Not powered, because we cannot claim it is; and NOT partially
   * powered, which is the invented middle state the old fall-through produced.
   */
  it("reads an absent power state as not powered, and never as partial", () => {
    const [base] = baseWith({ power: null, powerState: "Powered" });
    expect(base?.powered).toBe(false);
    expect(base?.partialPower).toBe(false);
  });

  /**
   * `partialPower` has no producer and never did: stock distinguishes powered
   * from not, with no partial state, so the flag was only ever set by the
   * fall-through that was the bug. Pinned at false across every state so a
   * future change cannot quietly reintroduce a middle reading nothing supplies.
   */
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

  /**
   * The connection half. The old test was `connectionState === "Connected"`, so
   * a localised "Connected" read as disconnected; here the prose says
   * "Not Connected" while the derived boolean says otherwise.
   */
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
