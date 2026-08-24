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

import type { ReactElement, ReactNode } from "react";
import {
  createElement,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type ComposedPlan,
  outcomeOfReply,
  planSendArgs,
  SEND_PLAN_COMMAND,
  type SendPlanHandle,
  type SendPlanOutcome,
  sendRefusalFromError,
  whyNotSendable,
} from "../plan-composition";
import { draftAsPlan, type PlanDraft, PlanDraftStore } from "../plan-drafts";
import type { Reading } from "../reading";
import type { TopicId, TopicPayload } from "../topics";
import type { Value } from "../value";
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
  LateTelemetrySubscribe,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SettingDefinition,
  SettingDefinitionOf,
  SettingsTabDefinition,
  SettingType,
  SlotProps,
  TelemetryClient,
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
  AtmosphereModel,
  AugmentDefinition,
  AugmentSettingField,
  BadgeEntry,
  BodyDefinition,
  BodyMapConfig,
  BodyMask,
  ClientPrefSetting,
  ClientPrefSettingOf,
  CommandOutputToken,
  CommandStatus,
  ComponentBehavior,
  ComponentDefinition,
  ComponentProps,
  ComponentRequirement,
  ComponentSlotRegistry,
  ComponentSlotSegment,
  ConfigComponentProps,
  ConfigField,
  Contributed,
  ContributionDefinition,
  ContributionDep,
  ContributionEntry,
  ContributionRegistry,
  ContributionSlotId,
  ContributionTopics,
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
  MeterEntry,
  NamespacedAugmentSettings,
  PerfBudgetHandle,
  PerfBudgetOptions,
  PredictedPhase,
  Screen,
  SettingDefinition,
  SettingDefinitionBase,
  SettingDefinitionOf,
  SettingsTabDefinition,
  SettingType,
  SettingValue,
  SettingValueByType,
  SlotId,
  SlotProps,
  SlotRegistry,
  SourceBackedSetting,
  SourceBackedSettingOf,
  StreamBackedSetting,
  StreamBackedSettingOf,
  StreamStatusValue,
  TelemetryClient,
  ThemeDefinition,
  UplinkClientHandle,
  UplinkClientIdentity,
  UseCommandResult,
  UseMapPois,
  UseRouteCommandsResult,
  WidgetScope,
  WidgetScopeRegistry,
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

// What the frame in force does to a readout. A physics rule rather than a
// wording choice, so it lives once here instead of in each widget that quotes a
// length or an apsis, and it is on the author surface because a widget cannot
// qualify its own numbers without it.
export type { FrameValidity } from "../frame-qualifier";
export {
  apsidesExist,
  controlFrameLabel,
  frameCaveat,
  lengthsAreLengths,
} from "../frame-qualifier";
// Composing a flight plan at a command centre and transmitting it. The types an
// author states a plan in, plus `whyNotSendable` so a control greys itself out
// on the SAME answer the send refuses on rather than a second opinion about it.
export type {
  ComposedPlan,
  SendPlanHandle,
  SendPlanOutcome,
} from "../plan-composition";
export {
  SEND_PLAN_COMMAND,
  sendRefusalFromError,
  whyNotSendable,
} from "../plan-composition";
// The command centre's OWN plans, which the game never sees until one is sent.
// `draftAsPlan` is the seam between the two: it is what stops a widget building
// the send arguments by hand and getting the vantage stamp wrong privately.
export type { PlanDraft } from "../plan-drafts";
export { draftAsPlan, PlanDraftStore } from "../plan-drafts";

// --- Registration shims (stateful → injected host) --------------------------

// The component / data-source / theme registry is NOT a shim: it lives in this
// package (`./registry.ts`). It was the LAST place the shim story did not hold up,
// because registration was published and nothing else about the registry was: an
// Uplink could add a widget through `registerComponent` and then had no supported
// way to reset the registry between test cases (18 Uplink files call
// `clearRegistry`) or to read back what it had added.
//
// Only the author-and-test half is here. The ORCHESTRATION reads
// (`getResolvedComponents`, `getReplacementConflicts`, `getComponents`,
// `getThemes`, `getTheme`, `onDataSourcesChange`) are on the `/registry` subpath
// instead, for the same reason `/spine` keeps `TimelineStore` off this barrel:
// nothing about writing an Uplink needs the dashboard's widget-resolution rules,
// and publishing them here would freeze app orchestration as third-party API.
export {
  clearRegistry,
  getComponent,
  getDataSource,
  getDataSources,
  registerComponent,
  registerDataSource,
  registerTheme,
  unregisterDataSource,
} from "./registry";

