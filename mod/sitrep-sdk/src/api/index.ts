// ---------------------------------------------------------------------------
// The curated author-facing barrel: PROPOSAL (design D-B/D-D).
//
// This is the one framework/data/hook surface a third-party Uplink author
// imports. It carries:
//   • the author-facing TYPES (self-contained here: see ./types on why the leaf
//     cannot re-export them from core), and
//   • fail-loud SHIMS for the stateful members (every registerX, the hooks),
//     which delegate to the app-injected host and throw a named error when it is
//     absent (design §4.3 / D-A). No stateful member imports core, so the packed
//     sdk never bundles a second registry: the whole point of the design.
//
// The EXPORT LIST below is what the operator reviews for D-D before the first
// external Uplink is published. It is NOT frozen. The api-shape gate
// (./api-shape.gate.test.ts) records it so any change is deliberate.
//
// EVERY Uplink goes through this barrel, including the ones bundled with the
// mod. There is no first-party path: bundling changes how an Uplink ships, not
// what it may import, and an Uplink that reaches for core or sitrep-client
// directly stops modelling what an outside author can actually build. An
// earlier revision of this header exempted in-tree code, and that exemption is
// what taught docs/creating-an-uplink.md to tell authors to depend on core.
// ---------------------------------------------------------------------------

import type { Logger } from "@ksp-gonogo/logger";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import type { Reading } from "../reading";
import type { TopicId, TopicPayload } from "../topics";
import { getHost } from "./host";
// Side-effect only: carries the `SlotRegistry` declaration-merge for every
// first-party slot into any program that imports this barrel (facade-sealing
// plan §2.3, corrected 2026-07-19: see ./slots.ts's own header for why the
// merge lives here rather than in packages/components). No named export
// added to the barrel by this import.
import "./slots";
// Side-effect only: carries the `ContributionRegistry` declaration-merge
// scaffold (Phase 1 of the contributions primitive; see ./contribution-
// slots.ts's own header). Same reasoning as the `./slots` import above, one
// merge target per declaration-merge seam.
import "./contribution-slots";
import type {
  ActionDefinition,
  ActionHandlers,
  AnyContribution,
  AugmentDefinition,
  BodyDefinition,
  ComponentDefinition,
  FogRevealSourceDefinition,
  LateTelemetrySubscribe,
  MapPoiProviderDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SettingDefinition,
  SettingsTabDefinition,
  SlotProps,
  TelemetryClient,
  ThemeDefinition,
  UplinkClientHandle,
  UseRouteCommandsResult,
} from "./types";

// --- Author-facing types (re-exported real, erased at runtime) --------------

export type { Logger, TaggedLogger } from "@ksp-gonogo/logger";
export type { GonogoHost } from "./host";
export { GONOGO_HOST_KEY, hasHost } from "./host";
// The message-pipe contract. Defined entirely in terms of this package's own
// wire messages, so it belongs here rather than in `sitrep-client`, and living
// here is what lets the transport double ship from `/testing`.
export type { Transport, TransportStatus } from "./transport";
export type {
  ActionDefinition,
  ActionHandlers,
  ActionInputKind,
  ActionInputPayload,
  AnyContribution,
  AugmentDefinition,
  AugmentSettingField,
  BodyDefinition,
  BodyMask,
  ClientPrefSetting,
  CommandOutputToken,
  CommandStatus,
  ComponentBehavior,
  ComponentDefinition,
  ComponentProps,
  ComponentRequirement,
  ConfigComponentProps,
  ConfigField,
  ContributionDefinition,
  ContributionDep,
  ContributionEntry,
  ContributionRegistry,
  DataKey,
  DataRequirement,
  DataSource,
  DataSourceStatus,
  DelayClockLike,
  DelayMode,
  FogRevealSourceDefinition,
  InFlightCommand,
  LateTelemetrySubscribe,
  MapPoi,
  MapPoiAction,
  MapPoiProviderContext,
  MapPoiProviderDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  PredictedPhase,
  Screen,
  SettingDefinition,
  SettingDefinitionBase,
  SettingsTabDefinition,
  SettingType,
  SlotId,
  SlotProps,
  SlotRegistry,
  SourceBackedSetting,
  StreamStatusValue,
  TelemetryClient,
  ThemeDefinition,
  UplinkClientHandle,
  UseCommandResult,
  UseMapPois,
  UseRouteCommandsResult,
} from "./types";

