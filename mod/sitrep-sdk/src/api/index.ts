// ---------------------------------------------------------------------------
// The curated author-facing barrel — PROPOSAL (design D-B/D-D).
//
// This is the one framework/data/hook surface a third-party Uplink author
// imports. It carries:
//   • the author-facing TYPES (self-contained here — see ./types on why the leaf
//     cannot re-export them from core), and
//   • fail-loud SHIMS for the stateful members (every registerX, the hooks),
//     which delegate to the app-injected host and throw a named error when it is
//     absent (design §4.3 / D-A). No stateful member imports core, so the packed
//     sdk never bundles a second registry — the whole point of the design.
//
// The EXPORT LIST below is what the operator reviews for D-D before the first
// external Uplink is published. It is NOT frozen. The api-shape gate
// (./api-shape.gate.test.ts) records it so any change is deliberate.
//
// First-party in-tree code is UNAFFECTED: it imports @ksp-gonogo/core /
// sitrep-client directly (same singletons), never these shims.
// ---------------------------------------------------------------------------

import type { Logger } from "@ksp-gonogo/logger";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { TopicId, TopicPayload } from "../topics";
import { getHost } from "./host";
// Side-effect only: carries the `SlotRegistry` declaration-merge for every
// first-party slot into any program that imports this barrel (facade-sealing
// plan §2.3, corrected 2026-07-19 — see ./slots.ts's own header for why the
// merge lives here rather than in packages/components). No named export
// added to the barrel by this import.
import "./slots";
import type {
  ActionDefinition,
  ActionHandlers,
  AugmentDefinition,
  BodyDefinition,
  ComponentDefinition,
  DataSource,
  FogRevealSourceDefinition,
  LateTelemetrySubscribe,
  MapPoiProviderDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SettingsTabDefinition,
  SlotProps,
  TelemetryClient,
  ThemeDefinition,
} from "./types";

// --- Author-facing types (re-exported real, erased at runtime) --------------

export type { Logger, TaggedLogger } from "@ksp-gonogo/logger";
export type { GonogoHost } from "./host";
export { GONOGO_HOST_KEY, hasHost } from "./host";
export type {
  ActionDefinition,
  ActionHandlers,
  ActionInputKind,
  ActionInputPayload,
  AugmentDefinition,
  AugmentSettingField,
  BodyDefinition,
  BodyMask,
  CommandStatus,
  ComponentBehavior,
  ComponentDefinition,
  ComponentProps,
  ComponentRequirement,
  ConfigComponentProps,
  ConfigField,
  DataKey,
  DataRequirement,
  DataSource,
  DataSourceStatus,
  DelayClockLike,
  FogRevealSourceDefinition,
  LateTelemetrySubscribe,
  MapPoi,
  MapPoiProviderDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  Screen,
  SettingsTabDefinition,
  SlotId,
  SlotProps,
  SlotRegistry,
  StreamStatusValue,
  TelemetryClient,
  ThemeDefinition,
  UseCommandResult,
} from "./types";

/**
 * The shared settings key for the host every Uplink dials (design:
 * `@ksp-gonogo/core`'s `settings/gameHost.ts`). A stable string literal, not a
 * value that ever changes at runtime — mirrored directly rather than imported
 * (the sdk leaf cannot depend on core; see `./types.ts`'s DataSource-SPI
 * comment for the full constraint) and kept honest by
 * `packages/core/src/sdk-facade.conformance.test-d.ts`.
 */
export const GAME_HOST_KEY = "gameHost" as const;

// --- Registration shims (stateful → injected host) --------------------------

export const registerComponent = <TConfig = Record<string, unknown>>(
  def: ComponentDefinition<TConfig>,
): void => getHost().registerComponent(def);

export const registerTheme = (def: ThemeDefinition): void =>
  getHost().registerTheme(def);

export const registerAugment = <S extends string>(
  def: AugmentDefinition<S>,
): void => getHost().registerAugment(def);

export const registerFogRevealSource = (def: FogRevealSourceDefinition): void =>
  getHost().registerFogRevealSource(def);

export const registerMapPoiProvider = (def: MapPoiProviderDefinition): void =>
  getHost().registerMapPoiProvider(def);

/**
 * Author a data source into the app's single registry. Re-added 2026-07-19
 * (facade-sealing plan §2.1) — this SPI was removed 2026-07-18 on the
 * premise that first-party code always imports core's registerDataSource
 * directly; that stopped holding once a facade-sealed kos is exactly the
 * client the premise assumed away. See `./types.ts`'s DataSource-SPI
 * comment for the full history.
 */
export const registerDataSource = <
  TConfig extends Record<string, unknown> = Record<string, unknown>,
>(
  source: DataSource<TConfig>,
): void => getHost().registerDataSource(source);

export const registerUplinkHandle = <T>(uplinkId: string, handle: T): void =>
  getHost().registerUplinkHandle(uplinkId, handle);

export const registerSettingsTab = (def: SettingsTabDefinition): void =>
  getHost().registerSettingsTab(def);

