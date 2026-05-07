import { logger } from "@gonogo/logger";
import { clearKosScripts } from "./kos/scriptRegistry";
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

/** For use in tests only — resets all registries to empty. */
export function clearRegistry(): void {
  components.clear();
  dataSources.clear();
  themes.clear();
  clearKosScripts();
  notifyDataSourceChange();
}
