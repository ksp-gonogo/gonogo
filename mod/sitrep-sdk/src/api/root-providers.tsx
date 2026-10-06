import type { ComponentType, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { Screen } from "../spine/screen";

/**
 * A React provider the app mounts around a whole screen, for an Uplink whose
 * widgets share state: the provider sets the state up once, above every
 * widget. Register one with the `registerRootProvider` of the handle
 * {@link defineUplinkClient} returns.
 *
 * @category Registering
 */
export interface RootProviderDefinition {
  /** Stable id. Registered through an Uplink's handle, it is prefixed with the Uplink's id. */
  id: string;
  /**
   * The provider, mounted once per screen around everything on it.
   *
   * It receives the screen it is mounted on and must key any state it saves
   * by it, or the main screen and a station on one machine overwrite each
   * other's. It is mounted as soon as its Uplink loads, whether or not the
   * Uplink's mod is running, so it must be cheap and do nothing while the mod
   * is absent.
   */
  Provider: ComponentType<{ screen: Screen; children: ReactNode }>;
}

/**
 * The single global slot the providers live in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same state. An
 * Uplink's client bundle resolves this package through the app's import map, so
 * it should share this module instance, but "should" is not a thing to stake a
 * silently-missing context on. Same reasoning as `./coverage-source.ts`.
 */
const ROOT_PROVIDER_REGISTRY_KEY = "__GONOGO_ROOT_PROVIDERS__" as const;

interface RootProviderRegistry {
  providers: Map<string, RootProviderDefinition>;
  listeners: Set<() => void>;
  /**
   * Cached because it is a `useSyncExternalStore` snapshot: returning a fresh
   * array per call is a new identity every render, which the store reads as a
   * change and loops on forever.
   */
  snapshot: RootProviderDefinition[];
}

function registry(): RootProviderRegistry {
  const slot = globalThis as typeof globalThis & {
    [ROOT_PROVIDER_REGISTRY_KEY]?: RootProviderRegistry;
  };
  slot[ROOT_PROVIDER_REGISTRY_KEY] ??= {
    providers: new Map(),
    listeners: new Set(),
    snapshot: [],
  };
  return slot[ROOT_PROVIDER_REGISTRY_KEY];
}

function publish(): void {
  const reg = registry();
  reg.snapshot = [...reg.providers.values()];
  for (const listener of reg.listeners) listener();
}

/**
 * Adds a {@link RootProviderDefinition}, replacing any registered under the
 * same id. An Uplink registers through its handle's `registerRootProvider`
 * instead, which prefixes the id.
 *
 * @category Registering
 */
export function registerRootProvider(def: RootProviderDefinition): void {
  registry().providers.set(def.id, def);
  publish();
}

/**
 * Every registered root provider, in registration order, which is the order
 * they mount in, outermost first.
 *
 * @category Registering
 */
export function getRootProviders(): RootProviderDefinition[] {
  return registry().snapshot;
}

/**
 * Removes every root provider. For tests; a running app never calls it.
 *
 * @category Registering
 */
export function clearRootProviders(): void {
  registry().providers.clear();
  publish();
}

function subscribe(listener: () => void): () => void {
  const { listeners } = registry();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Mounts every registered root provider around `children`, for one screen.
 *
 * A provider registered after this has mounted, as an Uplink loaded at runtime
 * registers one, is mounted when it arrives. Each change to the set remounts
 * `children` once, so state that must survive it belongs above this
 * component.
 *
 * @category Registering
 */
export function RootProviders({
  screen,
  children,
}: {
  screen: Screen;
  children: ReactNode;
}) {
  const defs = useSyncExternalStore(
    subscribe,
    getRootProviders,
    getRootProviders,
  );
  return defs.reduceRight(
    (acc, def) => (
      <def.Provider key={def.id} screen={screen}>
        {acc}
      </def.Provider>
    ),
    children,
  );
}