/**
 * The shared settings key for the host every Uplink dials (design:
 * `@ksp-gonogo/core`'s `settings/gameHost.ts`). A stable string literal, not a
 * value that ever changes at runtime, mirrored directly rather than imported
 * (the sdk leaf cannot depend on core; see `./types.ts`'s DataSource
 * type-mirror comment for the full constraint) and kept honest by
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

export const registerUplinkHandle = <T>(uplinkId: string, handle: T): void =>
  getHost().registerUplinkHandle(uplinkId, handle);

/**
 * Declare an Uplink client's identity (Uplink Client Contract design §3.1).
 * One call per client bundle; stamp the returned handle as `owner` on every
 * `registerComponent`/`registerAugment` call the client makes, or call the
 * returned handle's own `registerContribution` for the contributions path.
 */
export const defineUplinkClient = (cfg: {
  id: string;
  version: string;
  name: string;
}): UplinkClientHandle => getHost().defineUplinkClient(cfg);

export const registerSettingsTab = (def: SettingsTabDefinition): void =>
  getHost().registerSettingsTab(def);

/**
 * Declare a setting the app renders in its Settings surface, the PREFERRED
 * path over a custom tab (`registerSettingsTab`). A client-pref setting
 * persists to localStorage; a source-backed one binds to the Uplink's own
 * `DataSource`. See `SettingDefinition`.
 */
export const registerSetting = (def: SettingDefinition): void =>
  getHost().registerSetting(def);

// --- Hook shims (stateful → injected host) ----------------------------------

export function useExecuteAction(
  dataSourceId: string,
): (action: string) => Promise<void> {
  return getHost().useExecuteAction(dataSourceId);
}

/**
 * Canonical overload: keyed by TopicId, answers with a `Reading` of the Topic's
 * payload.
 *
 * This used to declare `TopicPayload<T> | undefined` while forwarding to the host's
 * implementation, which returns a `Reading`. Every Uplink client therefore
 * typechecked clean and broke at runtime, and the lie was invisible to `tsc` in both
 * directions: the clients compiled, and a sweep of the clients reported zero errors.
 * It surfaced as "experiments is not iterable" deep inside a parser typed
 * `(raw: unknown)`, in the one bundled Uplink whose imports go only through this
 * surface.
 *
 * An Uplink drawing a radiation dose has to confront currency for the same reasons a
 * built-in widget does, so the honest signature is the one that makes it.
 */
export function useTelemetry<T extends TopicId>(
  topic: T,
): Reading<TopicPayload<T>>;
// Legacy two-arg overload: the retired useDataValue shim's shape, carried
// over onto useTelemetry itself. See GonogoHost.useTelemetry's doc.
export function useTelemetry<T = unknown>(
  dataSourceId: string,
  key: string,
): T | undefined;
export function useTelemetry(dataSourceIdOrTopic: string, key?: string) {
  // A single, unconditional call: branching here on `key` would call
  // `getHost().useTelemetry` conditionally, which the rules-of-hooks lint
  // (rightly) flags as unsafe even though a given call site's arity never
  // changes across renders. The injected host's real implementation
  // (`@ksp-gonogo/core`'s `useTelemetry`) already branches internally on
  // whether `key` is present while keeping every hook call unconditional,
  // this just forwards both args through to that single call, same as the
  // core implementation's own `(dataSourceId, key?)` signature.
  const hostUseTelemetry = getHost().useTelemetry as (
    dataSourceIdOrTopic: string,
    key?: string,
  ) => unknown;
  return hostUseTelemetry(dataSourceIdOrTopic, key);
}

export function useCommand(command: string) {
  return getHost().useCommand(command);
}

