import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "../src";
import { listWidgets } from "./widgets";

/**
 * No render mode draws a widget smaller than the dashboard will let it be.
 *
 * The grid clamps every tile to its widget's registered `minSize`, so a mode
 * below it pictures a screen no operator can reach. Whatever such a render
 * finds is true of a geometry that cannot occur, and it reads exactly like a
 * finding, which is how a defect gets fixed on a screen nobody sees.
 */
describe("the render harness's modes", () => {
  it("draw no widget below the minSize it declares", () => {
    const below: string[] = [];
    let checked = 0;
    for (const config of listWidgets()) {
      const min = getComponent(config.widgetId)?.minSize;
      if (!min) continue;
      checked++;
      for (const mode of config.modes) {
        if (mode.w < min.w || mode.h < min.h) {
          below.push(
            `${config.label ?? config.widgetId} ${mode.name} (${mode.w}x${mode.h}) < minSize ${min.w}x${min.h}`,
          );
        }
      }
    }
    // A walk that resolved no registrations would pass by checking nothing.
    expect(checked).toBeGreaterThanOrEqual(30);
    expect(below).toEqual([]);
  });
});
