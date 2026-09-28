import { gridToPixels } from "@ksp-gonogo/ui-kit/grid";
import type {
  InventoryMode,
  SceneEmit,
  ScenePayload,
  SceneStep,
  SceneTarget,
  UplinkInventory,
} from "../render-probe";
import { HOST_DRAWN_CONTRIBUTION_SEGMENTS } from "./probe-global";

/*
 * What one fixture's `_scene` block describes, resolved against the Uplink's
 * inventory. Browser-safe: the fixture arrives already parsed, so a page can
 * build the same scene the render driver builds from the same file.
 */

/** The file's name without its directory or `.json`, as a scene is named. */
function sceneName(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.endsWith(".json") ? base.slice(0, -".json".length) : base;
}

/** The `_scene` block, as an author writes it. */
interface RawScene {
  widget?: string;
  augment?: string;
  contribution?: string;
  /**
   * A registered widget to mount this augment INSIDE, rather than the stand-in
   * `Panel`. The only way an overlay augment gets an honest picture: it draws
   * in its host's projection, so with no host there is nothing to draw against.
   * The scene is then sized and fed as the host, since that is what is on
   * screen.
   */
  hostWidget?: string;
  caption?: string;
  config?: Record<string, unknown>;
  slotProps?: Record<string, unknown>;
  modes?: string[];
  /**
   * The tile to render in, overriding what would be derived.
   *
   * For a stand-in augment or contribution scene it IS the size, since a slot
   * has no size of its own. For a HOSTED one it overrides the host's, because a
   * host sized for itself alone is not the shape an operator who has added
   * sections to it is running.
   */
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
  /**
   * This scene is one of the README's picture(s) of its target.
   *
   * Stackable: any number of a target's scenes may carry it, and every one
   * that does is shown. `gonogo-uplink docs` refuses a target with scenes and
   * none marked, because a hero silently defaulted to "whichever fixture
   * sorts first" is a picture nobody chose.
   */
  hero?: true;
  /**
   * Why this scene draws exactly the same with the link dropped, and why that
   * is honest.
   *
   * <p>The only escape from the staleness comparison, and prose for the same
   * reason `expectsEmpty` is. It is for a subject that draws no figure an
   * operator could take for current: a vocabulary, a control, a label. A
   * subject that draws a reading does not qualify, however small the reading.</p>
   *
   * <p>A scene carrying it whose stale render DOES change fails, so the excuse
   * comes off the moment it stops being needed.</p>
   */
  unchangedWhenStale?: string;
  /**
   * Text this scene must actually PAINT, each in a box wider and taller than
   * nothing.
   *
   * The fed-versus-starved check asks whether the render depends on the fixture
   * at all, which is a question about the whole picture. This asks whether one
   * NAMED thing survived the layout, which is a question about one element, and
   * neither answers the other. A label squeezed to zero width by a neighbour
   * that wrapped satisfies every `toBeInTheDocument` in a jsdom suite, passes
   * the starve check because the rest of the picture still moved, and is
   * invisible on screen. That is not hypothetical: it is the bug the check was
   * first written for, a launch complex's own name rendered at nothing beside a
   * detail sentence that took the whole row.
   *
   * Checked at every mode the scene renders, because the narrow shapes are
   * where a neighbour wraps. A widget that legitimately drops a label at one
   * size narrows `_scene.modes`.
   */
  paints?: string[];
  before?: SceneAct[];
  steps?: SceneStep[];
  motion?: { fps?: number; pingPong?: boolean };
}

/**
 * One thing done to the mounted widget before it is photographed.
 *
 * <p>Some surfaces have nothing to show until they are used. A plan composer
 * with no plan in it is a button; a video feed's controls are hover-gated and
 * invisible at rest. Feeding state in through the fixture instead would render a
 * composer that had never composed anything, which is the difference between a
 * picture of the mechanism and a picture of a shape.</p>
 *
 * <p>Driver-side, through real input events, because that is the only way a
 * hover reaches CSS and a click reaches a handler that reads the event.</p>
 */
export interface SceneAct {
  /** Click the control with this accessible name. */
  press?: string;
  /** Move the pointer over the first element matching this CSS selector. */
  hover?: string;
  /** Move the pointer off everything, for the resting half of a hover pair. */
  rest?: true;
}

