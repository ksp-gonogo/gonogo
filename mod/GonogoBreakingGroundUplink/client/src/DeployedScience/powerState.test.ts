import { describe, expect, it } from "vitest";
import { parseBases } from "./index";

/**
 * What a deployed base's POWER readout does with the strings KSP actually sends.
 *
 * This one is not the enum-ordinal defect the rest of the 2026-08-21 sweep is
 * about, and the difference matters. `ModuleGroundSciencePart.PowerState` and
 * `.ConnectionState` are not enums at all: they are `public string` fields that
 * `UpdateModuleUI()` assigns LOCALISED PROSE to, straight out of
 * `Localizer.Format`. Decompiled from the installed build:
 *
 * ```
 * PowerState      #autoLOC_7003285 "N/A"      | 8002241 "Powered"
 *                 8002242 "Unpowered"         | 8002253 "Controller Disabled"
 *                 8002243 "Disabled"
 * ConnectionState #autoLOC_8002240 "Connected" | 8002244 "Not Connected"
 * ```
 *
 * So there is no ordinal to put on the wire, and the value depends on the
 * player's KSP language. `powerFromState` reads:
 *
 * ```ts
 * if (powerState === "Powered") return { powered: true,  partialPower: false };
 * if (!powerState || powerState === "NoPower") return { powered: false, ... };
 * return { powered: true, partialPower: true };
 * ```
 *
 * `"NoPower"` is a string KSP has never emitted, so the middle arm only ever
 * catches an ABSENT value, and every real not-powered state falls off the end
 * into `powered: true`. That is a live bug in English, before any question of
 * localisation.
 *
 * These tests pin the CURRENT behaviour so the fix has something to break. Each
 * one names what the operator sees today and what they should see.
 */

function baseWith(powerState: string, connectionState = "Connected") {
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
      powerState,
      connectionState,
      deployedOnGround: true,
    },
  ]);
}

describe("deployed-science power state, as KSP actually reports it", () => {
  it("reads 'Powered' as powered", () => {
    const [base] = baseWith("Powered");
    expect(base?.powered).toBe(true);
    expect(base?.partialPower).toBe(false);
  });

  /**
   * The three states that mean NOT POWERED. Every one of them currently reads
   * `powered: true` with a partial-power flag, so an unpowered cluster paints as
   * a working one on a partial supply. `Unpowered` is the plain case;
   * `Controller Disabled` and `Disabled` are the operator having switched it off
   * or the controller being off.
   */
  it.each([
    "Unpowered",
    "Disabled",
    "Controller Disabled",
  ])("currently reads %s as POWERED, which is the bug", (state) => {
    const [base] = baseWith(state);
    expect(base?.powered).toBe(true);
    expect(base?.partialPower).toBe(true);
  });

  /**
   * `N/A` is what `UpdateModuleUI` assigns before it works anything out, so it
   * is the "no reading" case and reads as powered too.
   */
  it("currently reads N/A as POWERED", () => {
    const [base] = baseWith("N/A");
    expect(base?.powered).toBe(true);
  });

  /**
   * The only arm that behaves: an empty value is treated as unpowered. Note this
   * is the arm the `"NoPower"` literal was written for, and the literal
   * contributes nothing, because KSP never sends it.
   */
  it("reads an empty power state as not powered", () => {
    const [base] = baseWith("");
    expect(base?.powered).toBe(false);
    expect(base?.partialPower).toBe(false);
  });

  /**
   * The localisation half. In any non-English KSP, `Powered` arrives as its
   * translation, misses the first arm, and falls to the last one: powered with a
   * partial flag. So a fully-powered base is reported as partially powered for
   * every player not running English.
   */
  it("currently mis-reads a localised 'Powered' as only partially powered", () => {
    const [base] = baseWith("Alimentado");
    expect(base?.powered).toBe(true);
    expect(base?.partialPower).toBe(true);
  });

  /**
   * `controllerEnabled` is `connectionState === "Connected"`, so the English
   * `Not Connected` is correctly false - by accident, since ANY string that is
   * not exactly `"Connected"` is false. The same accident makes a localised
   * `Connected` read as disconnected.
   */
  it("currently mis-reads a localised 'Connected' as not connected", () => {
    expect(baseWith("Powered", "Connected")[0]?.controllerEnabled).toBe(true);
    expect(baseWith("Powered", "Not Connected")[0]?.controllerEnabled).toBe(
      false,
    );
    expect(baseWith("Powered", "Conectado")[0]?.controllerEnabled).toBe(false);
  });
});