/**
 * Every augment bound into `slot`, in render order. The read half of
 * {@link registerAugment}: an Uplink's test observes what it registered through
 * the same host it registered into, rather than reaching for ui-kit's copy.
 */
export const getAugmentsForSlot = (slot: string) =>
  getHost().getAugmentsForSlot(slot);
/** Empty the augment registry. For tests; a running app never calls it. */
export const clearAugments = (): void => {
  getHost().clearAugments();
};
export const registerAugment = <S extends string>(
  def: AugmentDefinition<S>,
): void => getHost().registerAugment(def);

// Registries that are NOT shims: they live in this package. None of them named
// anything above this leaf (provider definitions, opaque handles, one payload
// type), so the host indirection bought nothing and cost an Uplink the read half:
// it could register a POI provider, a handle or an action handler and then had no
// published way to fire or observe it. See `./map-poi.ts` for why their state sits
// in a `globalThis` slot rather than a module static.
//
// `dispatchAction` is the one an Uplink TEST reaches for most: it is how a widget's
// action is exercised with no serial device attached.
export {
  type ActionHandler,
  clearActionHandlers,
  dispatchAction,
  registerActionHandler,
  unregisterActionHandler,
} from "./action-dispatch";
// The body registry, likewise owned rather than shimmed. `getBody` WAS a shim, and
// its doc argued the case for this move without taking it: a bundled copy of a
// module-static map reads its own permanently-empty version. A `globalThis` slot
// closes that rather than routing around it, and `registerBody` /
// `registerStockBodies` become reachable for a planet pack at the same time.
export {
  clearBodies,
  getAllBodies,
  getBody,
  getImagingWindow,
  imagingQuality,
  registerBody,
} from "./bodies";
export {
  clearFogRevealSources,
  getFogRevealSourceSettings,
  getFogRevealSources,
  onFogRevealSourcesChange,
  registerFogRevealSource,
  unregisterFogRevealSource,
} from "./fog-reveal";
export {
  clearMapPoiProviders,
  getMapPoiProviders,
  onMapPoiProvidersChange,
  registerMapPoiProvider,
} from "./map-poi";
// The settings store, its service and its React CONTEXT, likewise owned. `gameHost`
// has to have one answer, which is why `setSetting` and `subscribeSetting` were
// shims already; the context is the part a second copy breaks in silence, because a
// provider from one copy is invisible to a consumer of the other. With one context
// in one published package there is no second copy, so `useSetting`'s shim retires
// too.
export {
  SettingsProvider,
  useSetting,
  useSettingsService,
} from "./settings/SettingsContext";
export { SettingsService } from "./settings/SettingsService";

import { getSetting as readSetting } from "./settings/store";

export {
  getSetting,
  resetSettingsForTests,
  seedSetting,
  setSetting,
  subscribeSetting,
} from "./settings/store";
export { registerStockBodies } from "./stock-bodies";
export {
  clearUplinkHandles,
  getUplinkHandle,
  registerUplinkHandle,
  unregisterUplinkHandle,
} from "./uplink-handles";

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
 * `DataSource`; a stream-backed one shows a value the mod publishes on a
 * Topic and cannot be written at all. Rows may be `boolean`, `text` or
 * `number`, `readOnly`, and filed into a named `group` inside their category.
 * See `SettingDefinition`.
 *
 * Generic so the row's `type` decides what `defaultValue`/`read`/`write`/
 * `select` are allowed to be: declare `type: "number"` and a `defaultValue` of
 * `true` is a compile error at the call site rather than a `Switch` rendering
 * a tolerance.
 */
export const registerSetting = <T extends SettingType = "boolean">(
  def: SettingDefinitionOf<T>,
): void =>
  // The cast collapses an unresolved T to the union the host takes. Every
  // instantiation of T IS a member of that union, but TypeScript will not
  // prove it while T is still a parameter.
  getHost().registerSetting(def as SettingDefinition);

