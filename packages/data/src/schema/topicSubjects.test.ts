import {
  registerTopicUnits,
  registerUplinkTopic,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { getTopicFieldCatalog } from "./topicFieldCatalog";
import { seriesChoice } from "./topicSubjects";

registerUplinkTopic("acme.reactor");
registerTopicUnits("acme.reactor", { coreTempK: "K" });

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

  it("files an Uplink's field under the Uplink's own name", () => {
    expect(choiceOf("acme.reactor.coreTempK")).toMatchObject({
      group: "Acme",
      label: "Reactor › Core temp k",
    });
  });
});
