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
import type { Value } from "../value";
import type {
  ActionDefinition,
  ActionHandlers,
  AnyContribution,
  AugmentDefinition,
  LateTelemetrySubscribe,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SettingDefinition,
  SettingsTabDefinition,
  TelemetryClient,
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
  registerAugment<S extends string>(def: AugmentDefinition<S>): void;

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
   * needed by Uplinks reading a legacy flat key (e.g.
   * `useTelemetry<number>("data", "comm.signalStrength")`) that has no
   * canonical Topic yet.
   */
  useTelemetry<T = unknown>(dataSourceId: string, key: string): T | undefined;
  /**
   * The frame's VIEW instant: the moment the screen is showing, which is not
   * necessarily now.
   *
   * Here because an Uplink cannot render a countdown without it. Every absolute
   * instant on the wire (`ut`) has to be turned into a duration (`s`) before it
   * can be shown as one, and `<Countdown>`'s own doc comment instructs an author
   * to subtract the view time to do it. Until this was on the facade that
   * instruction named a hook the published packages did not expose, so the
   * documented operation was one a third-party author could not perform.
   *
   * `undefined` when no clock is mounted, rather than falling back to a
   * wall-clock instant: a mission time guessed from the browser would be a
   * confident wrong answer on every screen that is delayed, paused or scrubbed,
   * which is most of them.
   */
  useViewUt(): Value<"ut"> | undefined;
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
  /** Whether a recorded-flight replay session is currently active. */
  useReplaySessionActive(): boolean;

  /** The authoritative host every Uplink dials (`saved ?? seed ?? build-default`). */
  /**
   * Retired members: `getGameHost` and `useDataSchema`.
   *
   * `getGameHost` is implemented in `api/index.ts` now: it reads one setting this
   * package already owns. `useDataSchema` was called by no Uplink, and its default
   * source's schema comes from a legacy vendor key catalogue that must not become
   * published API.
   */

  AugmentSlot: ComponentType<{ name: string; props?: Record<string, unknown> }>;
  /**
   * Retired member: `ContributionsProvider`. The aggregation lives in
   * `@ksp-gonogo/ui-kit` beside the per-widget store it writes into, and ui-kit is
   * published, so there is exactly one implementation and nothing for the host to
   * inject. It was here while the aggregation was in `@ksp-gonogo/core` and an
   * Uplink could not reach it.
   */
  createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle;

  /**
   * The app's single logger instance (ring buffer, session id, Axiom
   * transport installed at boot). Never bundle @ksp-gonogo/logger's
   * `logger` export directly: a second copy is console-only and never
   * reaches the shared buffer or Axiom.
   */
  logger: Logger;

  /**
   * Every augment bound into `slot`, ascending `priority`, ties in registration
   * order: the READ half of `registerAugment`.
   *
   * Here for the same reason `registerAugment` is, and it is not a convenience. An
   * Uplink's test has to be able to observe what its `registerAugment` call did,
   * and the only other route was `@ksp-gonogo/ui-kit`'s own
   * `getAugmentsForSlot`. That happens to work today because the shim resolves
   * through this host into `core`, whose augment registry IS ui-kit's, but it is
   * an undocumented convergence rather than a contract, and it breaks the moment
   * anything gets its own copy. Reading and writing through the same host is what
   * makes "an Uplink reaches the registry through the sdk" true for both halves.
   */
  getAugmentsForSlot(slot: string): AugmentDefinition<string>[];
  /** Empty the augment registry. For tests; a running app never calls it. */
  clearAugments(): void;
  /** Every contribution registered for a slot, in priority then registration order. */
  getContributionsForSlot(slot: string): AnyContribution[];
  /** Subscribe to any change (register/unregister) in the contribution registry. */
  onContributionsChange(cb: () => void): () => void;
  /** Empty the contribution registry. For tests; a running app never calls it. */
  clearContributions(): void;

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
        "This package's stateful surface (the hooks, registerAugment, …) is " +
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
