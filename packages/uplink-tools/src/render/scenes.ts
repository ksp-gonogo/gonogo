import type { UplinkInventory } from "../render-probe";
import { display, readJsonObject, type UplinkPackage } from "./context";
import { type Scene, sceneFromFixture } from "./sceneModel";

export type { Scene, SceneAct } from "./sceneModel";

/**
 * Fixtures, and the scene each one describes.
 *
 * The convention four Uplinks already use is kept:
 * `client/src/<Widget>/__fixtures__/<name>.json`, found by walking rather than
 * listed anywhere. A registry file is a list somebody has to remember to update,
 * and the thing a stale one produces is a page that describes less than the
 * Uplink does.
 *
 * Two fields a fixture deliberately does NOT carry: `carriedChannels`, derived
 * from the target's own registration, and the render's pixel size, derived
 * from `defaultSize`/`minSize`. Both were hand-written before, and both are
 * already declared once by the code being photographed.
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
 * Every registered WIDGET must have at least one scene, and the rule stops
 * there.
 *
 * A widget with no fixture is a widget the generated page under-describes, and
 * the author does not notice: a page that quietly lists three of four widgets
 * reads exactly like an Uplink with three widgets. A widget is also always
 * renderable, since the harness can mount it in the real dashboard stack.
 *
 * An augment is NOT always renderable, and demanding a fixture for one would be
 * demanding a picture that cannot be honest. An overlay augment draws in its
 * host's projection (a map's coordinate space, an SVG transform), so mounted in
 * a stand-in `Panel` it has nothing to draw against and produces a blank frame,
 * which the starved-render check would then reject as a picture of nothing, and
 * rightly. Those are listed on the page WITHOUT a preview and with the reason,
 * which is the honest form: the page still says the augment exists, so nothing is
 * silently omitted, and it does not print a frame that misrepresents it.
 *
 * Returns the augment and contribution ids with no scene, for the page to name.
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
