// ---------------------------------------------------------------------------
// The injected-host lookup (design §4.3, decision D-A: fail-loud shim).
//
// The stateful author-facing surface — every `registerX`, every hook — cannot
// be a bundled re-export of `@ksp-gonogo/core`: N copies of core's module-global
// registries and React contexts fail SILENTLY (a widget registers into a Map the
// app never reads). Instead the published sitrep-sdk exposes SHIMS that resolve
// to the app's single instance at runtime, looked up on `globalThis`.
//
// The app installs the real implementation once at boot
// (`globalThis.__GONOGO_SDK__ = <facade>`) — that wiring is the loader task and
// is deliberately NOT built here. Until it exists, calling a stateful shim throws
// a NAMED error instead of failing silently: the project's single scariest
// failure mode (a dead registry) becomes a thrown error with the fix in its
// message. Tests inject a host via `@ksp-gonogo/sitrep-sdk/testing`.
// ---------------------------------------------------------------------------

import type { Logger } from "@ksp-gonogo/logger";
import type { ComponentType } from "react";
import type { TopicId, TopicPayload } from "../topics";
import type {
  ActionDefinition,
  ActionHandlers,
  AugmentDefinition,
  BodyDefinition,
  ComponentDefinition,
  DataSource,
  FogMaskCacheHandle,
  FogRevealSourceDefinition,
  MapPoiProviderDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SettingsTabDefinition,
  TelemetryClient,
  ThemeDefinition,
  UseCommandResult,
} from "./types";

