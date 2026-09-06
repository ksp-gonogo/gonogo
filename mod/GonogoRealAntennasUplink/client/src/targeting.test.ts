import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllKnownCommandIds,
  getAllKnownTopicIds,
  isCommandId,
  isTopicId,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  renderHook,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
// Side-effect imports: register the targeting Topic and the two commands into the
// SDK's runtime registries.
import { UPLINK_COMMAND_IDS } from "./commands";
import { REALANTENNAS_ANTENNAS_TOPIC } from "./topics";

// src -> client -> GonogoRealAntennasUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function csConst(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "RealAntennasUplink.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in RealAntennasUplink.cs`);
  }
  return m[1];
}

describe("the realantennas.antennas targeting channel", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(REALANTENNAS_ANTENNAS_TOPIC).toBe(csConst("AntennasTopic"));
  });

  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(REALANTENNAS_ANTENNAS_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(REALANTENNAS_ANTENNAS_TOPIC);
  });

  // The channel value is a bare ARRAY, and a client that got an object here
  // would silently render nothing rather than fail: driving a real frame through
  // the decode path is what distinguishes the two.
  it("decodes as an array of antennas, with its angles hydrated", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [REALANTENNAS_ANTENNAS_TOPIC],
    });
    const { result } = renderHook(
      () => {
        const reading = useTelemetry(REALANTENNAS_ANTENNAS_TOPIC);
        return reading.state === "observed" ? reading.value : undefined;
      },
      { wrapper: fixture.Provider },
    );

    fixture.emit(REALANTENNAS_ANTENNAS_TOPIC, [
      {
        antennaId: "4021/0",
        index: 0,
        name: "HG-55 High Gain Antenna",
        steerable: true,
        targeted: true,
        gain: 34.5,
        techLevel: 4,
        beamwidth: 2.5,
        cone3Db: 1.25,
        cone10Db: 2.5,
        minimumDistance: 22903,
        targetKind: "BodyLatLonAlt",
        targetLabel: "Kerbin:(0.00:0.00:-600000)",
        targetBodyName: "Kerbin",
        availableTargetModes: ["BodyCenter", "AzEl"],
        meta: { source: "vessel:1", quality: 1 },
      },
    ]);

    await waitFor(() => {
      expect(result.current?.length).toBe(1);
    });

    const antenna = result.current?.[0];
    expect(antenna?.antennaId).toBe("4021/0");
    // Flags and identifiers stay bare; the angles are quantities and wrap.
    expect(antenna?.steerable).toBe(true);
    expect(antenna?.beamwidth).toMatchObject({ magnitude: 2.5, unit: "°" });
    expect(antenna?.cone3Db).toMatchObject({ magnitude: 1.25, unit: "°" });
    // The mode list is what lets a client offer only what this install allows,
    // so it has to survive decode as an array of plain strings.
    expect(antenna?.availableTargetModes).toEqual(["BodyCenter", "AzEl"]);
  });
});

describe("the two antenna-targeting commands", () => {
  it("register the same strings the C# Uplink declares", () => {
    expect(UPLINK_COMMAND_IDS).toContain(csConst("TargetCommand"));
    expect(UPLINK_COMMAND_IDS).toContain(csConst("TargetHomeCommand"));
  });

  // Without the registerUplinkCommand loop in commands.ts these are unknown ids
  // and `useCommand` refuses to dispatch them, which is silence rather than an
  // error a caller can see.
  it("are known CommandIds once this client's commands module has loaded", () => {
    for (const id of UPLINK_COMMAND_IDS) {
      expect(isCommandId(id), `${id} is not a known CommandId`).toBe(true);
      expect(getAllKnownCommandIds()).toContain(id);
    }
  });
});
