import { getComponent } from "@ksp-gonogo/core";
import { gridFloor } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import "../src";
import { listWidgets } from "./widgets";

/**
 * No render mode draws a widget smaller than the dashboard will let it be.
 *
 * The grid clamps every tile to its widget's floor (its `minSize`, or the
 * kit-wide tiny size for a widget with a tiny mode), so a mode
 * below it pictures a screen no operator can reach. Whatever such a render
 * finds is true of a geometry that cannot occur, and it reads exactly like a
 * finding, which is how a defect gets fixed on a screen nobody sees.
 */
describe("the render harness's modes", () => {
  it("draw no widget below its grid floor", () => {
    const below: string[] = [];
    let checked = 0;
    for (const config of listWidgets()) {
      const def = getComponent(config.widgetId);
      const min = def ? gridFloor(def) : undefined;
      if (!min) continue;
      checked++;
      for (const mode of config.modes) {
        if (mode.w < min.w || mode.h < min.h) {
          below.push(
            `${config.label ?? config.widgetId} ${mode.name} (${mode.w}x${mode.h}) < grid floor ${min.w}x${min.h}`,
          );
        }
      }
    }
    // A walk that resolved no registrations would pass by checking nothing.
    expect(checked).toBeGreaterThanOrEqual(30);
    expect(below).toEqual([]);
  });
});