/**
 * The surface the gonogo app injects at boot. Every member here is stateful —
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
  /**
   * Author a data source into the app's single registry (design D-A-1 /
   * 2026-07-19 facade-sealing reversal — see `./types.ts`'s DataSource-SPI
   * comment for the removal-then-reversal history).
   */
  registerDataSource<
    TConfig extends Record<string, unknown> = Record<string, unknown>,
  >(source: DataSource<TConfig>): void;

  useDataValue<T = unknown>(dataSourceId: string, key: string): T | undefined;
  useExecuteAction(dataSourceId: string): (action: string) => Promise<void>;
  useTelemetry<T extends TopicId>(topic: T): TopicPayload<T> | undefined;
  useCommand(command: string): UseCommandResult;
  useStream<T>(topic: string): T | undefined;
  useViewClock(): unknown;
  useActionInput<TActions extends readonly ActionDefinition[]>(
    handlers: ActionHandlers<TActions>,
  ): void;
  useDataSources(): unknown;

  /**
   * Real-time (non-delayed) read of `topic` straight off the `TelemetryClient`
   * — bypasses the certainty-gated `TimelineStore` frame `useStream` samples
   * through. For command-centre bookkeeping (dispatch timestamps, link facts),
   * never delayed craft telemetry — see `useLatestValue`'s own doc in
   * `@ksp-gonogo/sitrep-client` for the raw-vs-derived distinction.
   */
  useLatestValue<T = unknown>(topic: string): T | undefined;
  /**
   * Fires `handler` once per discrete event delivered on a `ReliableOrdered`
   * channel topic (e.g. a crash alarm) — the consumption side of an event
   * lane, as opposed to `useStream`'s sticky-latest-value read.
   */
  useStreamEvent<T = unknown>(
    topic: string,
    handler: (payload: T) => void,
  ): void;
  /** The current view time (UT seconds), reactive per-frame. */
  useUtNow(): number | undefined;
  /**
   * The nearest `TelemetryProvider`'s `TimelineStore`, or `undefined` with
   * none mounted. Opaque here (same reasoning as `useViewClock`'s `unknown`
   * return): `TimelineStore` is a large, evolving class owned by
   * `@ksp-gonogo/sitrep-client`, which the sdk leaf cannot depend on to name
   * its full shape — see `./types.ts`'s DataSource-SPI comment for the same
   * constraint applied to a small, mirrorable type. An author needing the
   * concrete type narrows/casts at the call site, same as `useViewClock`
   * callers already do today.
   */
  useTelemetryStoreOptional(): unknown;
  /** Non-throwing variant of `useViewClock` — `undefined` with no provider mounted. Opaque for the same reason as `useViewClock`. */
  useViewClockOptional(): unknown;

  /** The enriched schema (key + label/unit/group) for a data source's keys. */
  useDataSchema(sourceId?: string): unknown[];
  /** Whether a recorded-flight replay session is currently active. */
  useReplaySessionActive(): boolean;

  /** The authoritative host every Uplink dials (`saved ?? seed ?? build-default`). */
  getGameHost(): string;
  /** Subscribe to any change (saved OR seeded) for one shared settings key. */
  subscribeSetting(key: string, cb: () => void): () => void;

  AugmentSlot: ComponentType<{ name: string; props?: Record<string, unknown> }>;
  createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle;

  /**
   * The app's single logger instance (ring buffer, session id, Axiom
   * transport installed at boot). Never bundle @ksp-gonogo/logger's
   * `logger` export directly — a second copy is console-only and never
   * reaches the shared buffer or Axiom.
   */
  logger: Logger;

  /**
   * Reach a data source already registered in the app's single registry —
   * for an Uplink that AUTHORS its own `DataSource` to make imperative
   * calls on the instance it registered itself. The "hooks are the
   * boundary" rule (`useDataValue`/`useExecuteAction`) still holds for a
   * CONSUMER widget; this accessor is for the author reaching the source it
   * registered itself, not a bypass for ordinary data reads.
   */
  getDataSource(id: string): DataSource | undefined;

  /**
   * The static body table (`@ksp-gonogo/core`'s `bodies.ts`). Despite
   * looking like a static lookup, this MUST resolve to the app's own
   * registry rather than a bundled copy — bodies are registered into it at
   * runtime (module load), so a facade-sealed client bundling its own
   * `getBody` would read its own, permanently-empty copy of the map.
   */
  getBody(id: string): BodyDefinition | undefined;
  /** Every registered fog-of-war reveal source, in registration order. */
  getFogRevealSources(): FogRevealSourceDefinition[];
  /** Subscribe to any change (register/unregister) in the fog reveal source registry. */
  onFogRevealSourcesChange(cb: () => void): () => void;
  /** The current fog mask cache, or `null` with no `FogMaskCacheProvider` mounted. */
  useFogMaskCache(): FogMaskCacheHandle | null;

  /**
   * Register a singleton handle for an Uplink, keyed by its id — the shared
   * substrate for anything that needs to register a singleton object and
   * have it looked up elsewhere without coupling the lookup site to the
   * Uplink's own module (e.g. a relay-capable object, a WebRTC client).
   */
  registerUplinkHandle<T>(uplinkId: string, handle: T): void;
  /** Look up a previously registered handle by Uplink id. `undefined` if none. */
  getUplinkHandle<T = unknown>(uplinkId: string): T | undefined;

  /** Register (or replace) a full custom Settings-modal tab. */
  registerSettingsTab(def: SettingsTabDefinition): void;

  /**
   * The most recently mounted `TelemetryProvider`'s `TelemetryClient`, or
   * `undefined` when none is mounted — for imperative use outside a hook
   * context (e.g. a `DataSource`'s own connect/dispatch bookkeeping).
   */
  getActiveTelemetryClient(): TelemetryClient | undefined;
  /**
   * Non-throwing hook variant of reading the nearest `TelemetryProvider`'s
   * `TelemetryClient` — `undefined` with no provider mounted.
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
        "runtime-injected by the app — mark @ksp-gonogo/sitrep-sdk `external` in " +
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
 * boot) and tests' job (via the `/testing` subpath) — this is the shared plumbing
 * both use. Not part of the author-facing barrel.
 */
export function __setGonogoHost(host: GonogoHost | undefined): void {
  (globalThis as unknown as HostGlobal)[GONOGO_HOST_KEY] = host;
}
