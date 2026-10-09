import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AXE_SLICES, axeSlices } from "./widgetsAxe";

describe("the axe sweep slices", () => {
  it("has one test file per slice, so no slice is declared and never run", () => {
    const files = readdirSync(import.meta.dirname)
      .filter((f) => /^widgets\.axe\.\d+\.test\.tsx$/.test(f))
      .sort();
    expect(files).toEqual(
      Array.from(
        { length: AXE_SLICES },
        (_, i) => `widgets.axe.${i + 1}.test.tsx`,
      ),
    );
  });

  it("puts every covered widget in exactly one slice, and none empty", () => {
    const slices = axeSlices();
    const ids = slices.flat().map((w) => w.widget.widgetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(30);
    for (const s of slices) expect(s.length).toBeGreaterThan(0);
  });
});
