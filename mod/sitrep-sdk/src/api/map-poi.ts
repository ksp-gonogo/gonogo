import type { MapPoiProviderDefinition } from "./types";

/**
 * The map-POI registry, which lives HERE rather than in `@ksp-gonogo/core`
 * because an Uplink is the main thing that contributes to it: registering a
 * provider was already reachable from the published surface as a host shim, but
 * READING one back (`getMapPoiProviders`) was not, so an Uplink could write to
 * this registry and then had no published way to assert it had.
 *
 * A provider contributes DATA (an array of points for the currently-mapped
 * body), not a renderable component. MapView owns the ONE shared
 * hover/action/marker-styling surface, so N providers do not each invent their
 * own hover UX. Consumed by MapView's `MapPoiLayer`.
 */

/**
 * The single global slot the registry lives in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same state.
 *
 * A module-static `Map` was safe while `core` was the only home and nothing
 * bundled it. Now that this file can be bundled into an Uplink, a module-static
 * one would be the silent second-copy-of-a-registry failure: the Uplink
 * registers a provider into its own copy and MapView reads the app's, with no
 * error anywhere. Same reasoning, and the same fix, as `PerfBudget`'s registry.
 */
const MAP_POI_REGISTRY_KEY = "__GONOGO_MAP_POI_PROVIDERS__" as const;

interface MapPoiRegistry {
  providers: Map<string, { def: MapPoiProviderDefinition; order: number }>;
  /** Registration order, so `getMapPoiProviders` is stable rather than Map-insertion-lucky. */
  counter: number;
  listeners: Set<() => void>;
}

function registry(): MapPoiRegistry {
  const slot = globalThis as typeof globalThis & {
    [MAP_POI_REGISTRY_KEY]?: MapPoiRegistry;
  };
  slot[MAP_POI_REGISTRY_KEY] ??= {
    providers: new Map(),
    counter: 0,
    listeners: new Set(),
  };
  return slot[MAP_POI_REGISTRY_KEY];
}

function notifyChange(): void {
  for (const cb of registry().listeners) cb();
}

export function onMapPoiProvidersChange(cb: () => void): () => void {
  const { listeners } = registry();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function registerMapPoiProvider(def: MapPoiProviderDefinition): void {
  const state = registry();
  state.providers.set(def.id, { def, order: state.counter++ });
  notifyChange();
}

/** Every registered provider, in registration order. */
export function getMapPoiProviders(): MapPoiProviderDefinition[] {
  return Array.from(registry().providers.values())
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.def);
}

/** Empty the registry. For tests; a running app never calls it. */
export function clearMapPoiProviders(): void {
  const state = registry();
  state.providers.clear();
  state.counter = 0;
  notifyChange();
}
