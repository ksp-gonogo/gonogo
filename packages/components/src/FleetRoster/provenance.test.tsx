import {
  defineUplinkClient,
  effectiveSearchTags,
  getComponents,
  registerAugment,
  uplinkAdditions,
} from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it } from "vitest";
import "./index";

/**
 * Which Uplink is credited with extending this widget.
 *
 * <p>`effectiveSearchTags` and `uplinkAdditions` both walk the widget's
 * DECLARED `augmentSlots` to find the Uplinks binding into it. FleetRoster
 * renders `fleet-roster.updates` and did not declare it, so neither could see
 * the augment: the picker credited nobody, and the search tag was supplied by
 * hand as a literal mod name on the registration instead.</p>
 *
 * <p>That hand-written tag was wrong three ways. It named ONE of the two
 * Uplinks that provide reliability, it stayed on the
 * widget when neither was installed, and it put a mod's name in a core
 * widget's source. Declaring the slot makes the real mechanism answer, and
 * whoever binds gets the credit.</p>
 */
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

  /*
   * The literal is gone rather than merely redundant: a core widget naming one
   * mod is the thing the boundary rules exist to stop, and it was carried in
   * an allowlist entry to keep the gate quiet.
   */
  it("names no mod in its own tags", () => {
    expect(fleetRoster().tags).toEqual(["telemetry"]);
  });
});
