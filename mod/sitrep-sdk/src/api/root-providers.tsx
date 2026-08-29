import type { ComponentType, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { Screen } from "../spine/screen";

/**
 * Providers an Uplink mounts at the ROOT of a screen's tree.
 *
 * <p><b>Why this exists.</b> An Uplink whose widgets share state needs that
 * state established above them, and until now the only way was for the app to
 * import the Uplink by name and hand-wire its Provider into each screen. That
 * made the app unable to BUILD without that Uplink present, which is the one
 * thing a third-party Uplink can never satisfy: an app that names its Uplinks
 * has no room for one it has never heard of.</p>
 *
 * <p><b>Why the app's own chrome-provider registry is not this.</b> That one
 * solves the opposite direction: re-wrapping a portalled subtree with a value
 * that is ALREADY ambient, so a widget's config modal keeps a context it has
 * escaped. It cannot establish the value in the first place, and it lives in a
 * package an Uplink may not import. The two are complements: this one mints
 * the value at the root, that one carries it across a portal.</p>
 *
 * <p><b>The screen is a parameter, not an assumption.</b> A registry keyed to
 * one screen would silently share state between the main screen and a station
 * on the same machine, which for anything persisted means one screen
 * overwriting the other's. The Provider receives the screen it is being
 * mounted for and is responsible for keying its own state by it.</p>
 */
export interface RootProviderDefinition {
  /** Stable id, auto-namespaced to the Uplink when registered through its handle. */
  id: string;
  /**
   * Mounted once per screen, wrapping everything below it.
   *
   * <p>It receives the screen id and MUST key any persisted state by it. It is
   * mounted unconditionally once its Uplink has loaded, so it has to be cheap
   * and side-effect-free when the Uplink's mod is absent: an Uplink is loaded
   * because it is installed, not because its mod answered.</p>
   */
  Provider: ComponentType<{ screen: Screen; children: ReactNode }>;
}

/**
 * The single global slot the providers live in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same state. An
 * Uplink's client bundle resolves this package through the app's import map, so
 * it should share this module instance, but "should" is not a thing to stake a
 * silently-missing context on. Same reasoning as `./fog-reveal.ts`.
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

export function registerRootProvider(def: RootProviderDefinition): void {
  registry().providers.set(def.id, def);
  publish();
}

/** Registration order, which is mount order outermost-first. */
export function getRootProviders(): RootProviderDefinition[] {
  return registry().snapshot;
}

/** Tests only: resets the registry so one file's registrations cannot leak. */
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
 * <p><b>It subscribes rather than reading once, and that is the whole point.</b>
 * An Uplink's client bundle is fetched at RUNTIME, so it registers after the
 * screen has already mounted. A component that read the registry once during
 * its first render would find it empty, mount no providers, and every widget
 * from every Uplink would then look for a context nobody established. The
 * failure is silent: no error, just a permanently missing value.</p>
 *
 * <p>The cost is one remount of the subtree when the set changes, because
 * adding a provider changes the element type at that position. That is
 * accepted: it happens as the Uplinks finish loading, which is the moment the
 * dashboard is coming up anyway, and the alternative is a value that never
 * arrives. Anything that must survive it belongs above this component.</p>
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