interface RawStream {
  pinnedUt?: number;
  emits?: SceneEmit[];
  /** See `ScenePayload.stopsArriving`. Absent means a live scene. */
  stopsArriving?: boolean;
}

export interface Scene {
  file: string;
  name: string;
  target: SceneTarget;
  host?: string;
  caption?: string;
  expectsEmpty?: string;
  unchangedWhenStale?: string;
  hero: boolean;
  paints: string[];
  before: SceneAct[];
  pinnedUt: number;
  emits: SceneEmit[];
  stopsArriving?: boolean;
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

/**
 * The scene one fixture describes, or a failure naming the file when its
 * `_scene` block is missing or names no target the inventory holds.
 */
export function sceneFromFixture(
  where: string,
  file: string,
  raw: Record<string, unknown>,
  inventory: UplinkInventory,
): Scene {
  const sceneBlock = raw._scene;
  if (typeof sceneBlock !== "object" || sceneBlock === null) {
    throw new Error(
      `${where}: no "_scene" block, so nothing says what this fixture is a ` +
        "fixture OF. Add one naming its target:\n" +
        `  "_scene": { "widget": "${inventory.widgets[0]?.id ?? "<widget-id>"}" }\n` +
        'or "augment" / "contribution" with the registered id.',
    );
  }
  return oneScene(where, file, raw, sceneBlock as RawScene, inventory);
}

function oneScene(
  where: string,
  file: string,
  raw: Record<string, unknown>,
  scene: RawScene,
  inventory: UplinkInventory,
): Scene {
  if ("host" in scene) {
    throw new Error(
      `${where}: "_scene.host" is not read any more; the key was renamed to ` +
        '"_scene.hostWidget". Rename the key in this fixture.',
    );
  }

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

  const streamBlock = raw._stream;
  const stream: RawStream =
    typeof streamBlock === "object" && streamBlock !== null
      ? (streamBlock as RawStream)
      : {};
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

  if (scene.hostWidget !== undefined && kind === "widget") {
    throw new Error(
      `${where}: "_scene.hostWidget" is only meaningful for an augment or a ` +
        "contribution scene, which are drawn INSIDE another widget. This one " +
        "names a widget, so there is nothing for it to be drawn inside.",
    );
  }
  // A contribution is DATA somebody else draws, so a scene that names no host
  // widget has to show that SOMETHING will draw it. The framework draws one
  // segment for every widget, `<id>.badges`, so the probe's stand-in renders a
  // badge exactly as the real widget would; every other slot is drawn by a
  // widget's own body, and a stand-in has none.
  if (scene.hostWidget === undefined && kind === "contribution") {
    const slot = contributionSlot(where, id, inventory);
    if (!isHostDrawnSlot(slot)) {
      throw new Error(
        `${where}: this contribution goes on "${slot}", which its host ` +
          'widget draws itself, so "_scene.hostWidget" must name a widget ' +
          "that declares it. Without one there is nothing to draw the " +
          "contribution and the render is a blank frame that reports " +
          `success. The one exception is a ` +
          `"${HOST_DRAWN_CONTRIBUTION_SEGMENTS.join('" / "')}" segment, ` +
          "which the framework renders for every widget.",
      );
    }
  }

  return {
    file,
    name: sceneName(file),
    target,
    host: scene.hostWidget,
    caption: scene.caption,
    expectsEmpty: scene.expectsEmpty,
    unchangedWhenStale: unchangedWhenStaleFor(where, scene, stream),
    hero: scene.hero === true,
    paints: paintsFor(where, scene),
    before: beforeFor(where, scene),
    pinnedUt,
    emits,
    stopsArriving: stream.stopsArriving,
    config: scene.config ?? {},
    slotProps: scene.slotProps ?? {},
    dataSources,
    carriedChannels: carriedFor(where, target, inventory, scene.hostWidget),
    modes: modesFor(where, scene, target, inventory),
    steps: scene.steps,
    motion: {
      fps: scene.motion?.fps ?? DEFAULT_FPS,
      pingPong: scene.motion?.pingPong ?? false,
    },
  };
}

/**
 * `_scene.unchangedWhenStale`, refused where it could not be read: it has to be
 * a reason, and a scene with no stream or an empty state is never compared.
 */
function unchangedWhenStaleFor(
  where: string,
  scene: RawScene,
  stream: RawStream,
): string | undefined {
  const why = scene.unchangedWhenStale;
  if (why === undefined) return undefined;
  if (typeof why !== "string" || why.trim() === "") {
    throw new Error(
      `${where}: "_scene.unchangedWhenStale" must say why this scene draws ` +
        "the same with the link dropped; a blank reason is not one.",
    );
  }
  if ((stream.emits ?? []).length === 0 || scene.expectsEmpty !== undefined) {
    throw new Error(
      `${where}: "_scene.unchangedWhenStale" is set on a scene the staleness ` +
        "check never compares (it emits nothing on the stream, or it is an " +
        "empty state), so it excuses nothing. Remove it.",
    );
  }
  return why;
}

/**
 * `_scene.paints`, validated at parse time rather than at render time.
 *
 * An empty string matches every element, so a stray one in the list would pass
 * silently and read as a check nobody wrote. Refusing it here means the author
 * finds out before Chromium starts.
 */
function paintsFor(where: string, scene: RawScene): string[] {
  const paints = scene.paints ?? [];
  if (!Array.isArray(paints)) {
    throw new Error(
      `${where}: "_scene.paints" must be an array of strings, got ` +
        `${typeof paints}.`,
    );
  }
  for (const text of paints) {
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(
        `${where}: every "_scene.paints" entry must be non-blank text the ` +
          `render has to show; got ${JSON.stringify(text)}. An empty string ` +
          "matches every element on the page, so it would assert nothing.",
      );
    }
  }
  // A motion scene has no one moment for "is this on screen" to be about: what
  // it exists to show is text arriving and leaving. Refused rather than checked
  // at an arbitrary frame, which would fail scenes that are working.
  if (paints.length > 0 && scene.steps && scene.steps.length > 0) {
    throw new Error(
      `${where}: "_scene.paints" and "_scene.steps" cannot both be set. A ` +
        "motion scene's content changes frame to frame, so there is no single " +
        "moment the text has to be on screen in. Assert the paint on a still " +
        "scene of the same state.",
    );
  }
  return [...paints];
}

