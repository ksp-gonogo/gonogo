// ---------------------------------------------------------------------------
// The injected-host lookup (design §4.3, decision D-A: fail-loud shim).
//
// The stateful author-facing surface (every `registerX`, every hook) cannot
// be a bundled re-export of `@ksp-gonogo/core`: N copies of core's module-global
// registries and React contexts fail SILENTLY (a widget registers into a Map the
// app never reads). Instead the published sitrep-sdk exposes SHIMS that resolve
// to the app's single instance at runtime, looked up on `globalThis`.
//
// The app installs the real implementation once at boot
// (`globalThis.__GONOGO_SDK__ = <facade>`), that wiring is the loader task and
// is deliberately NOT built here. Until it exists, calling a stateful shim throws
// a NAMED error instead of failing silently: the project's single scariest
// failure mode (a dead registry) becomes a thrown error with the fix in its
// message. Tests inject a host via `@ksp-gonogo/sitrep-sdk/testing`.
// ---------------------------------------------------------------------------

import type { Logger } from "@ksp-gonogo/logger";
import type { ComponentType, ReactNode } from "react";
import type { TopicId, TopicPayload } from "../topics";
import type {
  ActionDefinition,
  ActionHandlers,
  AnyContribution,
  AugmentDefinition,
  BodyDefinition,
  ComponentDefinition,
  FogMaskCacheHandle,
  FogRevealSourceDefinition,
  LateTelemetrySubscribe,
  MapPoiProviderDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SettingDefinition,
  SettingsTabDefinition,
  TelemetryClient,
  ThemeDefinition,
  UplinkClientHandle,
  UseCommandResult,
  UseRouteCommandsResult,
} from "./types";

/**
 * The surface the gonogo app injects at boot. Every member here is stateful,
 * it must resolve to the app's single registry / context instance, never a
 * bundled copy. Stateless helpers (wire types, `parseServerMessage`, `TOPIC_IDS`)
 * are NOT here: they are real, published bytes re-exported directly from the sdk.
 */
export interface GonogoHost {
  registerComponent<TConfig = Record<string, unknown>>(
    def: ComponentDefinition<TConfig>,
  ): void;
  registerTheme(def: ThemeDefinition): void;
  registerAugment<S extends string>(def: AugmentDefinition<S>): void;
  registerFogRevealSource(def: FogRevealSourceDefinition): void;
  registerMapPoiProvider(def: MapPoiProviderDefinition): void;

  useExecuteAction(dataSourceId: string): (action: string) => Promise<void>;
  /**
   * Canonical Topic overload: reads a Topic's payload straight off the
   * mounted TimelineStore (`@ksp-gonogo/core`'s `useTelemetry`, one-arg form).
   */
  useTelemetry<T extends TopicId>(topic: T): TopicPayload<T> | undefined;
  /**
   * Legacy two-arg overload: the retired `useDataValue` shim's shape,
   * carried over onto `useTelemetry` itself (real `useTelemetry` in
   * `@ksp-gonogo/core` has always answered both call shapes off the one
   * function; `useDataValue` was only ever a name for this same call). Still
   * needed by Uplinks reading a legacy `DataSourceRegistry` key (e.g.
   * `useTelemetry<number>("data", "comm.signalStrength")`) that has no
   * canonical Topic yet.
   */
  useTelemetry<T = unknown>(dataSourceId: string, key: string): T | undefined;
  useCommand(command: string): UseCommandResult;
  /**
   * Cross-origin route reader: every currently-pending command addressed to
   * `topic`, regardless of which command centre dispatched it, the
   * companion to `useCommand`'s own-dispatch `inFlight`. Queue-only, no
   * memory of its own: see `@ksp-gonogo/sitrep-client`'s
   * `useRouteCommands` for the full contract.
   */
  useRouteCommands(topic: string): UseRouteCommandsResult;
  useStream<T>(topic: string): T | undefined;
  /**
   * Reactively read a Processor's current, frame-memoised value (mirrors
   * `@ksp-gonogo/sitrep-client`'s `useProcessor`, the augment-side consumption
   * form of the same evaluation a contribution's `deps` pulls). The handle is
   * the branded shape `defineUplinkClient(...).registerProcessor` returns,
   * named structurally here because the sdk leaf cannot depend on
   * sitrep-client's `ProcessorHandle` (same constraint as
   * `useTelemetryStoreOptional`'s opaque return). Degrades to `undefined` with
   * no provider mounted, or before the processor's first frame lands.
   */
  useProcessor<R>(handle: {
    readonly id: string;
    readonly __resultType?: R;
  }): R | undefined;
  useViewClock(): unknown;
  useActionInput<TActions extends readonly ActionDefinition[]>(
    handlers: ActionHandlers<TActions>,
  ): void;
  useDataSources(): unknown;

