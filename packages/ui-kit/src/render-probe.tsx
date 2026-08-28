import type {
  AugmentSettingField,
  ComponentDefinition,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CONTRACT_MAJOR,
  CONTRACT_MINOR,
  DYNAMIC_CARRIED_TOPIC_PREFIXES,
  EXTENSION_API_VERSION,
  getComponent,
  registerDataSource,
  registerStockBodies,
  unregisterDataSource,
} from "@ksp-gonogo/sitrep-sdk";
import { getComponents } from "@ksp-gonogo/sitrep-sdk/registry";
import {
  getAllProcessors,
  getContributedChannelTopics,
  getContributions,
  getReckonedTopics,
  getUplinkClients,
} from "@ksp-gonogo/sitrep-sdk/spine";
import type { StreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  harnessTheme,
  installRealTestHost,
  MockDataSource,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import type { AnyAugment, DomainAvailabilityStore } from "@ksp-gonogo/ui-kit";
import {
  AugmentSlot,
  clearAugments,
  DomainAvailabilityProvider,
  FRAMEWORK_AUGMENT_SEGMENTS,
  getAugments,
  getAugmentsForSlot,
  gridToPixels,
  Panel,
  PanelBody,
  registerAugment,
  setQuantityLocale,
  UI_KIT_VERSION,
  useDomainAvailabilityStore,
} from "@ksp-gonogo/ui-kit";
import { WidgetHost, WidgetHostFor } from "@ksp-gonogo/ui-kit/testing";
import {
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { RENDER_PROBE_GLOBAL } from "./render/probe-global";

/**
 * The BROWSER half of the Uplink render harness: everything that has to run
 * inside the page.
 *
 * It is here rather than in `@ksp-gonogo/sitrep-sdk` for the same structural
 * reason `renderWidget` is: a scene's mount IS this package's providers
 * (`WidgetHost`, `Panel`, `AugmentSlot`, `DomainAvailabilityProvider`,
 * `harnessTheme`), ui-kit imports the sdk, and the sdk cannot import them back.
 *
 * It exists because four Uplinks had hand-copied a probe entry each, and a copy
 * of a browser entry plus its driver is a PAIRING, which is the thing in this
 * repo that reliably drifts. Two of the four copies could not boot at all (no
 * host installed, no `ThemeProvider`), one driver read a repo-relative path into
 * `packages/theme/src`, and another read a `:root` block out of a file that
 * stopped having one. None of those is an import, so no import scanner could
 * report any of them. One harness, resolving everything through published
 * specifiers, is the fix that a fifth scanner is not.
 *
 * The Node half is `@ksp-gonogo/ui-kit/render`, and the two are shipped together
 * deliberately: the generated entry, the page it is injected into and the
 * `window` global it installs are one contract.
 *
 * It reaches the kit through its own PACKAGE name rather than relative paths,
 * and that is load-bearing rather than stylistic. Relative imports would put
 * `renderWidget` into a code-split chunk shared with `./testing`, and a chunk
 * reachable only through `dist/testing.js` does not evaluate under a consumer's
 * vitest: the namespace carries the export names with every value `undefined`,
 * so `renderWidget is not a function` in eight of an Uplink's tests while
 * `dist/index.js` (a real exports entry, so its chunk does load) works. Reaching
 * the kit as a consumer keeps `render-probe` self-contained AND keeps exactly
 * one copy of the augment registry at probe-bundle time, which is the failure
 * the other direction produces: `registerAugment` writing to a Map that
 * `<AugmentSlot>` never reads.
 */

export { RENDER_PROBE_GLOBAL } from "./render/probe-global";

// ---------------------------------------------------------------------------
// The wire between the two halves
// ---------------------------------------------------------------------------

/** What a scene mounts. Exactly one of the three registration kinds. */
export type SceneTargetKind = "widget" | "augment" | "contribution";

export interface SceneTarget {
  kind: SceneTargetKind;
  /** Registered widget id, augment id, or contribution id. */
  id: string;
}

/** One emission a fixture makes onto the stream. */
export interface SceneEmit {
  topic: string;
  payload: unknown;
  /** The sample's own instant. Defaults to the scene's pinned UT: the
   *  transport defaults it to zero, so omitting it is not "now". */
  validAt?: number;
}

/** One frame-producing step in a motion scene. */
export interface SceneStep {
  /** Emit onto the stream at the current clock. */
  emit?: SceneEmit;
  /** Advance the pinned clock by this many seconds, spread over `frames`. */
  advanceUt?: number;
  /** Click the first element matching this selector. Missing throws. */
  click?: string;
  /**
   * Press the pointer on the control with this accessible name and drag it.
   *
   * Driver-side, so it never reaches this module: a synthetic `click()` cannot
   * express a HELD pointer, and a control whose displacement sets a rate rather
   * than a value does nothing at all until one is held. Released by a later
   * `release` step, or when the scene ends.
   */
  hold?: { name: string; role?: string; dx?: number; dy?: number };
  /** Let go of whatever `hold` took. Driver-side. */
  release?: true;
  /**
   * Real milliseconds to let pass, spread over `frames`. Driver-side.
   *
   * The counterpart to `advanceUt` and not a substitute for it: that one steps
   * the PINNED clock, which is what keeps a countdown reproducible. This one
   * waits, which is the only thing a control ticking on its own `setInterval`
   * responds to.
   */
  waitMs?: number;
  /** How many frames this step spans. Defaults to 1. */
  frames?: number;
}

export interface ScenePayload {
  target: SceneTarget;
  /** Fixture name, for error messages. */
  fixture: string;
  pinnedUt: number;
  /** Derived from the target's registration, never written in a fixture. */
  carriedChannels: string[];
  emits: SceneEmit[];
  config: Record<string, unknown>;
  /** Props handed to `<AugmentSlot>` for an augment scene. */
  slotProps: Record<string, unknown>;
  /**
   * A REGISTERED widget id to mount an augment scene inside, instead of the
   * stand-in `Panel`.
   *
   * An overlay augment draws in its host's projection: a map's camera, an SVG
   * transform, a plot's axes. Mounted in a stand-in host it has nothing to draw
   * against and produces a blank frame, which is why overlay augments have
   * never had a render at all. Naming the real host closes that: the host
   * widget mounts, computes its own geometry, passes it through the real slot,
   * and the picture is of the augment where it actually lives.
   *
   * The host has to be in the bundle, which for a first-party host means the
   * run supplied it with `--with`. That is an in-repo affordance and not an
   * author surface: a third-party author cannot import a private package, so a
   * scene of theirs naming a first-party host has nothing to mount.
   */
  host?: string;
  /** Legacy `DataSource` keys, by source id. */
  dataSources: Record<string, Record<string, unknown>>;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
  /**
   * Feed the scene NOTHING: mount it, then suppress every emission and every
   * legacy key. The driver renders each scene twice and compares, because a
   * render that is identical starved is a render of no data whatever the
   * fixture is called. See `../../docs/uplink-rendering.md`.
   */
  starve: boolean;
  steps?: SceneStep[];
}

/** What the driver reads back after a mount, to decide whether to keep the PNG. */
export interface SceneReport {
  /** What a sighted reader sees, screen-reader-only words removed. */
  visibleText: string;
  /** Elements with a non-zero box inside the mounted subtree. */
  boxCount: number;
  /** `visibleText` plus a per-element size outline, hashed. */
  signature: string;
  /** Emitted topics the derived carried set never named. Informational. */
  uncarriedTopics: string[];
  /** Emitted topics nothing in the mounted tree subscribed to. A failure. */
  unsubscribedTopics: string[];
}

// ---------------------------------------------------------------------------
// The inventory: one read of the registries, shared by the renderer and the docs
// ---------------------------------------------------------------------------

/** A size the harness renders a widget at, in grid units and pixels. */
export interface InventoryMode {
  name: string;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
}

export interface InventoryWidget {
  id: string;
  name: string;
  description: string;
  tags: string[];
  channels: string[];
  optionalChannels: string[];
  dataRequirements: string[];
  actions: { id: string; label?: string }[];
  augmentSlots: string[];
  contributionSlots: string[];
  requires: string[];
  replaces?: string;
  pushable: boolean;
  behaviors: string[];
  modes: InventoryMode[];
}

export interface InventoryAugment {
  id: string;
  augments: string;
  channels: string[];
  requires?: string;
  priority?: number;
  suppressesVanillaBase: boolean;
  settings: AugmentSettingField[];
}

export interface InventoryContribution {
  id: string;
  contributes: string;
  deps: string[];
  requires?: string;
  priority?: number;
  settings: AugmentSettingField[];
}

/**
 * The compat numbers the Uplink's bundle was actually built against.
 *
 * Read HERE rather than by the Node driver, and that is the point: these come out
 * of the very bundle whose registrations were just enumerated, so a manifest
 * claiming them is claiming something true about the code it describes. Read
 * Node-side they would come from whichever copy of the packages the tool itself
 * resolved, which is a different question with the same answer most of the time.
 */
export interface UplinkCompat {
  apiVersion: string;
  uiKitVersion: string;
  contractMajor: number;
  contractMinor: number;
}

export interface UplinkInventory {
  id: string;
  name: string;
  version: string;
  compat: UplinkCompat;
  widgets: InventoryWidget[];
  augments: InventoryAugment[];
  contributions: InventoryContribution[];
  processors: string[];
  /**
   * Every registered Processor's own TOPIC deps, keyed by processor id.
   *
   * A contribution may depend on a Processor rather than on topics, and then
   * the topics it ultimately needs are named nowhere in its own registration.
   * A scene fed from that registration alone therefore carried none of them,
   * the subscription-gated transport dropped every emit, and the render was of
   * no data: the ONE case where a legitimate scene could not be expressed at
   * all. Every processor is listed, not just this client's, because a
   * contribution may reasonably depend on one the app declares.
   */
  processorTopicDeps: Record<string, string[]>;
  reckonedTopics: string[];
  derivedChannels: string[];
  /** Every declared client id in the bundle, `core` included. Diagnostic. */
  declaredClients: string[];
  /**
   * Registered widgets this client does NOT own, the ones a scene may name as
   * its `_scene.host`. Never part of the generated page: it describes what the
   * run happened to have in the bundle, not what the Uplink is.
   */
  hosts: InventoryWidget[];
}

/**
 * The three responsive shapes every first-party widget is already rendered at,
 * appended to whatever the registration declares. Names match the existing
 * per-engine baselines so a reader comparing the two sets is comparing like
 * with like.
 */
const RESPONSIVE_MODES: ReadonlyArray<{ name: string; w: number; h: number }> =
  [
    { name: "mobile-9x8", w: 9, h: 8 },
    { name: "portrait-5x18", w: 5, h: 18 },
    { name: "landscape-18x5", w: 18, h: 5 },
  ];

/** A tile for a widget declaring no `defaultSize`. Arbitrary, but stable. */
const FALLBACK_SIZE = { w: 8, h: 8 } as const;

function modesFor(def: ComponentDefinition): InventoryMode[] {
  const out: { name: string; w: number; h: number }[] = [];
  const base = def.defaultSize ?? FALLBACK_SIZE;
  out.push({ name: "default", w: base.w, h: base.h });
  if (def.minSize && (def.minSize.w !== base.w || def.minSize.h !== base.h)) {
    out.push({ name: "min", w: def.minSize.w, h: def.minSize.h });
  }
  out.push(...RESPONSIVE_MODES);
  return out.map((m) => ({ ...m, ...gridToPixels(m.w, m.h) }));
}

function depTopic(dep: unknown): string {
  if (typeof dep === "string") return dep;
  if (dep && typeof dep === "object") {
    const rec = dep as { reading?: string; id?: string };
    if (typeof rec.reading === "string") return rec.reading;
    if (typeof rec.id === "string") return `processor:${rec.id}`;
  }
  return String(dep);
}

/**
 * Everything one Uplink client registered, read off the live registries.
 *
 * This is the ONE derivation. The renderer reads it to know which scenes exist
 * and what size to draw them at; the docs generator reads the same object to
 * write the page. Two reads would be two chances for the page to describe a
 * different Uplink from the one that was photographed.
 */
export function readInventory(uplinkId?: string): UplinkInventory {
  const clients = getUplinkClients();
  const declared = clients.map((c) => c.id);
  const candidates = clients.filter((c) => c.id !== "core");
  const client = uplinkId
    ? candidates.find((c) => c.id === uplinkId)
    : candidates[0];
  if (!client) {
    throw new Error(
      `readInventory: no Uplink client is declared${uplinkId ? ` under id "${uplinkId}"` : ""}. ` +
        `Declared clients: ${declared.join(", ") || "(none)"}. ` +
        "A client declares itself with defineUplinkClient() at module load, so " +
        "the usual cause is that the resolved entry did not import the module " +
        "that calls it.",
    );
  }
  if (!uplinkId && candidates.length > 1) {
    throw new Error(
      `readInventory: ${candidates.length} Uplink clients are declared ` +
        `(${candidates.map((c) => c.id).join(", ")}); name one with --uplink <id>.`,
    );
  }
  const owned = (owner: { id: string } | undefined) => owner?.id === client.id;
  const widgetInventory = (def: ComponentDefinition): InventoryWidget => ({
    id: def.id,
    name: def.name,
    description: def.description,
    tags: [...def.tags],
    channels: [...(def.channels ?? [])],
    optionalChannels: [...(def.optionalChannels ?? [])],
    dataRequirements: (def.dataRequirements ?? []).map((r) =>
      typeof r === "string" ? r : String(r),
    ),
    actions: (def.actions ?? []).map((a) => ({
      id: a.id,
      label: (a as { label?: string }).label,
    })),
    augmentSlots: [...(def.augmentSlots ?? [])],
    contributionSlots: [...(def.contributionSlots ?? [])],
    requires: (def.requires ?? []).map((r) => String(r)),
    replaces: def.replaces,
    pushable: def.pushable === true,
    behaviors: (def.behaviors ?? []).map((b) => String(b)),
    modes: modesFor(def),
  });
  return {
    id: client.id,
    name: client.name,
    version: client.version,
    compat: {
      apiVersion: EXTENSION_API_VERSION,
      uiKitVersion: UI_KIT_VERSION,
      contractMajor: CONTRACT_MAJOR,
      contractMinor: CONTRACT_MINOR,
    },
    declaredClients: declared,
    widgets: getComponents()
      .filter((def) => owned(def.owner))
      .map(widgetInventory),
    hosts: getComponents()
      .filter((def) => !owned(def.owner))
      .map(widgetInventory),
    augments: getAugments()
      .filter((def) => owned(def.owner))
      .map((def) => ({
        id: def.id,
        augments: def.augments,
        channels: [...(def.channels ?? [])],
        requires: def.requires,
        priority: def.priority,
        suppressesVanillaBase: def.suppressesVanillaBase === true,
        settings: [...(def.settings ?? [])],
      })),
    contributions: getContributions()
      .filter((def) => owned(def.owner))
      .map((def) => ({
        id: def.id,
        contributes: def.contributes,
        deps: (def.deps ?? []).map(depTopic),
        requires: def.requires,
        priority: def.priority,
        settings: [...(def.settings ?? [])],
      })),
    processors: getAllProcessors()
      .filter((p) => (p as { owner?: string }).owner === client.id)
      .map((p) => (p as { id: string }).id),
    processorTopicDeps: Object.fromEntries(
      getAllProcessors().map((p) => [
        (p as { id: string }).id,
        ((p as { deps?: readonly unknown[] }).deps ?? [])
          .map(depTopic)
          .filter((topic) => !topic.startsWith("processor:")),
      ]),
    ),
    reckonedTopics: getReckonedTopics()
      .filter((r) => r.owners.includes(client.id))
      .map((r) => r.topic),
    derivedChannels: getContributedChannelTopics()
      .filter((r) => r.owners.includes(client.id))
      .map((r) => r.topic),
  };
}

// ---------------------------------------------------------------------------
// The author's optional browser-side glue
// ---------------------------------------------------------------------------

/**
 * What `client/gonogo-render.setup.ts` may do, for the two Uplinks in nine that
 * need a fake only they can write: a data source with a bespoke status surface,
 * a live WebRTC session.
 *
 * The constraint that makes it safe: `beforeScene` is told whether the scene is
 * STARVED, and a setup that feeds data must honour it. The driver renders every
 * scene twice and fails when the fed and starved renders match, so a setup hook
 * that feeds regardless would defeat the one check that catches a picture of
 * nothing.
 */
export interface RenderSetup {
  /** Run before each mount. Register data sources, seed fakes. */
  beforeScene?: (ctx: {
    scene: ScenePayload;
    starve: boolean;
  }) => void | Promise<void>;
  /**
   * Run once the tree is mounted and fed, before the shot is taken.
   *
   * The place for anything that has to reach the mounted DOM. A `<video>` in
   * headless Chromium does not paint a `captureStream`, so the one harness with
   * a live feed puts a canvas behind the chrome here: it needs the video
   * element to exist to find its stage, which `beforeScene` is too early for and
   * `afterScene` is too late for.
   */
  afterMount?: (ctx: {
    scene: ScenePayload;
    starve: boolean;
  }) => void | Promise<void>;
  /** Run after each capture. Unregister and dispose. */
  afterScene?: (ctx: { scene: ScenePayload }) => void | Promise<void>;
  /** Wrap the scene's tree in extra providers, inside the theme and stream. */
  wrap?: (children: ReactNode, ctx: { scene: ScenePayload }) => ReactNode;
}

let activeSetup: RenderSetup = {};

/** Register the Uplink's own browser-side glue. Call once, at module scope. */
export function defineRenderSetup(setup: RenderSetup): RenderSetup {
  activeSetup = setup;
  return setup;
}

// ---------------------------------------------------------------------------
// Availability feeding
// ---------------------------------------------------------------------------

/**
 * Mirrors the app's `AugmentAvailabilityFeeder`: `<AugmentSlot>`'s `requires`
 * gate reads ui-kit's domain-availability store, and with nothing feeding it
 * `useDomainAvailable` answers `false` forever, so a gated augment never renders
 * however much the fixture emits. Watches every domain any REGISTERED augment or
 * contribution declares rather than only the mounted one, matching the app's own
 * global-truth behaviour.
 */
function AvailabilityFeeder({
  fixture,
}: {
  fixture: StreamFixture;
}): ReactElement | null {
  const store = useDomainAvailabilityStore();
  const [domains] = useState(() => {
    const set = new Set<string>();
    for (const augment of getAugments()) {
      if (augment.requires) set.add(augment.requires);
    }
    for (const contribution of getContributions()) {
      if (contribution.requires) set.add(contribution.requires);
    }
    return [...set];
  });
  if (!store) return null;
  return createElement(
    Fragment,
    null,
    domains.map((domain) =>
      createElement(DomainWatch, { key: domain, domain, store, fixture }),
    ),
  );
}

/**
 * One domain's presence, mirrored into the store. Live once ANY value has
 * arrived, not by its payload, matching the app's own watcher.
 *
 * Subscribes through the fixture's client directly rather than the typed hook:
 * `${domain}.available` is a runtime string, so it cannot be a member of the
 * generated topic union any typed read is keyed on.
 */
function DomainWatch({
  domain,
  store,
  fixture,
}: {
  domain: string;
  store: DomainAvailabilityStore;
  fixture: StreamFixture;
}): null {
  const [value, setValue] = useState<unknown>(undefined);
  useEffect(() => {
    let live = true;
    fixture.client.subscribe(`${domain}.available`, (payload) => {
      if (live) setValue(payload);
    });
    return () => {
      live = false;
    };
  }, [fixture, domain]);
  useEffect(() => {
    store.setAvailable(domain, value !== undefined);
    return () => store.setAvailable(domain, false);
  }, [domain, value, store]);
  return null;
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

let activeRoot: Root | null = null;
let mountedFixture: StreamFixture | null = null;
let activeSourceIds: string[] = [];
let currentScene: ScenePayload | null = null;

function teardown(): void {
  // Media first. A `<video>` removed from the document while a `play()` is
  // still pending rejects with "the play() request was interrupted by a new
  // load request", which arrives as an uncaught page error and fails every
  // render in the run, including the ones already taken.
  for (const video of document.querySelectorAll("video")) {
    video.pause();
  }
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  for (const id of activeSourceIds) {
    try {
      unregisterDataSource(id);
    } catch {
      // Not registered: a scene that failed before registering leaves nothing.
    }
  }
  activeSourceIds = [];
  mountedFixture = null;
}

/** A synthetic host definition for an augment or contribution scene.
 *  See `WidgetHostFor` for why the stack is reused rather than rebuilt. */
function standInHost(
  hostWidgetId: string,
  slot: string,
  kind: SceneTargetKind,
): ComponentDefinition {
  return {
    id: hostWidgetId,
    name: hostWidgetId,
    description: "Stand-in host for a render scene.",
    tags: [],
    component: () => null,
    augmentSlots: kind === "augment" ? [slot] : [],
    contributionSlots: kind === "contribution" ? [slot] : [],
  } as ComponentDefinition;
}

function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * The host widget name a stand-in `Panel` announces.
 *
 * Derived from the slot id's own first segment rather than hand-typed, because a
 * hand-typed `hostTitle: "MANEUVER PLANNER"` is a literal in a harness that
 * drifts from the widget it names and no check can see it. It is a slug rather
 * than the host's registered display name, and the render says so: the real name
 * needs a map of every host's slots, which is the `--in-app` tier's job.
 */
function hostLabelFor(slot: string): string {
  return slot.split(".")[0].replace(/[-_]/g, " ").toUpperCase();
}

async function renderScene(scene: ScenePayload): Promise<SceneReport> {
  currentScene = scene;
  teardown();
  const el = document.getElementById("root");
  if (!el) throw new Error("render probe: no #root in the page");
  el.style.width = `${scene.pxW}px`;
  el.style.height = `${scene.pxH}px`;

  // The dynamic prefixes are folded in the way `TelemetryProvider` folds them in
  // the app, rather than being left to the fixture. They name whole-topic
  // NAMESPACES whose members are keyed at runtime (a per-body survey layer, a
  // per-vessel `fleet.<guid>.delay`), so no registration can list one member and
  // a fixture listing them by hand would be the hand-written carried set this
  // design removed. Everything else in the set comes from the registration.
  const carried = [
    ...new Set([...scene.carriedChannels, ...DYNAMIC_CARRIED_TOPIC_PREFIXES]),
  ];
  const fixture = setupStreamFixture({
    carriedChannels: carried,
    pinnedUt: scene.pinnedUt,
  });
  mountedFixture = fixture;

  if (!scene.starve) {
    for (const [sourceId, keys] of Object.entries(scene.dataSources)) {
      const source = new MockDataSource({
        id: sourceId,
        keys: Object.keys(keys).map((key) => ({ key })),
      });
      registerDataSource(source);
      activeSourceIds.push(sourceId);
      await source.connect();
      for (const [key, value] of Object.entries(keys)) {
        source.emit(key, value);
      }
    }
  }

  await activeSetup.beforeScene?.({ scene, starve: scene.starve });

  const tree = buildTree(scene);
  const wrapped = activeSetup.wrap?.(tree, { scene }) ?? tree;
  activeRoot = createRoot(el);
  activeRoot.render(
    createElement(
      ThemeProvider,
      { theme: harnessTheme },
      createElement(
        fixture.Provider,
        null,
        createElement(
          DomainAvailabilityProvider,
          null,
          createElement(AvailabilityFeeder, { key: "feeder", fixture }),
          wrapped,
        ),
      ),
    ),
  );

  // Two frames before feeding: a StubTransport delivers nothing to a topic
  // nothing has subscribed to, and the subscribe happens on mount. Emitting
  // first is how a fixture silently feeds nothing.
  await frame();
  await frame();

  const unsubscribed = await feedInRounds(fixture, scene);
  const uncarried = unsubscribed.filter((t) => !isCarried(t, carried));

  await activeSetup.afterMount?.({ scene, starve: scene.starve });
  await frame();

  return {
    ...measure(el),
    uncarriedTopics: uncarried,
    unsubscribedTopics: unsubscribed,
  };
}

/**
 * Feed the scene until it stops growing, then report what never landed.
 *
 * One pass is not enough, and the reason is a property of the widget rather
 * than a timing accident: a widget subscribes to a per-body or per-vessel topic
 * only after learning WHICH body, so a per-body coverage channel has no
 * subscriber until `system.bodies` and `vessel.identity` have both arrived and
 * the rows keyed on them have mounted. Production behaves the same way (a mod only
 * produces a channel while something is subscribed to it), so rounds are the
 * faithful shape, not a workaround.
 *
 * What survives to the end is the finding: a `StubTransport` is
 * subscription-gated exactly as production is, so a topic still unsubscribed
 * once the tree has stopped growing is a payload that would be dropped in
 * silence, and the render is of no data.
 */
async function feedInRounds(
  fixture: StreamFixture,
  scene: ScenePayload,
): Promise<string[]> {
  const pending = [...scene.emits];
  // Six is a budget, not a tuned number: each round is one more layer of
  // subscribe-on-what-just-arrived, and a widget nesting deeper than this is
  // better served by a clear failure than by a longer wait.
  for (let round = 0; round < 6 && pending.length > 0; round++) {
    const landed: SceneEmit[] = [];
    for (const emit of pending) {
      if (!fixture.transport.isSubscribed(emit.topic)) continue;
      landed.push(emit);
      if (!scene.starve) {
        fixture.emit(emit.topic, emit.payload, {
          validAt: emit.validAt ?? scene.pinnedUt,
        });
      }
    }
    if (landed.length === 0) break;
    for (const emit of landed) pending.splice(pending.indexOf(emit), 1);
    await frame();
    await frame();
  }
  return pending.map((e) => e.topic);
}

function mountWidget(id: string, scene: ScenePayload): ReactNode {
  const def = getComponent(id);
  if (!def) {
    throw new Error(
      `render probe: no widget registered under "${id}". ` +
        `Registered: ${getComponents()
          .map((c) => c.id)
          .sort()
          .join(", ")}`,
    );
  }
  const Widget = def.component;
  return (
    <WidgetHost widgetId={def.id} instanceId="probe">
      <Widget
        id="probe"
        config={{ ...(def.defaultConfig ?? {}), ...scene.config }}
        w={scene.w}
        h={scene.h}
        onConfigChange={() => {}}
      />
    </WidgetHost>
  );
}

/**
 * Whether `Panel` already mounts this slot for every widget it wraps.
 *
 * The two universal segments are `Panel`'s own, so a stand-in host binding one
 * again renders every augment on it twice.
 */
function mountedByPanel(slot: string): boolean {
  const segment = slot.slice(slot.indexOf(".") + 1);
  return (FRAMEWORK_AUGMENT_SEGMENTS as readonly string[]).includes(segment);
}

/** A dotted slot id names its owning widget; an undotted one is global. */
function isWidgetOwnedSlot(slot: string): boolean {
  return slot.includes(".");
}

function buildTree(scene: ScenePayload): ReactNode {
  if (scene.target.kind === "widget")
    return mountWidget(scene.target.id, scene);

  const slot = slotForTarget(scene.target);
  // The real host, when the scene names one: the augment reaches its slot the
  // same way it does in the dashboard, so nothing here has to know the slot's
  // props or hand them over.
  if (scene.host) {
    if (!getComponent(scene.host)) {
      throw new Error(
        `render probe: "_scene.host" names "${scene.host}", which is not a ` +
          "registered widget in this bundle. A host that ships with the app " +
          "has to be supplied to the run with --with <module that registers " +
          "it>, or declared once in package.json's gonogo.renderWith; " +
          `registered widgets are: ${getComponents()
            .map((c) => c.id)
            .sort()
            .join(", ")}`,
      );
    }
    // A GLOBAL slot (no dot, e.g. `plots`) belongs to no widget: any widget
    // that declares it hosts it, and which one a scene picks is the author's
    // choice rather than something derivable from the id. Only a widget-owned
    // slot has an owner to check the host against.
    if (isWidgetOwnedSlot(slot) && !slot.startsWith(`${scene.host}.`)) {
      throw new Error(
        `render probe: "_scene.host" names "${scene.host}" but this target's ` +
          `slot is "${slot}", which belongs to "${slot.split(".")[0]}". A ` +
          "host that does not own the slot would mount and never render the " +
          "augment, which is a blank picture with no error.",
      );
    }
    return mountWidget(scene.host, scene);
  }

  // A global slot has no widget in its id to stand a host in for, and no
  // stand-in would render it anyway: whatever draws the slot lives inside a
  // real widget. Saying so is the difference between a scene that fails here
  // and a scene that renders an empty panel nobody reads as broken.
  if (!isWidgetOwnedSlot(slot)) {
    throw new Error(
      `render probe: this target's slot is "${slot}", which belongs to no ` +
        "widget, so `_scene.host` must name one that declares it (and the " +
        "run must supply that widget with --with <module that registers it>).",
    );
  }

  const hostWidgetId = slot.split(".")[0];
  const Slot = AugmentSlot as unknown as (props: {
    name: string;
    props: Record<string, unknown>;
  }) => ReactElement;
  return (
    <WidgetHostFor
      def={standInHost(hostWidgetId, slot, scene.target.kind)}
      instanceId="probe"
    >
      {/* No `PanelBody` of our own: `Panel` wraps its children in one, so a
          second was a second content inset.

          And nothing bound here for the two segments `Panel` mounts on every
          widget's behalf. Binding `sections` HERE as well fired both mounts and
          every augment on one rendered TWICE, once per body at its own inset,
          which reads as a widget that draws its contents twice rather than as a
          harness fault. The panel's own mount is the one to keep, being where
          the augment lands in a real host. */}
      <Panel panelTitle={`${hostLabelFor(slot)} (stand-in host)`}>
        {/* The real slot, not the augment's component reached for directly: a
            misspelled slot id renders nothing HERE rather than in someone's
            dashboard, and the `requires` gate is exercised on the way. */}
        {scene.target.kind === "augment" && !mountedByPanel(slot) ? (
          <Slot name={slot} props={scene.slotProps} />
        ) : null}
      </Panel>
    </WidgetHostFor>
  );
}

function slotForTarget(target: SceneTarget): string {
  if (target.kind === "augment") {
    const found = getAugments().find((a) => a.id === target.id);
    if (!found) {
      throw new Error(
        `render probe: no augment registered under "${target.id}". ` +
          `Registered: ${getAugments()
            .map((a) => a.id)
            .sort()
            .join(", ")}`,
      );
    }
    return found.augments;
  }
  const found = getContributions().find((c) => c.id === target.id);
  if (!found) {
    throw new Error(
      `render probe: no contribution registered under "${target.id}". ` +
        `Registered: ${getContributions()
          .map((c) => c.id)
          .sort()
          .join(", ")}`,
    );
  }
  return found.contributes;
}

/** Exact match, or a dotted child of a carried parent, which is how the
 *  timeline store samples a `<parent>.<field>` pair. */
function isCarried(topic: string, carried: readonly string[]): boolean {
  for (const entry of carried) {
    if (entry === topic) return true;
    if (entry.endsWith(".") && topic.startsWith(entry)) return true;
    if (topic.startsWith(`${entry}.`)) return true;
    if (entry.startsWith(`${topic}.`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Measurement: what the driver decides on
// ---------------------------------------------------------------------------

/**
 * A scene's render, reduced to something two runs can be compared on.
 *
 * Text alone is not enough: a coverage bar changing length and a gauge needle
 * moving are both silent in `textContent`, and both are the whole point of the
 * widget. So the signature carries every element's tag and rounded box
 * alongside the visible text. It is deliberately NOT a pixel hash: the driver
 * compares a FED render against a STARVED one, and two renders of the same
 * pixels differ by anti-aliasing on some engines while meaning the same thing.
 */
function measure(host: HTMLElement): {
  visibleText: string;
  boxCount: number;
  signature: string;
} {
  const clone = host.cloneNode(true) as HTMLElement;
  // Screen-reader-only words, and anything a reader cannot read: xterm injects
  // its own stylesheet INTO the widget, so `textContent` otherwise opens with a
  // page of CSS selectors and the signature is mostly stylesheet.
  for (const hidden of clone.querySelectorAll(
    "[data-unit-word], style, script",
  )) {
    hidden.remove();
  }
  const visibleText = (clone.textContent ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts: string[] = [visibleText];
  let boxCount = 0;
  for (const el of Array.from(host.querySelectorAll("*"))) {
    const box = el.getBoundingClientRect();
    if (box.width < 0.5 || box.height < 0.5) continue;
    boxCount++;
    parts.push(
      `${el.tagName}:${Math.round(box.width)}x${Math.round(box.height)}`,
    );
  }
  return { visibleText, boxCount, signature: hash(parts.join("|")) };
}

/** FNV-1a, hex. A signature only has to be stable and short; nothing here is
 *  adversarial, and `crypto.subtle` is async and needs a secure origin. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/** The scene's current pinned instant, moved only by an `advanceUt` step. */
let currentUt = 0;

/** Advance one motion step and settle. The driver screenshots between calls,
 *  so a step's frames are produced by repeated calls rather than in a loop. */
async function stepScene(step: SceneStep, deltaUt: number): Promise<void> {
  const fixture = mountedFixture;
  if (!fixture || !currentScene) {
    throw new Error("render probe: stepScene called before renderScene");
  }
  if (step.emit) {
    fixture.emit(step.emit.topic, step.emit.payload, {
      validAt: step.emit.validAt ?? currentUt,
    });
  }
  if (step.click) {
    const el = document.querySelector(step.click);
    if (!el) {
      throw new Error(
        `render probe: click selector "${step.click}" matched nothing in scene ` +
          `"${currentScene.fixture}"`,
      );
    }
    (el as HTMLElement).click();
  }
  if (deltaUt !== 0) {
    // The clock is an INPUT, which is what separates this from a screen
    // recording: the same fixture produces the same frames on any machine.
    fixture.store.clock.scrubTo(currentUt + deltaUt);
    currentUt += deltaUt;
    fixture.store.beginFrame();
  }
  await frame();
  await frame();
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export interface RenderProbeApi {
  readInventory: (uplinkId?: string) => UplinkInventory;
  renderScene: (scene: ScenePayload) => Promise<SceneReport>;
  stepScene: (step: SceneStep, deltaUt: number) => Promise<void>;
}

/**
 * Everything a page needs before an Uplink's own module is imported.
 *
 * MUST run before the client bundle loads: the sdk's author surface is
 * host-injected shims, so a widget's module-load `registerComponent` throws with
 * "the gonogo host has not been installed" against an uninstalled host. Static
 * ES imports are hoisted above every statement, which is why the generated entry
 * imports the client DYNAMICALLY and awaits this first. Ordering by import
 * position works until an import sorter moves a line.
 */
export async function installRenderProbe(): Promise<RenderProbeApi> {
  installRealTestHost({
    AugmentSlot: AugmentSlot as never,
    clearAugments,
    getAugmentsForSlot: getAugmentsForSlot as (slot: string) => AnyAugment[],
    registerAugment: registerAugment as never,
  });
  // Quantities default to the reader's locale, which is right for an operator
  // and wrong for an image that has to look the same on every machine.
  setQuantityLocale("en-GB");
  registerStockBodies();
  const api: RenderProbeApi = {
    readInventory,
    renderScene: async (scene) => {
      currentUt = scene.pinnedUt;
      return renderScene(scene);
    },
    stepScene,
  };
  (globalThis as Record<string, unknown>)[RENDER_PROBE_GLOBAL] = api;
  return api;
}
