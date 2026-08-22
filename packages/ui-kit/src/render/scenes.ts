import { basename } from "node:path";
import { gridToPixels } from "../gridUnits";
import type {
  InventoryMode,
  SceneEmit,
  SceneStep,
  SceneTarget,
  UplinkInventory,
} from "../render-probe";
import { display, readJson, type UplinkPackage } from "./context";

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
 * below from the target's own registration, and the render's pixel size, derived
 * from `defaultSize`/`minSize`. Both were hand-written before, and both are
 * already declared once by the code being photographed.
 */

/** The `_scene` block, as an author writes it. */
interface RawScene {
  widget?: string;
  augment?: string;
  contribution?: string;
  caption?: string;
  config?: Record<string, unknown>;
  slotProps?: Record<string, unknown>;
  modes?: string[];
  size?: { w: number; h: number };
  /** Legacy `DataSource` id the bare top-level keys feed. */
  dataSourceId?: string;
  /**
   * This scene's subject IS an empty state, with the reason.
   *
   * The only escape from the starved-render comparison, and it takes prose
   * rather than a boolean on purpose: asserting that a widget genuinely has
   * nothing to draw here is a claim someone can check in a year, and `true`
   * is not one. A scene with this set must still render some visible text,
   * so it cannot be used to wave through a blank frame.
   */
  expectsEmpty?: string;
  steps?: SceneStep[];
  motion?: { fps?: number; pingPong?: boolean };
}

interface RawStream {
  pinnedUt?: number;
  emits?: SceneEmit[];
}

export interface Scene {
  file: string;
  name: string;
  target: SceneTarget;
  caption?: string;
  expectsEmpty?: string;
  pinnedUt: number;
  emits: SceneEmit[];
  config: Record<string, unknown>;
  slotProps: Record<string, unknown>;
  dataSources: Record<string, Record<string, unknown>>;
  carriedChannels: string[];
  modes: InventoryMode[];
  steps?: SceneStep[];
  motion: { fps: number; pingPong: boolean };
}

/** Matches the pinned instant the hand-copied harnesses used, so a fixture
 *  converted from one keeps meaning the same thing. Only its stability matters. */
const DEFAULT_PINNED_UT = 1_000_000;

/** The tile an augment or contribution scene is drawn in, absent `_scene.size`.
 *  There is no `defaultSize` to derive one from: a slot's size belongs to its
 *  host, which lives in a package the author cannot import. */
const STANDIN_SIZE = { w: 13, h: 12 } as const;

const DEFAULT_FPS = 12;

export function buildScenes(
  pkg: UplinkPackage,
  inventory: UplinkInventory,
): Scene[] {
  const scenes: Scene[] = [];
  for (const file of pkg.fixtures) {
    const raw = readJson<Record<string, unknown>>(file);
    const where = display(pkg.dir, file);
    const scene = raw._scene as RawScene | undefined;
    if (!scene) {
      throw new Error(
        `${where}: no "_scene" block, so nothing says what this fixture is a ` +
          "fixture OF. Add one naming its target:\n" +
          `  "_scene": { "widget": "${inventory.widgets[0]?.id ?? "<widget-id>"}" }\n` +
          'or "augment" / "contribution" with the registered id.',
      );
    }
    scenes.push(oneScene(where, file, raw, scene, inventory));
  }
  return scenes;
}

function oneScene(
  where: string,
  file: string,
  raw: Record<string, unknown>,
  scene: RawScene,
  inventory: UplinkInventory,
): Scene {
  const named = (["widget", "augment", "contribution"] as const).filter(
    (k) => scene[k] !== undefined,
  );
  if (named.length !== 1) {
    throw new Error(
      `${where}: "_scene" must name exactly one of widget / augment / ` +
        `contribution; it names ${named.length === 0 ? "none" : named.join(" and ")}.`,
    );
  }
  const kind = named[0];
  const id = scene[kind] as string;
  const target: SceneTarget = { kind, id };

  const stream = (raw._stream as RawStream | undefined) ?? {};
  const pinnedUt = stream.pinnedUt ?? DEFAULT_PINNED_UT;
  const emits = (stream.emits ?? []).map((e) => ({
    ...e,
    validAt: e.validAt ?? pinnedUt,
  }));

  const legacy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    legacy[key] = value;
  }
  const dataSources: Record<string, Record<string, unknown>> = {};
  if (Object.keys(legacy).length > 0) {
    dataSources[scene.dataSourceId ?? "data"] = legacy;
  }

  return {
    file,
    name: basename(file, ".json"),
    target,
    caption: scene.caption,
    expectsEmpty: scene.expectsEmpty,
    pinnedUt,
    emits,
    config: scene.config ?? {},
    slotProps: scene.slotProps ?? {},
    dataSources,
    carriedChannels: carriedFor(where, target, inventory),
    modes: modesFor(where, scene, target, inventory),
    steps: scene.steps,
    motion: {
      fps: scene.motion?.fps ?? DEFAULT_FPS,
      pingPong: scene.motion?.pingPong ?? false,
    },
  };
}

