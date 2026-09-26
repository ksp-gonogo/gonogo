import {
  defineUplinkClient,
  effectiveSearchTags,
  getComponents,
  registerAugment,
  uplinkAdditions,
} from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it } from "vitest";
import "./index";

/** The Uplink binding the declared `fleet-roster.updates` slot is the one credited with extending this widget, in search tags and the picker. */
const RELIABILITY_MOD = defineUplinkClient({
  id: "reliability-mod",
  version: "0.0.0-dev",
  name: "Reliability Mod",
});

function fleetRoster() {
  const def = getComponents().find((d) => d.id === "fleet-roster");
  if (!def) throw new Error("fleet-roster is not registered");
  return def;
}

describe("FleetRoster augment provenance", () => {
  beforeEach(() => {
    registerAugment({
      id: "reliability-rows",
      augments: "fleet-roster.updates",
      owner: RELIABILITY_MOD,
      component: () => null,
    });
  });

  it("credits the Uplink that binds its updates slot as a search tag", () => {
    expect(effectiveSearchTags(fleetRoster())).toContain("reliability-mod");
  });

  it("lists that Uplink in the picker's extended-by addendum", () => {
    expect(uplinkAdditions(fleetRoster()).map((u) => u.id)).toContain(
      "reliability-mod",
    );
  });

  // A core widget naming a mod in its own tags is what the boundary rules exist to stop.
  it("names no mod in its own tags", () => {
    expect(fleetRoster().tags).toEqual(["telemetry"]);
  });
});
