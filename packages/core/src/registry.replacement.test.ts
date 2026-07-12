import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRegistry,
  getReplacementConflicts,
  getResolvedComponents,
  registerComponent,
} from "./registry";
import type { ComponentDefinition } from "./types";

// Minimal component definition — only the fields the replacement resolver reads
// (`id`, `replaces`) matter here; the rest satisfy the type.
function def(id: string, replaces?: string): ComponentDefinition {
  return {
    id,
    name: id,
    description: "",
    tags: [],
    component: () => null,
    replaces,
  };
}

beforeEach(() => clearRegistry());

describe("widget replacement (spec §4.5)", () => {
  it("suppresses the original when exactly one widget replaces it", () => {
    registerComponent(def("power-systems"));
    registerComponent(def("kerbalism-power-systems", "power-systems"));
    registerComponent(def("unrelated"));

    const ids = getResolvedComponents()
      .map((c) => c.id)
      .sort();

    expect(ids).toEqual(["kerbalism-power-systems", "unrelated"]);
    expect(getReplacementConflicts()).toEqual([]);
  });

  it("surfaces a conflict when two widgets replace the same target, without silently merging", () => {
    registerComponent(def("power-systems"));
    registerComponent(def("kerbalism-power-systems", "power-systems"));
    registerComponent(def("nfe-power-systems", "power-systems"));

    const conflicts = getReplacementConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.targetId).toBe("power-systems");
    expect([...(conflicts[0]?.replacerIds ?? [])].sort()).toEqual([
      "kerbalism-power-systems",
      "nfe-power-systems",
    ]);

    // Conflict resolution: original kept, both competing replacers withheld
    // until the user picks — never both rendered (no silent merge).
    const ids = getResolvedComponents().map((c) => c.id);
    expect(ids).toEqual(["power-systems"]);
  });

  it("renders a replacer whose target is not registered as an ordinary component", () => {
    registerComponent(def("mine", "does-not-exist"));

    expect(getResolvedComponents().map((c) => c.id)).toEqual(["mine"]);
    expect(getReplacementConflicts()).toEqual([]);
  });
});
