// ---------------------------------------------------------------------------
// The in-memory registries a test host is made of.
//
// Every stateful `registerX`/`getX` member of `GonogoHost` is, underneath the
// app's implementation, a module-global map plus a listener set. That is the
// whole of what a test needs from them: a widget registers, the test reads back
// what was registered, and `resetTestRegistries` empties them between tests.
//
// Self-contained by construction: nothing here imports `@ksp-gonogo/core`, so
// the sdk leaf stays a leaf. The app's real registries carry behaviour these
// deliberately do not (ordering guarantees the dashboard depends on, dev-mode
// duplicate-id warnings, cross-registry invalidation); where a test turns out
// to depend on one of those, the fix is to add it HERE, named, rather than to
// reach back across the boundary for the real one.
// ---------------------------------------------------------------------------

import type {
  AnyContribution,
  AugmentDefinition,
  BodyDefinition,
  ComponentDefinition,
  FogRevealSourceDefinition,
  MapPoiProviderDefinition,
  SettingDefinition,
  SettingsTabDefinition,
  ThemeDefinition,
  UplinkClientHandle,
} from "../api/types";

/** A listener set with the subscribe/notify pair every change-notifying registry repeats. */
class Listeners {
  private readonly listeners = new Set<() => void>();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  notify(): void {
    for (const cb of [...this.listeners]) cb();
  }

  clear(): void {
    this.listeners.clear();
  }
}

// Registration order is the tie-break every "in registration order" contract on
// `GonogoHost` names, and a Map preserves insertion order, so re-registering an
// id keeps its ORIGINAL position. That matches the app: a re-registration is a
// replacement, not a move to the back.
const components = new Map<string, ComponentDefinition<never>>();
const themes = new Map<string, ThemeDefinition>();
const augments = new Map<string, AugmentDefinition<string>>();
const fogRevealSources = new Map<string, FogRevealSourceDefinition>();
const mapPoiProviders = new Map<string, MapPoiProviderDefinition>();
const contributions = new Map<string, AnyContribution>();
const uplinkHandles = new Map<string, unknown>();
const uplinkClients = new Map<string, UplinkClientHandle>();
const settingsTabs = new Map<string, SettingsTabDefinition>();
const settings = new Map<string, SettingDefinition>();
const bodies = new Map<string, BodyDefinition>();

const fogListeners = new Listeners();
const poiListeners = new Listeners();
const contributionListeners = new Listeners();

// ── Components ──────────────────────────────────────────────────────────────

export function registerTestComponent<TConfig>(
  def: ComponentDefinition<TConfig>,
): void {
  components.set(def.id, def as unknown as ComponentDefinition<never>);
}

export function getTestComponent(
  id: string,
): ComponentDefinition<never> | undefined {
  return components.get(id);
}

export function getTestComponents(): ComponentDefinition<never>[] {
  return [...components.values()];
}

// ── Themes ──────────────────────────────────────────────────────────────────

export function registerTestTheme(def: ThemeDefinition): void {
  themes.set(def.id, def);
}

export function getTestThemes(): ThemeDefinition[] {
  return [...themes.values()];
}

// ── Augments ────────────────────────────────────────────────────────────────

export function registerTestAugment<S extends string>(
  def: AugmentDefinition<S>,
): void {
  augments.set(def.id, def as unknown as AugmentDefinition<string>);
}

/**
 * Every augment bound into `slot`, ascending `priority` (default 0), ties in
 * registration order. `Array.prototype.sort` is stable, so the filter's
 * insertion order survives the sort and the tie-break needs no explicit key.
 */
export function getTestAugmentsForSlot(
  slot: string,
): AugmentDefinition<string>[] {
  return [...augments.values()]
    .filter((a) => a.augments === slot)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

// ── Fog reveal sources ──────────────────────────────────────────────────────

export function registerTestFogRevealSource(
  def: FogRevealSourceDefinition,
): void {
  fogRevealSources.set(def.id, def);
  fogListeners.notify();
}

export function getTestFogRevealSources(): FogRevealSourceDefinition[] {
  return [...fogRevealSources.values()];
}

export function onTestFogRevealSourcesChange(cb: () => void): () => void {
  return fogListeners.subscribe(cb);
}

// ── Map POI providers ───────────────────────────────────────────────────────

export function registerTestMapPoiProvider(
  def: MapPoiProviderDefinition,
): void {
  mapPoiProviders.set(def.id, def);
  poiListeners.notify();
}

export function getTestMapPoiProviders(): MapPoiProviderDefinition[] {
  return [...mapPoiProviders.values()];
}

export function onTestMapPoiProvidersChange(cb: () => void): () => void {
  return poiListeners.subscribe(cb);
}

export function clearTestMapPoiProviders(): void {
  mapPoiProviders.clear();
  poiListeners.notify();
}

// ── Contributions ───────────────────────────────────────────────────────────

export function registerTestContribution(def: AnyContribution): void {
  contributions.set(def.id, def);
  contributionListeners.notify();
}

/** Same ordering contract, and same stable-sort reasoning, as `getTestAugmentsForSlot`. */
export function getTestContributionsForSlot(slot: string): AnyContribution[] {
  return [...contributions.values()]
    .filter((c) => c.contributes === slot)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

export function onTestContributionsChange(cb: () => void): () => void {
  return contributionListeners.subscribe(cb);
}

export function clearTestContributions(): void {
  contributions.clear();
  contributionListeners.notify();
}

// ── Uplink handles and client identities ────────────────────────────────────

export function registerTestUplinkHandle<T>(uplinkId: string, handle: T): void {
  uplinkHandles.set(uplinkId, handle);
}

export function getTestUplinkHandle<T = unknown>(
  uplinkId: string,
): T | undefined {
  return uplinkHandles.get(uplinkId) as T | undefined;
}

export function registerTestUplinkClient(handle: UplinkClientHandle): void {
  uplinkClients.set(handle.id, handle);
}

export function getTestUplinkClients(): UplinkClientHandle[] {
  return [...uplinkClients.values()];
}

// ── Settings surface (the DECLARATIONS; values live in the settings store) ──

export function registerTestSettingsTab(def: SettingsTabDefinition): void {
  settingsTabs.set(def.id, def);
}

export function getTestSettingsTabs(): SettingsTabDefinition[] {
  return [...settingsTabs.values()];
}

export function registerTestSetting(def: SettingDefinition): void {
  settings.set(def.id, def);
}

export function getTestSettings(): SettingDefinition[] {
  return [...settings.values()];
}

// ── Bodies ──────────────────────────────────────────────────────────────────

export function registerTestBody(def: BodyDefinition): void {
  bodies.set(def.id, def);
}

export function getTestBody(id: string): BodyDefinition | undefined {
  return bodies.get(id);
}

/**
 * Empty every registry and drop every listener.
 *
 * One function rather than a `clearX` per registry: the failure this prevents
 * is a suite that clears four of them and leaks the fifth into the next test,
 * and a caller who has to name each one will eventually miss one. The
 * individual `clearTestMapPoiProviders`/`clearTestContributions` exist only
 * because `GonogoHost` declares them.
 */
export function resetTestRegistries(): void {
  components.clear();
  themes.clear();
  augments.clear();
  fogRevealSources.clear();
  mapPoiProviders.clear();
  contributions.clear();
  uplinkHandles.clear();
  uplinkClients.clear();
  settingsTabs.clear();
  settings.clear();
  bodies.clear();
  fogListeners.clear();
  poiListeners.clear();
  contributionListeners.clear();
}
