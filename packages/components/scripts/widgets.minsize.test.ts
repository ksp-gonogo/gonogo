import { getComponent } from "@ksp-gonogo/core";
import { gridFloor, TINY_SIZE } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import "../src";
import { listWidgets } from "./widgets";

interface TinyWalk {
  readonly widgetId: string;
  readonly hasTiny: boolean;
  readonly modes: readonly { readonly w: number; readonly h: number }[];
}

/** Ids of widgets with a tiny form that have no render mode at exactly the tiny size. */
function missingTinyMode(configs: readonly TinyWalk[]): string[] {
  const covered = new Set<string>();
  const tiny = new Set<string>();
  for (const config of configs) {
    if (!config.hasTiny) continue;
    tiny.add(config.widgetId);
    if (config.modes.some((m) => m.w === TINY_SIZE.w && m.h === TINY_SIZE.h)) {
      covered.add(config.widgetId);
    }
  }
  return [...tiny].filter((id) => !covered.has(id));
}

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

  it("keep a render at the tiny size for every widget with a tiny form", () => {
    const configs = listWidgets().map((config) => ({
      widgetId: config.widgetId,
      hasTiny: getComponent(config.widgetId)?.tiny !== undefined,
      modes: config.modes,
    }));
    const checked = new Set(
      configs.filter((c) => c.hasTiny).map((c) => c.widgetId),
    ).size;
    // A walk that found no tiny widgets would pass by checking nothing.
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(
      missingTinyMode(configs).map(
        (id) =>
          `${id} has a tiny form and no render mode at ${TINY_SIZE.w}x${TINY_SIZE.h}`,
      ),
    ).toEqual([]);
  });

  it("report a tiny widget whose modes skip the tiny size", () => {
    const planted: TinyWalk[] = [
      { widgetId: "planted", hasTiny: true, modes: [{ w: 5, h: 4 }] },
      { widgetId: "covered", hasTiny: true, modes: [TINY_SIZE] },
      { widgetId: "no-tiny-form", hasTiny: false, modes: [{ w: 5, h: 4 }] },
    ];
    expect(missingTinyMode(planted)).toEqual(["planted"]);
  });
});
