// Straight from `./host` rather than `./index`'s `logger` Proxy, which would be a
// cycle: the barrel re-exports this module. Same reasoning, and the same `hasHost`
// guard, as `./registry.ts`: a source registers at module load, which can run
// before the app installs its host.
import { getHost, hasHost } from "./host";
import type {
  CoverageSourceDefinition,
  NamespacedAugmentSettings,
} from "./types";

/**
 * Mod-agnostic registry for coverage sources.
 *
 * A coverage source contributes DATA (coverage bytes for a body under some layer
 * id), not a renderable component, which is why it is a registry parallel to the
 * augment one rather than another slot kind. Consumed by MapView's own coverage
 * gate as a PAINT-GATE: there is no darkening overlay layer in this design, only
 * surface content whose alpha is modulated per-tile by the composite of every
 * enabled source here.
 *
 * Registering was already published as a host shim, and reading was too, but
 * `clearCoverageSources` was not, so an Uplink contributing coverage could not
 * reset the registry between test cases without reaching an unpublished package.
 */

/**
 * The single global slot the sources live in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same state. See
 * `map-poi.ts` for why a module static is not safe once this can be bundled.
 *
 * The key still says FOG because it is a cross-build rendezvous identifier, not a
 * name: an Uplink bundled against an older copy of this package registers into
 * whatever string that copy holds, so changing it would split the registry in two
 * and the sources from one half would never be seen by the other. It can be
 * renamed once no released Uplink builds against a pre-rename sdk.
 */
const COVERAGE_SOURCE_REGISTRY_KEY = "__GONOGO_FOG_REVEAL_SOURCES__" as const;

interface CoverageSourceRegistry {
  sources: Map<string, { def: CoverageSourceDefinition; order: number }>;
  counter: number;
  listeners: Set<() => void>;
}

function registry(): CoverageSourceRegistry {
  const slot = globalThis as typeof globalThis & {
    [COVERAGE_SOURCE_REGISTRY_KEY]?: CoverageSourceRegistry;
  };
  slot[COVERAGE_SOURCE_REGISTRY_KEY] ??= {
    sources: new Map(),
    counter: 0,
    listeners: new Set(),
  };
  return slot[COVERAGE_SOURCE_REGISTRY_KEY];
}

function notifyChange(): void {
  for (const cb of registry().listeners) cb();
}

export function onCoverageSourcesChange(cb: () => void): () => void {
  const { listeners } = registry();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function registerCoverageSource(def: CoverageSourceDefinition): void {
  if (hasHost()) {
    getHost().logger.info(`REGISTERED coverage source ${def.id}`);
  }
  const state = registry();
  state.sources.set(def.id, { def, order: state.counter++ });
  notifyChange();
}

export function unregisterCoverageSource(id: string): void {
  if (registry().sources.delete(id)) notifyChange();
}

/** Every registered coverage source, in registration order. */
export function getCoverageSources(): CoverageSourceDefinition[] {
  return Array.from(registry().sources.values())
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.def);
}

/**
 * The settings blocks the host panel renders, one per source that declares any.
 * Namespaced by source id so two sources' identically-named fields cannot collide.
 */
export function getCoverageSourceSettings(): NamespacedAugmentSettings[] {
  return getCoverageSources()
    .filter((def) => def.settings && def.settings.length > 0)
    .map((def) => ({
      augmentId: def.id,
      namespace: def.id,
      fields: def.settings ?? [],
    }));
}

/** Empty the registry. For tests; a running app never calls it. */
export function clearCoverageSources(): void {
  const state = registry();
  state.sources.clear();
  state.counter = 0;
  notifyChange();
}