// --- Hook shims (stateful → injected host) ----------------------------------

export function useDataValue<T = unknown>(
  dataSourceId: string,
  key: string,
): T | undefined {
  return getHost().useDataValue<T>(dataSourceId, key);
}

export function useExecuteAction(
  dataSourceId: string,
): (action: string) => Promise<void> {
  return getHost().useExecuteAction(dataSourceId);
}

export function useTelemetry<T extends TopicId>(
  topic: T,
): TopicPayload<T> | undefined {
  return getHost().useTelemetry(topic);
}

export function useCommand(command: string) {
  return getHost().useCommand(command);
}

export function useStream<T>(topic: string): T | undefined {
  return getHost().useStream<T>(topic);
}

export function useViewClock(): unknown {
  return getHost().useViewClock();
}

export function useActionInput<TActions extends readonly ActionDefinition[]>(
  handlers: ActionHandlers<TActions>,
): void {
  getHost().useActionInput(handlers);
}

export function useDataSources(): unknown {
  return getHost().useDataSources();
}

// --- Stream SPI shims (stateful → injected host) -----------------------------

/**
 * Real-time (non-delayed) read of `topic`, bypassing the certainty-gated
 * `TimelineStore` frame `useStream` samples through — for command-centre
 * bookkeeping topics (dispatch timestamps, link facts), never delayed craft
 * telemetry. See `GonogoHost.useLatestValue`'s doc for the raw-vs-derived
 * distinction.
 */
export function useLatestValue<T = unknown>(topic: string): T | undefined {
  return getHost().useLatestValue<T>(topic);
}

/**
 * Fires `handler` once per discrete event delivered on a `ReliableOrdered`
 * channel topic — the event-consumption counterpart to `useStream`'s
 * sticky-latest-value read.
 */
export function useStreamEvent<T = unknown>(
  topic: string,
  handler: (payload: T) => void,
): void {
  getHost().useStreamEvent(topic, handler);
}

/**
 * Returns a stable, imperative subscribe function for topics only known
 * after some async setup resolves, in a count decided at runtime. See
 * `LateTelemetrySubscribe`'s own doc for the full contract.
 */
export function useLateTelemetrySubscribe(): LateTelemetrySubscribe {
  return getHost().useLateTelemetrySubscribe();
}

/** The current view time (UT seconds), reactive per-frame. */
export function useUtNow(): number | undefined {
  return getHost().useUtNow();
}

/**
 * The nearest `TelemetryProvider`'s `TimelineStore`, or `undefined` with none
 * mounted. Opaque (`unknown`) — same reasoning as `useViewClock` — narrow/cast
 * at the call site if the concrete shape is needed.
 */
export function useTelemetryStoreOptional(): unknown {
  return getHost().useTelemetryStoreOptional();
}

/** Non-throwing variant of `useViewClock` — `undefined` with no provider mounted. */
export function useViewClockOptional(): unknown {
  return getHost().useViewClockOptional();
}

/**
 * The most recently mounted `TelemetryProvider`'s `TelemetryClient`, or
 * `undefined` when none is mounted — for imperative use outside a hook
 * context (e.g. a `DataSource`'s own connect/dispatch bookkeeping).
 */
export function getActiveTelemetryClient(): TelemetryClient | undefined {
  return getHost().getActiveTelemetryClient();
}

/**
 * Non-throwing hook variant of reading the nearest `TelemetryProvider`'s
 * `TelemetryClient` — `undefined` with no provider mounted.
 */
export function useTelemetryClientOptional(): TelemetryClient | undefined {
  return getHost().useTelemetryClientOptional();
}

// --- Data introspection shims (stateful → injected host) ---------------------

/** The enriched schema (key + label/unit/group) for a data source's keys. */
export function useDataSchema(sourceId?: string): unknown[] {
  return getHost().useDataSchema(sourceId);
}

/** Whether a recorded-flight replay session is currently active. */
export function useReplaySessionActive(): boolean {
  return getHost().useReplaySessionActive();
}

// --- Game-host SPI shims (stateful → injected host) --------------------------

/** The authoritative host every Uplink dials (`saved ?? seed ?? build-default`). */
export function getGameHost(): string {
  return getHost().getGameHost();
}

/** Subscribe to any change (saved OR seeded) for one shared settings key. */
export function subscribeSetting(key: string, cb: () => void): () => void {
  return getHost().subscribeSetting(key, cb);
}

// --- DataSource + registry accessor shims (stateful → injected host) --------

/**
 * Reach a data source already registered in the app's single registry — for
 * an Uplink that AUTHORS its own `DataSource` to make imperative calls on its
 * own instance. See `GonogoHost.getDataSource`'s doc: this is for reaching
 * your own registered source, not a bypass of `useDataValue`/`useExecuteAction`
 * for ordinary consumer reads.
 */
export function getDataSource(id: string): DataSource | undefined {
  return getHost().getDataSource(id);
}

/**
 * The static body table (`@ksp-gonogo/core`'s `bodies.ts`). Resolves to the
 * app's own registry, not a bundled copy — see `GonogoHost.getBody`'s doc.
 */