/**
 * The allowlist the stream fixture promotes, from the target's registration.
 *
 * Every domain any registered augment or contribution gates on is added too,
 * whatever the target is: `<AugmentSlot>`'s `requires` gate reads a store fed
 * from `<domain>.available`, and an unpromoted presence topic means the gate
 * answers `false` and the augment never appears, however much the fixture emits.
 */
function carriedFor(
  where: string,
  target: SceneTarget,
  inventory: UplinkInventory,
): string[] {
  const carried = new Set<string>();
  const addAvailability = () => {
    for (const augment of inventory.augments) {
      if (augment.requires) carried.add(`${augment.requires}.available`);
    }
    for (const contribution of inventory.contributions) {
      if (contribution.requires) {
        carried.add(`${contribution.requires}.available`);
      }
    }
  };
  addAvailability();

  if (target.kind === "widget") {
    const def = inventory.widgets.find((w) => w.id === target.id);
    if (!def) throw unknownTarget(where, target, inventory);
    for (const topic of [
      ...def.channels,
      ...def.optionalChannels,
      ...def.dataRequirements,
    ]) {
      carried.add(topic);
    }
  } else if (target.kind === "augment") {
    const def = inventory.augments.find((a) => a.id === target.id);
    if (!def) throw unknownTarget(where, target, inventory);
    for (const topic of def.channels) carried.add(topic);
  } else {
    const def = inventory.contributions.find((c) => c.id === target.id);
    if (!def) throw unknownTarget(where, target, inventory);
    for (const dep of def.deps) {
      if (!dep.startsWith("processor:")) carried.add(dep);
    }
  }
  return [...carried].sort();
}

function unknownTarget(
  where: string,
  target: SceneTarget,
  inventory: UplinkInventory,
): Error {
  const known =
    target.kind === "widget"
      ? inventory.widgets.map((w) => w.id)
      : target.kind === "augment"
        ? inventory.augments.map((a) => a.id)
        : inventory.contributions.map((c) => c.id);
  // "Registered <kind> ids" rather than pluralising the interpolation: `${x}s`
  // reads to the hand-typed-unit guard as a seconds symbol next to a value.
  return new Error(
    `${where}: "${target.id}" is not a registered ${target.kind} of Uplink ` +
      `"${inventory.id}". Registered ${target.kind} ids: ` +
      `${known.sort().join(", ") || "(none)"}.`,
  );
}

function modesFor(
  where: string,
  scene: RawScene,
  target: SceneTarget,
  inventory: UplinkInventory,
): InventoryMode[] {
  let all: InventoryMode[];
  if (target.kind === "widget") {
    const def = inventory.widgets.find((w) => w.id === target.id);
    if (!def) throw unknownTarget(where, target, inventory);
    all = def.modes;
  } else {
    const size = scene.size ?? STANDIN_SIZE;
    all = [{ name: "default", ...size, ...gridToPixels(size.w, size.h) }];
  }
  if (!scene.modes) return all;
  const chosen: InventoryMode[] = [];
  for (const name of scene.modes) {
    const found = all.find((m) => m.name === name);
    if (!found) {
      throw new Error(
        `${where}: "_scene.modes" names "${name}", which is not a mode this ` +
          `target has. Available: ${all.map((m) => m.name).join(", ")}. ` +
          "Modes are derived from the registration's defaultSize / minSize, so " +
          "a fixture may narrow the set and cannot add to it.",
      );
    }
    chosen.push(found);
  }
  return chosen;
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