/**
 * Whether a registered row is one the operator can change. The renderer's own
 * rule, exported so an Uplink asking the same question of its own definitions
 * gets the same answer: a `stream-backed` row and a `source-backed` row with
 * no `write` are read-only whether or not they said so.
 */
export { isReadOnlySetting, settingTypeOf } from "../spine/settings-registry";
export type { VantageTrajectory } from "../spine/use-vantage-trajectory";
// Asking where a craft goes from THIS command centre's point of view. On the
// author surface because an Uplink widget is exactly who asks: the question only
// has an answer relative to a vantage, and a widget is where a vantage is being
// looked at. The refusal mapper comes with it, so a caller can tell a message
// that never left from a craft this vantage cannot see.
export {
  refusalFromError,
  useVantageTrajectory,
  VANTAGE_TRAJECTORY_COMMAND,
} from "../spine/use-vantage-trajectory";

// --- Hook shims (stateful → injected host) ----------------------------------

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

/**
 * The frame's view instant. See `GonogoHost.useViewUt` for why an Uplink needs
 * it and why it answers `undefined` rather than guessing.
 */
export function useViewUt(): Value<"ut"> | undefined {
  return getHost().useViewUt();
}

export function useCommand(command: string) {
  return getHost().useCommand(command);
}

/**
 * Compose a flight plan at a command centre and transmit it to be instantiated
 * aboard.
 *
 * <p>Here rather than beside the raw command because getting the two instants
 * right is the whole difficulty, and every widget that hand-rolled it would get
 * to make the same mistake privately. This stamps when the operator decided, off
 * the view clock it already holds. The caller states how old the information it
 * decided on was, because only the caller knows which reading it planned
 * against.</p>
 *
 * <p>A plan built from a state later than the view it was composed at is
 * refused before it leaves. That is the delay model inverted, and catching it
 * here puts the complaint at the site that made the mistake rather than a
 * light-time away.</p>
 */
/**
 * The command centre's own plans for this screen, and a live view of them.
 *
 * <p>One store per screen rather than one per widget, so a plan composed in one
 * panel is the same object another panel can review or send. Drafts are
 * command-centre objects and the game never sees one until it is sent, which is
 * what lets two operators work on different plans for the same craft without
 * either disturbing the other or the player at the keyboard.</p>
 */
export function usePlanDrafts(): {
  store: PlanDraftStore;
  drafts: readonly PlanDraft[];
} {
  const store = useSyncExternalStore(
    PLAN_DRAFTS.subscribe.bind(PLAN_DRAFTS),
    () => PLAN_DRAFTS,
    () => PLAN_DRAFTS,
  );
  const drafts = useSyncExternalStore(
    PLAN_DRAFTS.subscribe.bind(PLAN_DRAFTS),
    () => PLAN_DRAFTS.list(),
    () => PLAN_DRAFTS.list(),
  );
  return { store, drafts };
}

/**
 * The screen's draft store.
 *
 * <p>Module scope, like the component registry beside it: a store held in a
 * provider would make a plan composed in one panel invisible to the next, and
 * the whole point of a command centre's drafts is that they are the command
 * centre's rather than one widget's.</p>
 */
const PLAN_DRAFTS = new PlanDraftStore();

