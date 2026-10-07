// Straight from `./host` rather than `./index`'s `logger` Proxy, which would be a
// cycle: the barrel re-exports this module. The host's own `logger` is the same
// object the Proxy resolves to, so nothing is lost by skipping it.
//
// It is the HOST's logger and never `@ksp-gonogo/logger`'s singleton: a bundled
// second copy of that is console-only and never reaches the shared ring buffer or
// Axiom. The `hasHost` guard is not defensive tidiness, it is required, because a
// widget calls `registerComponent` at MODULE LOAD and that can run before the app
// installs its host: an unguarded call would turn every early registration into
// the "no host installed" throw.
import { getHost, hasHost } from "./host";
import { TINY_SIZE } from "./tiny-size";
import type { ComponentDefinition, DataSource, ThemeDefinition } from "./types";

/**
 * The component / data-source / theme registry: the extension model's front door.
 * A package registers at module load and the dashboard renders whatever is
 * registered, so this Map IS the plugin system.
 *
 * It lives here rather than in `@ksp-gonogo/core` because every Uplink writes to
 * it and 18 Uplink test files call `clearRegistry` between cases. Registration
 * was already published as a host shim; nothing else was, so an Uplink could add
 * a widget and had no supported way to reset or read the registry it added to.
 *
 * The ORCHESTRATION reads (`getResolvedComponents`, `getReplacementConflicts`,
 * `getThemes`, ...) are deliberately not on the author barrel: see
 * `../registry/index.ts` for where they surface and why.
 */

/**
 * The single global slot the registry lives in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same Maps.
 *
 * This one matters more than the others: a second copy of THIS registry is the
 * project's single scariest failure mode, a widget registering into a Map the
 * dashboard never reads, with no error anywhere. That is the whole reason the
 * author surface was shims to begin with.
 */
const REGISTRY_KEY = "__GONOGO_COMPONENT_REGISTRY__" as const;

// `ComponentType` is contravariant in props, so neither `unknown` nor `never`
// would work here. `Config` is checked at the call site (`registerComponent` /
// `registerDataSource`); the internal Map just needs to hold anything.
/**
 * A registered widget's definition, whatever its config type: the same type
 * as {@link ComponentDefinition}.
 *
 * @category Registering
 */
export type AnyDef = ComponentDefinition;
/**
 * A registered data source: the same type as {@link DataSource}.
 *
 * @category Registering
 */
export type AnySource = DataSource;

interface Registry {
  components: Map<string, AnyDef>;
  dataSources: Map<string, AnySource>;
  themes: Map<string, ThemeDefinition>;
}

function registry(): Registry {
  const slot = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  slot[REGISTRY_KEY] ??= {
    components: new Map(),
    dataSources: new Map(),
    themes: new Map(),
  };
  return slot[REGISTRY_KEY];
}

// Generic so that the component/defaultConfig pairing is checked at the call
// site, but erased to `AnyDef` in the registry so the orchestrator can render any
// component.
//
/**
 * Whether a repeat registration under one id is the SAME registration arriving
 * twice (benign) or two packages fighting for the id (a hard error).
 *
 * Reference equality was the whole test until 2026-08-19, and it was sound while
 * the registry was a module static in `@ksp-gonogo/core`: one registry meant one
 * module graph, so a re-import handed back the identical object.
 *
 * It stops being sound the moment the registry is a `globalThis` slot, which is
 * the entire point of that slot: two BUNDLES now find one registry, and a module
 * evaluated in each produces two distinct objects describing one widget. Reference
 * equality cannot tell that apart from a genuine collision, and the throw would
 * land on the benign case.
 *
 * So the test is the DECLARED IDENTITY instead. Two packages fighting for an id
 * are two different widgets with two different names, which is also why the error
 * message quotes both names: it is the field that distinguishes them. Two
 * genuinely different widgets sharing an id AND a name would slip through, which
 * is a far narrower hole than throwing on every duplicated bundle.
 */
function isSameRegistration(
  existing: { id: string; name: string },
  incoming: { id: string; name: string },
): boolean {
  return existing === incoming || existing.name === incoming.name;
}