  /**
   * Real-time (non-delayed) read of `topic` straight off the `TelemetryClient`,
   * bypasses the certainty-gated `TimelineStore` frame `useStream` samples
   * through. For command-centre bookkeeping (dispatch timestamps, link facts),
   * never delayed craft telemetry: see `useLatestValue`'s own doc in
   * `@ksp-gonogo/sitrep-client` for the raw-vs-derived distinction.
   */
  useLatestValue<T = unknown>(topic: string): T | undefined;
  /**
   * Fires `handler` once per discrete event delivered on a `ReliableOrdered`
   * channel topic (e.g. a crash alarm): the consumption side of an event
   * lane, as opposed to `useStream`'s sticky-latest-value read.
   */
  useStreamEvent<T = unknown>(
    topic: string,
    handler: (payload: T) => void,
  ): void;
  /**
   * Returns a stable, imperative subscribe function for topics that are only
   * known after some async setup resolves, in a count decided at runtime,
   * the case `useTelemetry`/`useStream`'s declarative "name every topic on
   * every render" shape can't express. See `LateTelemetrySubscribe`'s own
   * doc for the full contract.
   */
  useLateTelemetrySubscribe(): LateTelemetrySubscribe;
  /** The current view time (UT seconds), reactive per-frame. */
  useUtNow(): number | undefined;
  /**
   * The nearest `TelemetryProvider`'s `TimelineStore`, or `undefined` with
   * none mounted. Opaque here (same reasoning as `useViewClock`'s `unknown`
   * return): `TimelineStore` is a large, evolving class owned by
   * `@ksp-gonogo/sitrep-client`, which the sdk leaf cannot depend on to name
   * its full shape: see `./types.ts`'s DataSource type-mirror comment for the same
   * constraint applied to a small, mirrorable type. An author needing the
   * concrete type narrows/casts at the call site, same as `useViewClock`
   * callers already do today.
   */
  useTelemetryStoreOptional(): unknown;
  /** Non-throwing variant of `useViewClock`: `undefined` with no provider mounted. Opaque for the same reason as `useViewClock`. */
  useViewClockOptional(): unknown;

  /** The enriched schema (key + label/unit/group) for a data source's keys. */
  useDataSchema(sourceId?: string): unknown[];
  /** Whether a recorded-flight replay session is currently active. */
  useReplaySessionActive(): boolean;

  /** The authoritative host every Uplink dials (`saved ?? seed ?? build-default`). */
  getGameHost(): string;
  /** Subscribe to any change (saved OR seeded) for one shared settings key. */
  subscribeSetting(key: string, cb: () => void): () => void;
  /** Persist a user-chosen value for one settings key (the "saved" layer). */
  setSetting(key: string, value: string): void;

  AugmentSlot: ComponentType<{ name: string; props?: Record<string, unknown> }>;
  /**
   * The aggregation host for contribution slots: mounts the per-widget store
   * and runs every registered contribution's `compute`. A widget that READS
   * contributions (`useContributions`) sees nothing without one mounted above
   * it, which is why an Uplink hosting its own slot needs it and not just the
   * app.
   */
  ContributionsProvider: ComponentType<{ children?: ReactNode }>;
  createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle;

  /**
   * The app's single logger instance (ring buffer, session id, Axiom
   * transport installed at boot). Never bundle @ksp-gonogo/logger's
   * `logger` export directly: a second copy is console-only and never
   * reaches the shared buffer or Axiom.
   */
  logger: Logger;

  /**
   * The static body table (`@ksp-gonogo/core`'s `bodies.ts`). Despite
   * looking like a static lookup, this MUST resolve to the app's own
   * registry rather than a bundled copy: bodies are registered into it at
   * runtime (module load), so a facade-sealed client bundling its own
   * `getBody` would read its own, permanently-empty copy of the map.
   */
  getBody(id: string): BodyDefinition | undefined;
  /** Every registered fog-of-war reveal source, in registration order. */
  getFogRevealSources(): FogRevealSourceDefinition[];
  /** Subscribe to any change (register/unregister) in the fog reveal source registry. */
  onFogRevealSourcesChange(cb: () => void): () => void;
  /** Every registered map POI provider, in registration order. */
  getMapPoiProviders(): MapPoiProviderDefinition[];
  /** Subscribe to any change (register/unregister) in the POI provider registry. */
  onMapPoiProvidersChange(cb: () => void): () => void;
  /** Empty the POI provider registry. For tests; a running app never calls it. */
  clearMapPoiProviders(): void;
  /** Every contribution registered for a slot, in priority then registration order. */
  getContributionsForSlot(slot: string): AnyContribution[];
  /** Subscribe to any change (register/unregister) in the contribution registry. */
  onContributionsChange(cb: () => void): () => void;
  /** Empty the contribution registry. For tests; a running app never calls it. */
  clearContributions(): void;
  /** The current fog mask cache, or `null` with no `FogMaskCacheProvider` mounted. */
  useFogMaskCache(): FogMaskCacheHandle | null;