export function useSendPlan(): SendPlanHandle {
  const command = useCommand(SEND_PLAN_COMMAND);
  const viewUt = useViewUt();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<SendPlanOutcome | null>(null);

  const send = useCallback(
    async (plan: ComposedPlan): Promise<SendPlanOutcome> => {
      const composedAtViewUt = viewUt?.magnitude;
      const refusal = whyNotSendable(plan, composedAtViewUt);
      if (refusal) {
        const refused: SendPlanOutcome = { accepted: false, refusal };
        setOutcome(refused);
        return refused;
      }

      setPending(true);
      try {
        const reply = await command.send(
          planSendArgs(plan, composedAtViewUt as number),
        );
        const next = outcomeOfReply(
          reply as { success?: boolean; detail?: string } | undefined,
        );
        setOutcome(next);
        return next;
      } catch (error) {
        const failed = sendRefusalFromError(error);
        setOutcome(failed);
        return failed;
      } finally {
        setPending(false);
      }
    },
    [command, viewUt],
  );

  return { send, pending, outcome };
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

// `useDataSchema` retired, 2026-08-19. It was a host member and a shim that no
// Uplink ever called: its readers are the app's own Data Sources panel and key
// picker. Keeping it would have been the one member that could not follow the
// others here, because the schema it returns for the default `"data"` source is
// built from a legacy vendor key catalogue, and moving that would have published a
// dying table as devkit API where its removal becomes an outside author's breaking
// change. `@ksp-gonogo/data` still exports it for the app.

/** Whether a recorded-flight replay session is currently active. */
export function useReplaySessionActive(): boolean {
  return getHost().useReplaySessionActive();
}

/**
 * The authoritative host every Uplink dials: `saved ?? build-default`, where the
 * build default is `VITE_SITREP_HOST` or `localhost`. Ports are per-service and NOT
 * part of this, callers append their own.
 *
 * Implemented here rather than forwarded to the host. It was a shim while the
 * implementation lived in `@ksp-gonogo/core`, and the only thing it needed was
 * `getSetting`, which this package has owned since the settings store moved. A host
 * member for a two-line read of a setting this package already holds is indirection
 * with nothing on the other end, so the member retires with the shim.
 */
export function getGameHost(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const buildDefault = env?.VITE_SITREP_HOST || "localhost";
  return readSetting(GAME_HOST_KEY) ?? buildDefault;
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

// The logger shim lives in `./logger`, not here: `perf/PerfBudget` needs it, and
// reaching it through this barrel made `perf/PerfBudget -> api/index ->
// api/settings/SettingsService -> perf/PerfBudget` a cycle. That cycle resolved
// only while api/index happened to load first; `SettingsService` constructs a
// budget at MODULE SCOPE, so anything importing `perf/PerfBudget` before this
// barrel got a half-initialised module and "PerfBudget is not a constructor".
// Same reason `safeRandomUuid` came out of the barrel.
export { logger } from "./logger";

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

// `ContributionsProvider` is NOT a shim here any more. It is
// `@ksp-gonogo/ui-kit`'s, directly: the aggregation moved there to sit beside the
// per-widget store it writes, and ui-kit is published, so an Uplink hosting its own
// slot imports it from the package that owns it. A shim would have made the name
// declared in two published packages, which
// `styleguide-shared-published-surface.test.ts` fails the build for, and it would
// have been indirection with one implementation on the other end.

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
 * Sort a caught `send()` rejection into refused / lost / failed. Published
 * because the alternative for an author is `instanceof` against a class in the
 * unpublished spine, or matching a code string they could only have read in our
 * source. The three names match the `CommandStatus` phases deliberately.
 */
export {
  type CommandRejection,
  classifyCommandRejection,
  commandRefusalSubject,
} from "./command-rejection";
// The fog-of-war mask store, its in-memory cache and the React context that
// carries them. Owned here for the same reason the settings context is: a second
// copy of a context is invisible to the other side's provider, and `useFogMaskCache`
// was a shim precisely so an Uplink's hook would read the app's. With one context in
// one published package there is no second copy, so that shim retires too.
export {
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
  FogMaskCache,
} from "./fog/FogMaskCache";
export {
  DEFAULT_PROFILE_ID,
  FogMaskCacheProvider,
  FogMaskStoreProvider,
  useBodyFogMask,
  useFogMaskCache,
  useFogMaskStore,
} from "./fog/FogMaskContext";
export {
  type FogMaskChangeListener,
  FogMaskStore,
  MASK_SCHEMA_VERSION,
  type StoredMask,
} from "./fog/FogMaskStore";
/**
 * A small typed wrapper around `localStorage`. Stateless (no module-global
 * registry): a byte-for-byte port of `@ksp-gonogo/data`'s implementation,
 * not a re-export. See `./localStorageStore.ts`'s module header for why.
 */
export { LocalStorageStore } from "./localStorageStore";
export { safeRandomUuid } from "./safe-random-uuid";