/**
 * Adds a widget to the dashboard's catalogue. Call it once, at module load.
 *
 * Widget ids share one namespace across every package, and registering a
 * widget under an id already taken throws when its `name` differs from the one
 * registered. Prefix your ids with your Uplink's name (`foo-status`,
 * `foo-map`) to stay clear of the built-in widgets and of other Uplinks. The
 * id is registered exactly as you write it: passing `owner` records which
 * Uplink the widget belongs to and adds nothing to the id. That differs from
 * the `register...` methods on the handle `defineUplinkClient` returns, which
 * put the Uplink's id in front of the id they are given, so a contribution
 * registered as `"badge"` through the handle of `my-uplink` is
 * `"my-uplink:badge"`. Registering the
 * same id with the same `name` again, as happens when a module is loaded by
 * two bundles, is taken as the same widget and does nothing.
 *
 * @category Registering
 * @categoryDescription Registering
 * Putting an Uplink's pieces into the app: registering widgets, themes, data
 * sources and providers, the definition each one takes, and the props and
 * config a widget is rendered with. Every Uplink client starts here.
 */
export function registerComponent<Config = Record<string, unknown>>(
  def: ComponentDefinition<Config>,
): void {
  const { components } = registry();
  const existing = components.get(def.id);
  if (existing !== undefined) {
    if (isSameRegistration(existing, def as AnyDef)) return;
    throw new Error(
      `Component id "${def.id}" is already registered by "${existing.name}"; ` +
        `"${def.name}" cannot re-use it. Component ids must be unique across all registered packages.`,
    );
  }
  if (
    def.tiny !== undefined &&
    def.tiny.bindsActions !== true &&
    (def.actions?.length ?? 0) > 0
  ) {
    throw new Error(
      `Component "${def.id}" declares both actions and a tiny mode. Its component ` +
        `is not mounted while it is tiny, so its action handlers would stop at that size. ` +
        `Bind them in the tiny mode's useEssentials and set bindsActions: true.`,
    );
  }
  const min = def.minSize;
  if (def.tiny !== undefined && min !== undefined) {
    const size = `minSize ${min.w}x${min.h}`;
    const tinySize = `tiny size ${TINY_SIZE.w}x${TINY_SIZE.h}`;
    if (min.w < TINY_SIZE.w || min.h < TINY_SIZE.h) {
      throw new Error(
        `Component "${def.id}" has ${size}, below the ${tinySize}. A widget with a tiny mode ` +
          `shrinks to the tiny size, so its minSize (where its own body stops fitting) ` +
          `cannot be smaller than that on either axis.`,
      );
    }
    if (min.w === TINY_SIZE.w && min.h === TINY_SIZE.h) {
      throw new Error(
        `Component "${def.id}" has ${size}, the same as the ${tinySize}, so its tiny form ` +
          `would never show. Give it a minSize larger than the tiny size on one axis, or drop its tiny mode.`,
      );
    }
  }
  if (hasHost()) getHost().logger.info(`REGISTERED ${def.name}`);
  components.set(def.id, def as AnyDef);
}

/**
 * Adds a data source to Settings, Data Sources, replacing any registered under
 * the same id.
 *
 * @category Registering
 */
export function registerDataSource<
  Config extends Record<string, unknown> = Record<string, unknown>,
>(source: DataSource<Config>): void {
  registry().dataSources.set(source.id, source as AnySource);
}

/**
 * Removes the source registered under `id`. Does nothing if none is.
 *
 * @category Registering
 */
export function unregisterDataSource(id: string): void {
  registry().dataSources.delete(id);
}

/**
 * Adds a theme the operator can switch to. Theme ids are unique, and registering
 * a second theme under an id already taken throws.
 *
 * @category Registering
 */
export function registerTheme(def: ThemeDefinition): void {
  const { themes } = registry();
  const existing = themes.get(def.id);
  if (existing !== undefined) {
    // Same idempotent-vs-collision rule as registerComponent: see
    // `isSameRegistration`. A theme pack is the case that actually hit it.
    if (isSameRegistration(existing, def)) return;
    throw new Error(
      `Theme id "${def.id}" is already registered by "${existing.name}"; ` +
        `"${def.name}" cannot re-use it. Theme ids must be unique across all registered packages.`,
    );
  }
  themes.set(def.id, def);
}

