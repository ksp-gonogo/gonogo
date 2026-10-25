import {
  registerTopicUnits,
  registerUplinkTopic,
} from "@ksp-gonogo/sitrep-sdk";
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { getTopicFieldCatalog } from "./topicFieldCatalog";
import { seriesChoice } from "./topicSubjects";

registerUplinkTopic("acme.reactor");
registerTopicUnits("acme.reactor", { coreTempK: "K" });
registerUplinkTopic("hydro.cell");
registerTopicUnits("hydro.cell", { outputKw: "kW" });
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

function choiceOf(key: string) {
  const entry = getTopicFieldCatalog().find((e) => e.key === key);
  if (!entry) throw new Error(`no catalogue entry ${key}`);
  return seriesChoice(entry);
}

describe("seriesChoice", () => {
  it("tells two altitudes apart by what they describe", () => {
    expect(choiceOf("vessel.flight.altitudeAsl").summary).toBe(
      "Active vessel › Altitude (sea level)",
    );
    expect(choiceOf("crash.lastCrash.altitude").summary).toBe(
      "Last crash › Altitude at impact",
    );
  });

  it("lists the active vessel's flight first and nothing from a crash", () => {
    expect(choiceOf("vessel.flight.altitudeAsl").common).toBe(true);
    expect(choiceOf("crash.lastCrash.altitude").common).toBe(false);
  });

  it("reads the names an Uplink's contract declares", () => {
    expect(choiceOf("hydro.cell.outputKw")).toMatchObject({
      group: "Hydro",
      label: "Fuel cell › Power output",
    });
  });

  it("files an Uplink's field under the Uplink's own name", () => {
    expect(choiceOf("acme.reactor.coreTempK")).toMatchObject({
      group: "Acme",
      label: "Reactor › Core temp k",
    });
  });
});