/**
 * Cross-origin route reader: every currently-pending command addressed to
 * `topic`, regardless of which command centre dispatched it, the
 * companion to `useCommand`'s own-dispatch `inFlight`. See
 * `@ksp-gonogo/sitrep-client`'s `useRouteCommands` for the full contract.
 */
export function useRouteCommands(topic: string): UseRouteCommandsResult {
  return getHost().useRouteCommands(topic);
}

export function useStream<T>(topic: string): T | undefined {
  return getHost().useStream<T>(topic);
}

/**
 * Reactively read a Processor's current, frame-memoised value. Pass the handle
 * `defineUplinkClient(...).registerProcessor` returned: `R` is inferred from
 * its brand, so `useProcessor(SHIP_SYSTEMS)` is typed as the processor's own
 * result. One evaluation per Sitrep frame is shared across every widget reading
 * the same handle (and any contribution that lists it in `deps`). Returns
 * `undefined` with no provider mounted, or before the first frame lands.
 */
export function useProcessor<R>(handle: {
  readonly id: string;
  readonly __resultType?: R;
}): R | undefined {
  return getHost().useProcessor(handle);
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

/**
 * Reactive read of a client-pref setting by key, `[value, setValue]`, the
 * value persisted through the app's `SettingsService`. Use it to gate on a
 * declared kill-switch etc. Source-backed settings are not read here.
 */
export function useSetting<T>(
  key: string,
  defaultValue: T,
): [T, (v: T) => void] {
  return getHost().useSetting<T>(key, defaultValue);
}

// --- Stream SPI shims (stateful → injected host) -----------------------------

/**
 * Real-time (non-delayed) read of `topic`, bypassing the certainty-gated
 * `TimelineStore` frame `useStream` samples through: for command-centre
 * bookkeeping topics (dispatch timestamps, link facts), never delayed craft
 * telemetry. See `GonogoHost.useLatestValue`'s doc for the raw-vs-derived
 * distinction.
 */
export function useLatestValue<T = unknown>(topic: string): T | undefined {
  return getHost().useLatestValue<T>(topic);
}

/**
 * Fires `handler` once per discrete event delivered on a `ReliableOrdered`
 * channel topic: the event-consumption counterpart to `useStream`'s
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
 * mounted. Opaque (`unknown`), same reasoning as `useViewClock`, narrow/cast
 * at the call site if the concrete shape is needed.
 */
export function useTelemetryStoreOptional(): unknown {
  return getHost().useTelemetryStoreOptional();
}

/** Non-throwing variant of `useViewClock`: `undefined` with no provider mounted. */
export function useViewClockOptional(): unknown {
  return getHost().useViewClockOptional();
}

/**
 * The most recently mounted `TelemetryProvider`'s `TelemetryClient`, or
 * `undefined` when none is mounted, for imperative use outside a hook
 * context (e.g. a `DataSource`'s own connect/dispatch bookkeeping).
 */
export function getActiveTelemetryClient(): TelemetryClient | undefined {
  return getHost().getActiveTelemetryClient();
}

/**
 * Non-throwing hook variant of reading the nearest `TelemetryProvider`'s
 * `TelemetryClient`: `undefined` with no provider mounted.
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

/**
 * Persist a user-chosen value for one settings key. The write half of the
 * trio an Uplink already had: `registerSetting` declares one, `useSetting`
 * and `subscribeSetting` read it, and until now nothing could set it, so an
 * Uplink offering its own control over its own setting had no way to save
 * what the operator chose.
 */
export function setSetting(key: string, value: string): void {
  getHost().setSetting(key, value);
}

// --- Registry accessor shims (stateful → injected host) ---------------------

/**
 * The static body table (`@ksp-gonogo/core`'s `bodies.ts`). Resolves to the
 * app's own registry, not a bundled copy; see `GonogoHost.getBody`'s doc.
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

// The read half of the POI provider registry, so an Uplink can HOST a mapping
// surface and not only contribute points to someone else's. Its fog-reveal
// sibling above has carried both halves from the start; POI providers shipped
// with only `registerMapPoiProvider`, which is the asymmetry these close.

/** Every registered map POI provider, in registration order. */
export function getMapPoiProviders(): MapPoiProviderDefinition[] {
  return getHost().getMapPoiProviders();
}

/** Subscribe to any change (register/unregister) in the POI provider registry. */
export function onMapPoiProvidersChange(cb: () => void): () => void {
  return getHost().onMapPoiProvidersChange(cb);
}

/** Empty the POI provider registry. For tests; a running app never calls it. */
export function clearMapPoiProviders(): void {
  getHost().clearMapPoiProviders();
}

// The read half of the contribution registry. The WRITE half stays on
// `defineUplinkClient`'s handle rather than appearing here: the handle stamps
// `${clientId}:` onto every id, and a bare `registerContribution` on this
// barrel would be a way to opt out of the namespacing that stops two Uplinks
// colliding.

/** Every contribution registered for a slot, in priority then registration order. */
export function getContributionsForSlot(slot: string): AnyContribution[] {
  return getHost().getContributionsForSlot(slot);
}

/** Subscribe to any change (register/unregister) in the contribution registry. */
export function onContributionsChange(cb: () => void): () => void {
  return getHost().onContributionsChange(cb);
}

/** Empty the contribution registry. For tests; a running app never calls it. */
export function clearContributions(): void {
  getHost().clearContributions();
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
 * export is a stateful singleton, its ring buffer, session id, and
 * transports are installed on the app's instance at boot. A bundled second
 * copy would be a dead logger, console-only, never reaching Axiom or the
 * shared `exportLogs()` buffer). A `Proxy` delegates every access, including
 * `.tag(...)`: to `getHost().logger`, so the returned `TaggedLogger` is the
 * injected instance's own, and every method fails loud via `getHost()` when
 * no host is installed.
 *
 * Methods are bound to the real logger instance before being returned, not
 * just read off it: `getHost().logger.setEnabled` (etc.) returns the
 * function unbound, so an unbound call would run with `this` = the proxy's
 * dead `{}` target. Reads happen to forward through the get trap (`this.x`
 * on the real object is itself a proxied get), but there is no `set` trap,
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
 * Generic over the slot id `S` (2026-07-19, facade-sealing gap 2), matches
 * `@ksp-gonogo/core`'s real `AugmentSlot<S extends string>` signature so a
 * SLOT-OWNING sealed client (one that renders its own `<AugmentSlot>`, not
 * just fills someone else's) gets `props` typed precisely against
 * `SlotProps<S>` rather than the loose `Record<string, unknown>` the
 * previous non-generic signature forced. `getHost().AugmentSlot` itself
 * stays non-generic (the `GonogoHost` interface member): the cast below is
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
 * The aggregation host for contribution slots. A widget reading contributions
 * (`useContributions` from `@ksp-gonogo/ui-kit`) sees an empty list unless one
 * of these is mounted above it, so an Uplink that HOSTS a slot needs it, not
 * just the app. Resolves to the host's own provider, so contributions land in
 * the app's single registry rather than a bundled copy.
 */
export function ContributionsProvider(props: {
  children?: ReactNode;
}): ReactElement {
  return createElement(getHost().ContributionsProvider, props);
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
 * registry): a byte-for-byte port of `@ksp-gonogo/data`'s implementation,
 * not a re-export. See `./localStorageStore.ts`'s module header for why.
 */
export { LocalStorageStore } from "./localStorageStore";

/**
 * Like `crypto.randomUUID()` but works on insecure-context pages, most
 * notably the LAN-IP dev URL station devices use to reach the dev box, where
 * the Web Crypto spec's secure-context gate makes `randomUUID` hard-throw.
 * Falls back to `crypto.getRandomValues` (available regardless of context)
 * and assembles a v4 UUID from the 16 random bytes per RFC 4122.
 *
 * A byte-for-byte copy of `@ksp-gonogo/core`'s implementation
 * (`safeRandomUuid.ts`), not a re-export: it is a pure function with no
 * state and no dependency beyond the `crypto` global, so duplicating it here
 * carries none of the "second copy of a registry" risk that rules out
 * bundling core's stateful members (see the module header) and the sdk
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
