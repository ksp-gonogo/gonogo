import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAugments,
  getAugmentsForSlot,
  getMergedSlotSettings,
  registerAugment,
} from "./augments";
import { clearContributions, registerContribution } from "./contributions";

// The augment registry + `<AugmentSlot>` moved to `@ksp-gonogo/ui-kit`; their
// behaviour (ordering, composition, the Domain-presence gate, per-augment
// settings) is tested there against the ui-kit-owned availability store. What
// stays here is the ONE piece that can't: `getMergedSlotSettings`, which folds
// augment settings (ui-kit) with contribution settings (core's write-path
// registry). The re-export smoke check proves core's shim still surfaces the
// moved symbols so every `@ksp-gonogo/core` importer is unchanged.

beforeEach(() => {
  clearAugments();
  clearContributions();
});

describe("augment registry: re-exported through @ksp-gonogo/core", () => {
  it("registers and reads back an augment via the core shim", () => {
    registerAugment({
      id: "aug",
      augments: "test.slot",
      component: () => null,
    });
    expect(getAugmentsForSlot("test.slot").map((a) => a.id)).toEqual(["aug"]);
  });
});

describe("getMergedSlotSettings", () => {
  it("returns augment settings blocks followed by contribution settings blocks for the same slot", () => {
    registerAugment({
      id: "aug-with-settings",
      augments: "test.slot",
      component: () => null,
      settings: [{ key: "showAug", type: "boolean", default: true }],
    });
    registerContribution({
      id: "contrib-with-settings",
      contributes: "test.slot",
      settings: [{ key: "showContrib", type: "boolean", default: false }],
      compute: () => null,
    });

    const merged = getMergedSlotSettings("test.slot");
    expect(merged.map((b) => b.namespace)).toEqual([
      "aug-with-settings",
      "contrib-with-settings",
    ]);
  });

  it("keeps each half's fields intact and namespaced by id", () => {
    registerAugment({
      id: "aug",
      augments: "s",
      component: () => null,
      settings: [{ key: "a", type: "text", default: "x" }],
    });
    registerContribution({
      id: "contrib",
      contributes: "s",
      settings: [{ key: "b", type: "number", default: 1 }],
      compute: () => null,
    });

    const merged = getMergedSlotSettings("s");
    expect(merged).toEqual([
      {
        augmentId: "aug",
        namespace: "aug",
        fields: [{ key: "a", type: "text", default: "x" }],
      },
      {
        augmentId: "contrib",
        namespace: "contrib",
        fields: [{ key: "b", type: "number", default: 1 }],
      },
    ]);
  });
});
