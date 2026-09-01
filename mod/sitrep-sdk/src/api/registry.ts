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
 * `getThemes`, …) are deliberately not on the author barrel: see
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
// would work here. `TConfig` is checked at the call site (`registerComponent` /
// `registerDataSource`); the internal Map just needs to hold anything.
export type AnyDef = ComponentDefinition;
export type AnySource = DataSource;

interface Registry {
  components: Map<string, AnyDef>;
  dataSources: Map<string, AnySource>;
  themes: Map<string, ThemeDefinition>;
  /**
   * Bumped whenever the data-source map mutates (register / replace / clear).
   * `useDataSourceSubscription` watches this so a swap of the source under an
   * existing id (e.g. live → replay) re-triggers the hook's subscribe path
   * against the new source instance instead of staying bound to the old one.
   */
  dataSourceListeners: Set<() => void>;
}

function registry(): Registry {
  const slot = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  slot[REGISTRY_KEY] ??= {
    components: new Map(),
    dataSources: new Map(),
    themes: new Map(),
    dataSourceListeners: new Set(),
  };
  return slot[REGISTRY_KEY];
}

function notifyDataSourceChange(): void {
  for (const cb of registry().dataSourceListeners) cb();
}

export function onDataSourcesChange(cb: () => void): () => void {
  const { dataSourceListeners } = registry();
  dataSourceListeners.add(cb);
  return () => {
    dataSourceListeners.delete(cb);
  };
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

// Ids share one flat namespace across every registered package, and a duplicate
// id is a hard error (below). There is no formal per-package namespace: external
// and Uplink widgets SHOULD prefix their id with their package/mod slug (a "foo"
// mod's widgets as `foo-status`, `foo-map`, …) to stay clear of the built-ins and
// each other. The hard error enforces uniqueness; the prefix convention is how
// you avoid tripping it.
export function registerComponent<TConfig = Record<string, unknown>>(
  def: ComponentDefinition<TConfig>,
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
  if (hasHost()) getHost().logger.info(`REGISTERED ${def.name}`);
  components.set(def.id, def as AnyDef);
}

export function registerDataSource<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
>(source: DataSource<TConfig>): void {
  registry().dataSources.set(source.id, source as AnySource);
  notifyDataSourceChange();
}

/**
 * Remove the source registered under `id`. No-op if nothing is registered.
 * Notifies subscribers so any `useDataSourceSubscription` consumers re-evaluate
 * against the empty registry slot (returning their initial snapshot until
 * something else takes the slot).
 */
export function unregisterDataSource(id: string): void {
  if (registry().dataSources.delete(id)) notifyDataSourceChange();
}

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

  // Ids to drop from the output: suppressed originals (single replacement) and
  // conflicted replacers (held back pending user resolution).
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

export function getDataSources(): AnySource[] {
  return Array.from(registry().dataSources.values());
}

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
 * For use in tests only: resets the component / data-source / theme registries to
 * empty.
 *
 * Deliberately does NOT clear the augment registry. Augments are
 * module-load registrations that an augment-consuming widget resolves through the
 * registry AT RENDER TIME (`getAugmentsForSlot`), unlike components, which a
 * widget test renders directly, bypassing the registry. `setupMockDataSource`
 * calls this before nearly every widget test to reset per-test data-source state;
 * if that also wiped augments, a widget whose real content arrives via a slot
 * (e.g. Objectives' mission + contract sources) would render an empty slot
 * because nothing re-runs the once-only module-load `registerAugment`. Augment
 * registry tests clear it explicitly with `clearAugments()` instead.
 *
 * Nor does it reach any registry an UPLINK owns. It cannot: this package is the
 * leaf every Uplink depends on, so it can never depend on one back. An Uplink
 * that keeps its own registry publishes its own clear, and a test wanting both
 * calls both.
 */
export function clearRegistry(): void {
  const state = registry();
  state.components.clear();
  state.dataSources.clear();
  state.themes.clear();
  notifyDataSourceChange();
}
