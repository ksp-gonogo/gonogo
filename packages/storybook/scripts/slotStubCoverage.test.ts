import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DeclaredSlots,
  missingStubs,
  plantedSlotsIn,
} from "./slot-scenes/stubCoverage";

const REPO = resolve(__dirname, "../../..");
const STUBS = resolve(REPO, "packages/components/scripts/probe/slot-stubs");
const MANIFEST = resolve(REPO, "packages/uplink-tools/dist/widgets.json");

function manifestWidgets(): DeclaredSlots[] {
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `${MANIFEST} is missing: build @ksp-gonogo/uplink-tools first`,
    );
  }
  const { widgets } = JSON.parse(readFileSync(MANIFEST, "utf8"));
  return widgets;
}

describe("every declared extension point has a planted stub", () => {
  const planted = plantedSlotsIn(STUBS);

  it("sees the stubs it is meant to count", () => {
    expect(planted.size).toBeGreaterThan(0);
    expect(planted.has("crew-status.avatar")).toBe(true);
  });

  it("fails as BLIND unless a planted violation is seen", () => {
    const seen = missingStubs(
      [
        {
          id: "twr",
          augmentSlots: ["twr.no-stub-planted-here"],
          contributionSlots: ["twr.nor-here"],
        },
      ],
      planted,
    );
    expect(
      seen.map((m) => m.slot),
      "BLIND: the check did not see a slot nothing plants",
    ).toEqual(["twr.no-stub-planted-here", "twr.nor-here"]);
  });

  it("names the widget and slot of each point the manifest declares without a stub", () => {
    const missing = missingStubs(manifestWidgets(), planted);
    expect(
      missing.map((m) => `${m.widgetId}: ${m.slot}`),
      "plant a stub under packages/components/scripts/probe/slot-stubs for each",
    ).toEqual([]);
  });
});
