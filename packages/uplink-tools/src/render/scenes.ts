import type { UplinkInventory } from "../render-probe";
import { display, readJsonObject, type UplinkPackage } from "./context";
import { type Scene, sceneFromFixture } from "./sceneModel";

export type { Scene, SceneAct } from "./sceneModel";

/**
 * One scene per fixture file found under the client package's
 * `src/**\/__fixtures__/`. A fixture does not carry the Topics its
 * target reads or the size to render at: both come from the target's own
 * registration.
 *
 * @category Rendering scenes
 */
export function buildScenes(
  pkg: UplinkPackage,
  inventory: UplinkInventory,
): Scene[] {
  const scenes: Scene[] = [];
  for (const file of pkg.fixtures) {
    const where = display(pkg.dir, file);
    scenes.push(sceneFromFixture(where, file, readJsonObject(file), inventory));
  }
  return scenes;
}

/**
 * Throws when a registered widget has no scene, naming each one, since the
 * page would otherwise leave it out without saying so.
 *
 * Augments and contributions need no scene, because some cannot be pictured
 * outside their host (an overlay drawn in a map's projection renders blank in a
 * stand-in). Their ids are returned as `unpreviewed`, and the page lists them
 * without a picture.
 *
 * @category Rendering scenes
 */
export function assertEveryWidgetCovered(
  scenes: Scene[],
  inventory: UplinkInventory,
): { unpreviewed: string[] } {
  const covered = new Set(scenes.map((s) => `${s.target.kind}:${s.target.id}`));
  const missing = inventory.widgets
    .filter((w) => !covered.has(`widget:${w.id}`))
    .map((w) => w.id);
  if (missing.length > 0) {
    throw new Error(
      `gonogo-uplink: ${missing.length} widget(s) have no fixture, so the ` +
        "generated page would show no picture of them:\n  " +
        `${missing.join("\n  ")}\n` +
        'Add a fixture under src/<Name>/__fixtures__/ with a "_scene" block ' +
        "naming the widget id.",
    );
  }
  return {
    unpreviewed: [
      ...inventory.augments
        .filter((a) => !covered.has(`augment:${a.id}`))
        .map((a) => `augment:${a.id}`),
      ...inventory.contributions
        .filter((c) => !covered.has(`contribution:${c.id}`))
        .map((c) => `contribution:${c.id}`),
    ],
  };
}
