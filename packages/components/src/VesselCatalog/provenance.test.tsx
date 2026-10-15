import {
  defineUplinkClient,
  effectiveSearchTags,
  getComponents,
  registerAugment,
  uplinkAdditions,
} from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it } from "vitest";
import "./index";

/** The Uplink binding the declared `vessel-catalog.updates` slot is the one credited with extending this widget, in search tags and the picker. */
const RELIABILITY_MOD = defineUplinkClient({
  id: "reliability-mod",
  version: "0.0.0-dev",
  name: "Reliability Mod",
  description: "A test Uplink.",
});

function vesselCatalog() {
  const def = getComponents().find((d) => d.id === "vessel-catalog");
  if (!def) throw new Error("vessel-catalog is not registered");
  return def;
}

describe("VesselCatalog augment provenance", () => {
  beforeEach(() => {
    registerAugment({
      id: "reliability-rows",
      augments: "vessel-catalog.updates",
      owner: RELIABILITY_MOD,
      component: () => null,
    });
  });

  it("credits the Uplink that binds its updates slot as a search tag", () => {
    expect(effectiveSearchTags(vesselCatalog())).toContain("reliability-mod");
  });

  it("lists that Uplink in the picker's extended-by addendum", () => {
    expect(uplinkAdditions(vesselCatalog()).map((u) => u.id)).toContain(
      "reliability-mod",
    );
  });

  // A core widget naming a mod in its own tags is what the boundary rules exist to stop.
  it("names no mod in its own tags", () => {
    expect(vesselCatalog().tags).toEqual(["telemetry"]);
  });
});
