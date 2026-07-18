import { logger } from "@ksp-gonogo/logger";
import type { ComponentDefinition, DataSource, ThemeDefinition } from "./types";

// ComponentType is contravariant in props, so neither unknown nor never would work.
// TConfig is checked at the call site (registerComponent / registerDataSource);
// the internal Map just needs to hold anything.
export type AnyDef = ComponentDefinition;
export type AnySource = DataSource;

const components = new Map<string, AnyDef>();
const dataSources = new Map<string, AnySource>();
const themes = new Map<string, ThemeDefinition>();

// Bumped whenever the data-source map mutates (register / replace / clear).
// `useDataSourceSubscription` watches this so a swap of the source under an
// existing id (e.g. live → replay) re-triggers the hook's subscribe path
// against the new source instance instead of staying bound to the old one.
const dataSourceListeners = new Set<() => void>();
function notifyDataSourceChange(): void {
  for (const cb of dataSourceListeners) cb();
}

export function onDataSourcesChange(cb: () => void): () => void {
  dataSourceListeners.add(cb);
  return () => {
    dataSourceListeners.delete(cb);
  };
}

// Generic so that component/defaultConfig pairing is checked at the call site,
// but erased to AnyDef in the registry so the orchestrator can render any component.
export function registerComponent<TConfig = Record<string, unknown>>(
  def: ComponentDefinition<TConfig>,
): void {
  logger.info(`REGISTERED ${def.name}`);
  components.set(def.id, def as AnyDef);
}

export function registerDataSource<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
>(source: DataSource<TConfig>): void {
  dataSources.set(source.id, source as AnySource);
  notifyDataSourceChange();
}

/**
 * Remove the source registered under `id`. No-op if nothing is registered.
 * Notifies subscribers so any `useDataSourceSubscription` consumers
 * re-evaluate against the empty registry slot (returning their initial
 * snapshot until something else takes the slot).
 */
export function unregisterDataSource(id: string): void {
  if (dataSources.delete(id)) notifyDataSourceChange();
}

export function registerTheme(def: ThemeDefinition): void {
  themes.set(def.id, def);
}

export function getComponents(): AnyDef[] {
  return Array.from(components.values());
}

export function getComponent(id: string): AnyDef | undefined {
  return components.get(id);
}

/**
 * A widget-replacement conflict (spec §4.5): two or more registered widgets
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
 * Every replacement conflict currently in the registry — targets with two or
 * more registered replacers. Empty when replacement is unambiguous. The host
 * uses this to prompt the user to choose; {@link getResolvedComponents} leaves a
 * conflicted target's original in place and hides the competing replacers until
 * one is chosen, so nothing is silently merged.
 */
export function getReplacementConflicts(): ReplacementConflict[] {
  const replacersByTarget = new Map<string, string[]>();
  for (const def of components.values()) {
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
 * The components to actually render, with widget-level replacement (spec §4.5)
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
  return Array.from(dataSources.values());
}

export function getDataSource(id: string): AnySource | undefined {
  return dataSources.get(id);
}

export function getThemes(): ThemeDefinition[] {
  return Array.from(themes.values());
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.get(id);
}

/**
 * For use in tests only — resets the component / data-source / theme
 * registries to empty.
 *
 * Deliberately does NOT clear the augment registry. Augments (spec §4.2) are
 * module-load registrations that an augment-consuming widget resolves through
 * the registry AT RENDER TIME (`getAugmentsForSlot`) — unlike components, which
 * a widget test renders directly, bypassing the registry. `setupMockDataSource`
 * calls this before nearly every widget test to reset per-test data-source
 * state; if that also wiped augments, a widget whose real content arrives via a
 * slot (e.g. Objectives' mission + contract sources) would render an empty slot
 * because nothing re-runs the once-only module-load `registerAugment`. Augment
 * registry tests clear it explicitly with `clearAugments()` instead.
 *
 * Also deliberately does NOT clear the kOS script registry — that registry
 * now lives in the kos Uplink (`@ksp-gonogo/kos`'s `clearKosScripts`), not
 * core; core can never depend on a mod Uplink package. Tests that need a
 * clean kOS-script registry between cases call `clearKosScripts()` directly
 * from `@ksp-gonogo/kos`.
 */
export function clearRegistry(): void {
  components.clear();
  dataSources.clear();
  themes.clear();
  notifyDataSourceChange();
}
