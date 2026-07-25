import { beforeEach, describe, expect, it } from "vitest";
import { clearAugments, registerAugment } from "./augments";
import { clearRegistry, registerComponent } from "./registry";
import { effectiveSearchTags } from "./searchTags";
import type { ComponentDefinition } from "./types";
import { defineUplinkClient } from "./uplinkClients";

// Fictional owner tokens ("mod-alpha"/"mod-beta") throughout — a real
// first-party Uplink token only lives inside its own Uplink client dir
// (uplink-boundary ratchet); using one here would trip that ratchet for no
// reason, same choice the mod-search-tags reference branch made.

beforeEach(() => {
  clearRegistry();
  clearAugments();
});

function baseDef(
  overrides: Partial<ComponentDefinition> = {},
): ComponentDefinition {
  return {
    id: "widget",
    name: "Widget",
    description: "",
    tags: ["telemetry"],
    component: () => null,
    ...overrides,
  };
}

describe("effectiveSearchTags", () => {
  it("returns just the widget's own tags when unowned and unaugmented", () => {
    const def = baseDef({ tags: ["telemetry", "control"] });

    expect(effectiveSearchTags(def)).toEqual(["telemetry", "control"]);
  });

  it("adds the owning Uplink client's id (not a hand-set field)", () => {
    const MOD_ALPHA = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.0-dev",
      name: "Mod Alpha",
    });
    const def = baseDef({ tags: ["telemetry"], owner: MOD_ALPHA });

    expect(effectiveSearchTags(def)).toEqual(["telemetry", "mod-alpha"]);
  });

  it("dedupes when the owner id is already present in tags", () => {
    const MOD_ALPHA = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.0-dev",
      name: "Mod Alpha",
    });
    const def = baseDef({ tags: ["mod-alpha"], owner: MOD_ALPHA });

    expect(effectiveSearchTags(def)).toEqual(["mod-alpha"]);
  });

  it("adds a live augment's `requires` token for each augmented slot", () => {
    registerAugment({
      id: "mod-beta-badge",
      augments: "widget.badges",
      requires: "mod-beta",
      component: () => null,
    });
    const def = baseDef({
      tags: ["telemetry"],
      augmentSlots: ["widget.badges"],
    });

    expect(effectiveSearchTags(def)).toEqual(["telemetry", "mod-beta"]);
  });

  it("contributes nothing for an augment slot with no registered augments", () => {
    const def = baseDef({
      tags: ["telemetry"],
      augmentSlots: ["widget.badges"],
    });

    expect(effectiveSearchTags(def)).toEqual(["telemetry"]);
  });

  it("combines the owner tag AND augment-derived tags", () => {
    const MOD_ALPHA = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.0-dev",
      name: "Mod Alpha",
    });
    registerAugment({
      id: "mod-beta-badge",
      augments: "widget.badges",
      requires: "mod-beta",
      component: () => null,
    });
    const def = baseDef({
      tags: ["telemetry"],
      owner: MOD_ALPHA,
      augmentSlots: ["widget.badges"],
    });

    expect(effectiveSearchTags(def)).toEqual([
      "telemetry",
      "mod-alpha",
      "mod-beta",
    ]);
  });
});

describe("registerComponent collision handling is owner-agnostic (task override of spec §3.2)", () => {
  // The operator's task message overrides the design spec's proposed
  // owner-based collision rule: `owner` is for tags/provenance only, never
  // for dedup/collision logic. The registry's PRE-EXISTING behaviour —
  // throw on a DIFFERENT def under the same id, no matter who (if anyone)
  // owns either side — stays exactly as-is. These tests just confirm that
  // still holds once `owner` exists on the def shape.

  it("still throws when two DIFFERENT owners register the same component id", () => {
    const MOD_ALPHA = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.0-dev",
      name: "Mod Alpha",
    });
    const MOD_BETA = defineUplinkClient({
      id: "mod-beta",
      version: "0.0.0-dev",
      name: "Mod Beta",
    });
    registerComponent(baseDef({ id: "shared-id", owner: MOD_ALPHA }));

    expect(() =>
      registerComponent(
        baseDef({ id: "shared-id", name: "Different", owner: MOD_BETA }),
      ),
    ).toThrow(/shared-id/);
  });

  it("does not throw re-registering the exact same owned def (idempotent re-import)", () => {
    const MOD_ALPHA = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.0-dev",
      name: "Mod Alpha",
    });
    const def = baseDef({ id: "same-def", owner: MOD_ALPHA });

    registerComponent(def);
    expect(() => registerComponent(def)).not.toThrow();
  });
});
