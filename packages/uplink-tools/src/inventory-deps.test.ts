import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { readInventory } from "./render-probe";

const planted = defineUplinkClient({
  id: "planted-deps",
  version: "1.0.0",
  name: "Planted deps",
});

planted.registerContribution({
  id: "needs-a-setting",
  contributes: "console.badges",
  deps: [
    "vessel.flight",
    { reading: "vessel.flight" },
    { modSetting: { uplink: "planted-deps", key: "featureEnabled" } },
  ] as never,
  compute: () => null,
});

describe("readInventory contribution deps", () => {
  it("names a mod-setting dep by the settings topic of its Uplink", () => {
    const [found] = readInventory("planted-deps").contributions;

    expect(found.deps).toEqual([
      "vessel.flight",
      "vessel.flight",
      "settings.planted-deps",
    ]);
  });
});