export function getComponents(): AnyDef[] {
  return Array.from(registry().components.values());
}

/**
 * The widget registered under `id`, or `undefined`.
 *
 * @category Registering
 */
export function getComponent(id: string): AnyDef | undefined {
  return registry().components.get(id);
}

/**
 * A widget-replacement conflict: two or more registered widgets
 * declare `replaces` the same `targetId`. Two full replacements are
 * fundamentally not composable, so this is surfaced (for a user config pick /
 * explicit priority) rather than silently merged.
 */
export interface ReplacementConflict {
  /** The widget id both replacers target. */
  targetId: string;
  /** The ids of the widgets competing to replace it (≥2). */
  replacerIds: string[];
}

/**
 * Every replacement conflict currently in the registry: targets with two or more
 * registered replacers. Empty when replacement is unambiguous. The host uses this
 * to prompt the user to choose; {@link getResolvedComponents} leaves a conflicted
 * target's original in place and hides the competing replacers until one is
 * chosen, so nothing is silently merged.
 */
export function getReplacementConflicts(): ReplacementConflict[] {
  const replacersByTarget = new Map<string, string[]>();
  for (const def of registry().components.values()) {
    if (def.replaces === undefined) continue;
    const list = replacersByTarget.get(def.replaces) ?? [];
    list.push(def.id);
    replacersByTarget.set(def.replaces, list);
  }
  const conflicts: ReplacementConflict[] = [];
  for (const [targetId, replacerIds] of replacersByTarget) {
    if (replacerIds.length >= 2) conflicts.push({ targetId, replacerIds });
  }
  return conflicts;
}

/**
 * The components to actually render, with widget-level replacement
 * applied:
 *
 * - A target with exactly ONE registered replacer → the original is suppressed
 *   and the replacer takes its place.
 * - A target with TWO OR MORE replacers → a conflict ({@link
 *   getReplacementConflicts}): the original is kept, and every competing
 *   replacer is withheld until the user resolves it. Never silently merged.
 * - A replacer whose target isn't registered renders as an ordinary component.
 *
 * Prefer this over {@link getComponents} anywhere the rendered widget set is
 * assembled; `getComponents` remains the raw, unresolved view.
 */
export function getResolvedComponents(): AnyDef[] {
  const { components } = registry();
  const replacersByTarget = new Map<string, AnyDef[]>();
  for (const def of components.values()) {
    if (def.replaces === undefined) continue;
    const list = replacersByTarget.get(def.replaces) ?? [];
    list.push(def);
    replacersByTarget.set(def.replaces, list);
  }

  // Ids to drop from the output: suppressed originals (single replacement) and conflicted replacers (held back pending user resolution).
  const suppressed = new Set<string>();
  for (const [targetId, replacers] of replacersByTarget) {
    if (replacers.length === 1) {
      suppressed.add(targetId); // original replaced by its sole replacer
    } else {
      // Conflict: keep the original, withhold the competing replacers.
      for (const replacer of replacers) suppressed.add(replacer.id);
    }
  }

  return Array.from(components.values()).filter(
    (def) => !suppressed.has(def.id),
  );
}

/**
 * Every registered data source.
 *
 * @category Registering
 */
export function getDataSources(): AnySource[] {
  return Array.from(registry().dataSources.values());
}

/**
 * The data source registered under `id`, or `undefined`.
 *
 * @category Registering
 */
export function getDataSource(id: string): AnySource | undefined {
  return registry().dataSources.get(id);
}

export function getThemes(): ThemeDefinition[] {
  return Array.from(registry().themes.values());
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return registry().themes.get(id);
}

/**
 * Removes every registered widget, data source and theme. For tests; a running
 * app never calls it.
 *
 * Augments and contributions stay registered: clear those with
 * {@link clearAugments} and {@link clearContributions}. A registry an Uplink
 * keeps for itself is not touched either.
 *
 * @category Registering
 */
export function clearRegistry(): void {
  const state = registry();
  state.components.clear();
  state.dataSources.clear();
  state.themes.clear();
}
