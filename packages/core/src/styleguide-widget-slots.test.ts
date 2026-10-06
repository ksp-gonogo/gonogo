// @vitest-environment node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coreDuplicateDeclarations,
  coreWidgetSlots,
  duplicateDeclarations,
  PLANTED_KEYS,
  sdkRegistryKeys,
  slotDrift,
  widgetSlotsOf,
} from "./widget-slots.scan";

/**
 * A core widget's registration names exactly the slots the sdk's registries
 * declare for it, and `packages/components` never declares a registry key the
 * sdk already declares. The Uplink README reads the first and the reference
 * site reads the second, so they must agree, and the published declaration is
 * the only text a slot has.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const KEYS = sdkRegistryKeys(REPO_ROOT);
const WIDGETS = coreWidgetSlots(REPO_ROOT);

describe("design-system: widget slots are named once and agree", () => {
  it("sees a planted slot drift both ways", () => {
    const widgets = widgetSlotsOf([
      {
        path: "planted.tsx",
        text: [
          'const PLANTED_FEED = "planted.feed";',
          "registerComponent({",
          '  id: "planted",',
          '  augmentSlots: ["planted.both", "planted.missing"],',
          '  contributionSlots: [PLANTED_FEED, "plots"],',
          "});",
        ].join("\n"),
      },
    ]);
    expect(
      slotDrift(widgets, PLANTED_KEYS),
      "BLIND: a named slot no registry declares, and a declared slot the registration omits, must both be reported",
    ).toEqual([
      'planted: augmentSlots names "planted.missing", which SlotRegistry does not declare',
      'planted: SlotRegistry declares "planted.declared", which the registration does not name',
    ]);
  });

  it("sees a planted duplicate declaration", () => {
    const found = duplicateDeclarations(
      [
        {
          path: "planted.ts",
          text: [
            'declare module "@ksp-gonogo/core" {',
            "  interface SlotRegistry {",
            '    "planted.declared": Record<string, never>;',
            '    "planted.own": Record<string, never>;',
            "  }",
            "  interface WidgetScopeRegistry {",
            "    planted: { body: string };",
            "  }",
            "}",
          ].join("\n"),
        },
      ],
      PLANTED_KEYS,
    ).map((d) => `${d.registry}:${d.key}`);
    expect(
      found,
      "BLIND: a key the sdk declares, declared again in a components file, must be reported",
    ).toEqual(["SlotRegistry:planted.declared", "WidgetScopeRegistry:planted"]);
  });

  it("reads the registries and the core widgets", () => {
    console.info(
      `[widget-slots] ${WIDGETS.length} widgets, ${KEYS.SlotRegistry.size} augment slots, ${KEYS.ContributionRegistry.size} contribution slots`,
    );
    expect(WIDGETS.length).toBeGreaterThanOrEqual(30);
    expect(KEYS.SlotRegistry.size).toBeGreaterThan(20);
    expect(KEYS.ContributionRegistry.size).toBeGreaterThan(5);
  });

  it("finds every core widget's registration agreeing with the registries", () => {
    const faults = slotDrift(WIDGETS, KEYS);
    expect(
      faults,
      `${faults.length} slot(s) named in one place and not the other. Name a slot in the widget's augmentSlots or contributionSlots exactly when the sdk declares it:\n${faults.join("\n")}`,
    ).toEqual([]);
  });

  it("finds no registry key declared again in packages/components", () => {
    const found = coreDuplicateDeclarations(KEYS, REPO_ROOT).map(
      (d) => `  ${d.file}: ${d.registry} "${d.key}"`,
    );
    expect(
      found,
      `${found.length} key(s) the sdk declares are declared again. Delete the components declaration and import the sdk's types:\n${found.join("\n")}`,
    ).toEqual([]);
  });
});
