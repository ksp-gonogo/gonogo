import {
  registerTopicUnits,
  registerUplinkTopic,
} from "@ksp-gonogo/sitrep-sdk";
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { getTopicFieldCatalog } from "./topicFieldCatalog";

registerUplinkTopic("hydro.cell");
registerTopicUnits("hydro.cell", { outputKw: "kW", tempK: "K" });
defineUplinkClient({
  id: "hydro",
  version: "1.0.0",
  name: "Hydro",
  description: "Fuel cells.",
  tags: {
    topics: { "hydro.cell": { outputKw: { displayName: "Power output" } } },
    names: { "hydro.cell": "Fuel cell" },
  },
});

function labelOf(key: string): string {
  const entry = getTopicFieldCatalog().find((e) => e.key === key);
  if (!entry) throw new Error(`no catalogue entry ${key}`);
  return entry.label;
}

describe("a catalogue entry's label", () => {
  it("is the name the contract declares, which a graph's title and legend read", () => {
    expect(labelOf("vessel.flight.altitudeAsl")).toBe("Altitude (sea level)");
    expect(labelOf("crash.lastCrash.altitude")).toBe("Altitude at impact");
  });

  it("names a nested field by each segment the contract names", () => {
    expect(labelOf("vessel.target.orbit.sma")).toBe("Orbit › Semi-major axis");
  });

  it("is the field's path split into words where the contract names none", () => {
    expect(labelOf("vessel.flight.verticalSpeed")).toBe("Vertical speed");
  });

  it("reads the names an Uplink's contract declares", () => {
    expect(labelOf("hydro.cell.outputKw")).toBe("Power output");
    expect(labelOf("hydro.cell.tempK")).toBe("Temp k");
  });
});