  /**
   * Register a singleton handle for an Uplink, keyed by its id, the shared
   * substrate for anything that needs to register a singleton object and
   * have it looked up elsewhere without coupling the lookup site to the
   * Uplink's own module (e.g. a relay-capable object, a WebRTC client).
   */
  registerUplinkHandle<T>(uplinkId: string, handle: T): void;
  /** Look up a previously registered handle by Uplink id. `undefined` if none. */
  getUplinkHandle<T = unknown>(uplinkId: string): T | undefined;

  /**
   * Declare an Uplink client's identity (Uplink Client Contract design
   * §3.1) and record it in the app's client registry, the membership half
   * (which clients are actually present in this build). Returns a frozen
   * handle carrying a bound `registerContribution`; the client stamps the
   * handle itself as `owner` on every `registerComponent`/`registerAugment`
   * call it makes. `cfg` is the plain identity triple only, the returned
   * handle's `registerContribution` isn't (and can't be) supplied by the
   * caller.
   */
  defineUplinkClient(cfg: {
    id: string;
    version: string;
    name: string;
  }): UplinkClientHandle;

  /** Register (or replace) a full custom Settings-modal tab. */
  registerSettingsTab(def: SettingsTabDefinition): void;

  /**
   * Register (or replace) a declarative setting the app renders in its Settings
   * surface: the PREFERRED path over a custom tab. A client-pref setting
   * persists to localStorage; a source-backed one reads/writes the Uplink's
   * own `DataSource` (see `SettingDefinition`).
   */
  registerSetting(def: SettingDefinition): void;
  /**
   * Reactive read of a client-pref setting by key, `[value, setValue]`, the
   * value persisted via the app's `SettingsService`. This is the hook a
   * consumer uses to gate on a kill-switch etc. Source-backed settings are not
   * read through here (their value lives on a `DataSource`); the Settings UI
   * renders those with a dedicated source-bound row.
   */
  useSetting<T>(key: string, defaultValue: T): [T, (v: T) => void];

  /**
   * The most recently mounted `TelemetryProvider`'s `TelemetryClient`, or
   * `undefined` when none is mounted, for imperative use outside a hook
   * context (e.g. a `DataSource`'s own connect/dispatch bookkeeping).
   */
  getActiveTelemetryClient(): TelemetryClient | undefined;
  /**
   * Non-throwing hook variant of reading the nearest `TelemetryProvider`'s
   * `TelemetryClient`: `undefined` with no provider mounted.
   */
  useTelemetryClientOptional(): TelemetryClient | undefined;
}

/** The single global slot the app populates at boot. */
export const GONOGO_HOST_KEY = "__GONOGO_SDK__" as const;

interface HostGlobal {
  [GONOGO_HOST_KEY]?: GonogoHost;
}

/**
 * Resolve the injected host, or throw a named, actionable error. The message
 * names the package and states the fix (mark the specifier `external`) so a
 * mis-bundled Uplink fails loud at first registration rather than vanishing.
 */
export function getHost(): GonogoHost {
  const host = (globalThis as unknown as HostGlobal)[GONOGO_HOST_KEY];
  if (!host) {
    throw new Error(
      "@ksp-gonogo/sitrep-sdk: the gonogo host has not been installed. " +
        "This package's stateful surface (registerComponent, the hooks, …) is " +
        "runtime-injected by the app: mark @ksp-gonogo/sitrep-sdk `external` in " +
        "your bundle so it resolves to the host, and do not bundle a second copy. " +
        "In tests, install a host with @ksp-gonogo/sitrep-sdk/testing.",
    );
  }
  return host;
}

/** True when a host is installed. Lets a shim probe without throwing. */
export function hasHost(): boolean {
  return Boolean((globalThis as unknown as HostGlobal)[GONOGO_HOST_KEY]);
}

/**
 * Internal: install / clear the host. Public installation is the app's job (at
 * boot) and tests' job (via the `/testing` subpath), this is the shared plumbing
 * both use. Not part of the author-facing barrel.
 */
export function __setGonogoHost(host: GonogoHost | undefined): void {
  (globalThis as unknown as HostGlobal)[GONOGO_HOST_KEY] = host;
}