export function getBody(id: string): BodyDefinition | undefined {
  return getHost().getBody(id);
}

/** Every registered fog-of-war reveal source, in registration order. */
export function getFogRevealSources(): FogRevealSourceDefinition[] {
  return getHost().getFogRevealSources();
}

/** Subscribe to any change (register/unregister) in the fog reveal source registry. */
export function onFogRevealSourcesChange(cb: () => void): () => void {
  return getHost().onFogRevealSourcesChange(cb);
}

/** The current fog mask cache, or `null` with no `FogMaskCacheProvider` mounted. */
export function useFogMaskCache() {
  return getHost().useFogMaskCache();
}

/** Look up a previously registered Uplink handle by id. `undefined` if none. */
export function getUplinkHandle<T = unknown>(uplinkId: string): T | undefined {
  return getHost().getUplinkHandle<T>(uplinkId);
}

// --- Logger shim (stateful → injected host) ---------------------------------

/**
 * The app's single logger instance (design: `@ksp-gonogo/logger`'s `logger`
 * export is a stateful singleton — its ring buffer, session id, and
 * transports are installed on the app's instance at boot. A bundled second
 * copy would be a dead logger, console-only, never reaching Axiom or the
 * shared `exportLogs()` buffer). A `Proxy` delegates every access — including
 * `.tag(...)` — to `getHost().logger`, so the returned `TaggedLogger` is the
 * injected instance's own, and every method fails loud via `getHost()` when
 * no host is installed.
 *
 * Methods are bound to the real logger instance before being returned, not
 * just read off it: `getHost().logger.setEnabled` (etc.) returns the
 * function unbound, so an unbound call would run with `this` = the proxy's
 * dead `{}` target. Reads happen to forward through the get trap (`this.x`
 * on the real object is itself a proxied get), but there is no `set` trap —
 * an unbound method that *assigns* to `this` (`setEnabled`, `setLevel`,
 * `setIdentity`) would silently write to the dead target and never reach
 * the real logger. Binding closes that hole and would keep working even if
 * the logger ever adopts ES `#private` fields, which a bare Proxy can't
 * forward at all.
 */
export const logger: Logger = new Proxy({} as Logger, {
  get: (_target, prop) => {
    const real = getHost().logger as object;
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

// --- Component + class shims ------------------------------------------------

/**
 * The slot composition point a base widget drops in for augments to fill.
 * Resolves to the host's real `AugmentSlot` so it reads the app's single augment
 * registry; `createElement` (not a direct call) keeps React's hook rules intact.
 *
 * Generic over the slot id `S` (2026-07-19, facade-sealing gap 2) — matches
 * `@ksp-gonogo/core`'s real `AugmentSlot<S extends string>` signature so a
 * SLOT-OWNING sealed client (one that renders its own `<AugmentSlot>`, not
 * just fills someone else's) gets `props` typed precisely against
 * `SlotProps<S>` rather than the loose `Record<string, unknown>` the
 * previous non-generic signature forced. `getHost().AugmentSlot` itself
 * stays non-generic (the `GonogoHost` interface member) — the cast below is
 * the same "structurally fine at runtime, precise at the call site" shape
 * `registerAugment`'s own generic shim already relies on.
 */
export function AugmentSlot<S extends string>(props: {
  name: S;
  props: SlotProps<S>;
}): ReactElement {
  return createElement(
    getHost().AugmentSlot,
    props as unknown as { name: string; props?: Record<string, unknown> },
  );
}

/**
 * Construct a performance budget on the app's single registry (design: every
 * new data source MUST register one). A factory, not a re-exported class, so the
 * budget self-registers into the host's registry rather than a bundled copy.
 */
export function createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle {
  return getHost().createPerfBudget(opts);
}

// --- Trivial utils (stateless, self-contained) -------------------------------

/**
 * A small typed wrapper around `localStorage`. Stateless (no module-global
 * registry) — a byte-for-byte port of `@ksp-gonogo/data`'s implementation,
 * not a re-export. See `./localStorageStore.ts`'s module header for why.
 */
export { LocalStorageStore } from "./localStorageStore";

/**
 * Like `crypto.randomUUID()` but works on insecure-context pages — most
 * notably the LAN-IP dev URL station devices use to reach the dev box, where
 * the Web Crypto spec's secure-context gate makes `randomUUID` hard-throw.
 * Falls back to `crypto.getRandomValues` (available regardless of context)
 * and assembles a v4 UUID from the 16 random bytes per RFC 4122.
 *
 * A byte-for-byte copy of `@ksp-gonogo/core`'s implementation
 * (`safeRandomUuid.ts`), not a re-export: it is a pure function with no
 * state and no dependency beyond the `crypto` global, so duplicating it here
 * carries none of the "second copy of a registry" risk that rules out
 * bundling core's stateful members — see the module header — and the sdk
 * leaf cannot name core as a workspace dependency regardless (would form a
 * turbo `^build` cycle, same constraint as the mirrored types in `./types.ts`).
 */
export function safeRandomUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