/** `_scene.before`, validated at parse time so a typo is not a silent no-op. */
function beforeFor(where: string, scene: RawScene): SceneAct[] {
  const acts = scene.before ?? [];
  if (!Array.isArray(acts)) {
    throw new Error(
      `${where}: "_scene.before" must be an array of acts, got ${typeof acts}.`,
    );
  }
  for (const act of acts) {
    const named = (["press", "hover", "rest"] as const).filter(
      (k) => act?.[k] !== undefined,
    );
    if (named.length !== 1) {
      throw new Error(
        `${where}: every "_scene.before" act names exactly one of press / ` +
          `hover / rest; got ${JSON.stringify(act)}.`,
      );
    }
  }
  return [...acts];
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
  host?: string,
): string[] {
  const carried = new Set<string>();
  // A hosted augment scene pictures its host, so the host's own topics are carried too.
  if (host) {
    const def = hostWidget(where, host, inventory);
    for (const topic of [
      ...def.channels,
      ...def.optionalChannels,
      ...def.dataRequirements,
    ]) {
      carried.add(topic);
    }
  }
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

  const addTargetTopics = () => {
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
      return;
    }
    if (target.kind === "augment") {
      const def = inventory.augments.find((a) => a.id === target.id);
      if (!def) throw unknownTarget(where, target, inventory);
      for (const topic of def.channels) carried.add(topic);
      return;
    }
    const def = inventory.contributions.find((c) => c.id === target.id);
    if (!def) throw unknownTarget(where, target, inventory);
    for (const dep of def.deps) {
      // A Processor dep names no topic of its own, so its OWN topic deps are
      // what the scene has to carry. Skipping them left a contribution that
      // derives everything through a Processor with an empty allowlist, and
      // the transport dropped every emit the fixture made.
      if (dep.startsWith("processor:")) {
        const id = dep.slice("processor:".length);
        for (const topic of inventory.processorTopicDeps[id] ?? []) {
          carried.add(topic);
        }
      } else {
        carried.add(dep);
      }
    }
  };
  addTargetTopics();
  return [...carried].sort();
}

/**
 * The registration of a widget this Uplink does not own, named as a scene's
 * host. Absent means it is not in the bundle at all, which for a first-party
 * host means the run did not supply it with `--with`.
 */
function hostWidget(
  where: string,
  host: string,
  inventory: UplinkInventory,
): (typeof inventory.hosts)[number] {
  const found =
    inventory.hosts.find((w) => w.id === host) ??
    inventory.widgets.find((w) => w.id === host);
  if (!found) {
    throw new Error(
      `${where}: "_scene.hostWidget" names "${host}", which no widget in ` +
        "this bundle registers. A widget that ships with the app has to be " +
        'supplied to the run: declare "@ksp-gonogo/uplink-tools/widgets" in ' +
        `package.json's "gonogo.renderWith", or pass ` +
        "--with <module that registers it> for a one-off. " +
        "Widgets in the bundle: " +
        `${
          [...inventory.hosts, ...inventory.widgets]
            .map((w) => w.id)
            .sort()
            .join(", ") || "(none)"
        }.`,
    );
  }
  return found;
}

/**
 * Whether a stand-in host would actually draw this slot.
 *
 * The same test `render-probe.tsx` makes, from the same constant, and the two
 * have to agree: a rule stricter here makes a scene the probe would have served
 * unbuildable, and a rule looser here builds a scene the probe photographs
 * blank.
 */
function isHostDrawnSlot(slot: string): boolean {
  const segment = slot.slice(slot.indexOf(".") + 1);
  return (
    slot.includes(".") &&
    (HOST_DRAWN_CONTRIBUTION_SEGMENTS as readonly string[]).includes(segment)
  );
}

function contributionSlot(
  where: string,
  id: string,
  inventory: UplinkInventory,
): string {
  const found = inventory.contributions.find((c) => c.id === id);
  if (!found)
    throw unknownTarget(where, { kind: "contribution", id }, inventory);
  return found.contributes;
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
  // "Registered <kind> ids" rather than pluralising the interpolation: `${x}s` reads to the hand-typed-unit guard as a seconds symbol next to a value.
  return new Error(
    `${where}: "${target.id}" is not a registered ${target.kind} of Uplink ` +
      `"${inventory.id}". Registered ${target.kind} ids: ` +
      `${known.sort().join(", ") || "(none)"}.`,
  );
}

function resolveAllModes(
  where: string,
  scene: RawScene,
  target: SceneTarget,
  inventory: UplinkInventory,
): InventoryMode[] {
  if (target.kind === "widget") {
    const def = inventory.widgets.find((w) => w.id === target.id);
    if (!def) throw unknownTarget(where, target, inventory);
    return def.modes;
  }
  if (scene.hostWidget) {
    const host = hostWidget(where, scene.hostWidget, inventory);
    // The host's own sizes, because the host is what is on screen. A stand-in
    // tile would render the real widget at a shape nobody ever sees it in.
    //
    // Unless the scene names a size, which is not the stand-in escape returning
    // by the back door. A host's `defaultSize` is chosen for the host ALONE,
    // and an operator who has added three sections to it has resized it: the
    // first section rendered this way came out at the host's 6-column default
    // with its facility names ellipsised to "V...", a picture of a tile nobody
    // running that Uplink is using. The host still mounts and still supplies
    // the layout; only the tile it is given is the scene's.
    return scene.size
      ? [
          {
            ...host.modes[0],
            ...scene.size,
            ...gridToPixels(scene.size.w, scene.size.h),
          },
        ]
      : host.modes;
  }
  const size = scene.size ?? STANDIN_SIZE;
  return [{ name: "default", ...size, ...gridToPixels(size.w, size.h) }];
}

function modesFor(
  where: string,
  scene: RawScene,
  target: SceneTarget,
  inventory: UplinkInventory,
): InventoryMode[] {
  const all = resolveAllModes(where, scene, target, inventory);
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

/** The payload the page mounts for one scene at one mode. */
export function payloadFor(
  scene: Scene,
  mode: { name: string; w: number; h: number; pxW: number; pxH: number },
  starve: boolean,
): ScenePayload {
  return {
    target: scene.target,
    fixture: scene.name,
    pinnedUt: scene.pinnedUt,
    carriedChannels: scene.carriedChannels,
    emits: scene.emits,
    stopsArriving: scene.stopsArriving,
    config: scene.config,
    slotProps: scene.slotProps,
    host: scene.host,
    dataSources: scene.dataSources,
    w: mode.w,
    h: mode.h,
    pxW: mode.pxW,
    pxH: mode.pxH,
    starve,
    steps: scene.steps,
  };
}
