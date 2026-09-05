// The curated author-facing barrel: the one framework, data and hook surface a
// third-party Uplink author imports. It carries the author-facing TYPES
// (declared here rather than re-exported, see ./types for why this leaf cannot
// reach the app's) and fail-loud SHIMS for the stateful members, every
// `registerX` and every hook, which delegate to the app-injected host and throw
// a named error naming the fix when no host is installed. No stateful member
// reaches the app, so a packed Uplink never carries a second registry, which is
// the whole point.
//
// The export list is not frozen. `./api-shape.gate.test.ts` records it, so any
// change to it is a deliberate one.
//
// EVERY Uplink goes through this barrel, including the ones bundled with the
// mod. There is no first-party path: bundling changes how an Uplink ships, not
// what it may import, and an Uplink that reaches past this barrel stops
// modelling what an outside author can actually build. An earlier revision of
// this header exempted in-tree code, and that exemption is what taught
// docs/creating-an-uplink.md to tell authors to import a private package.

import type { ReactElement } from "react";
import {
  createElement,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AnyCommandReply,
  CommandArgs,
  CommandId,
  CommandReply,
} from "../commands";
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
import { type PlanDraft, PlanDraftStore } from "../plan-drafts";
import type { Reading, ReckonableReading } from "../reading";
import type { ReckonableFields, ReckonableTopic } from "../reckonability";
import type { TopicId, TopicPayload } from "../topics";
import type { Value } from "../value";
import { getHost } from "./host";
// Side-effect only: carries the `SlotRegistry` declaration-merge for every
// first-party slot into any program that imports this barrel. See ./slots.ts's
// own header for why the merge lives here rather than beside the widgets. No
// named export added to the barrel by this import.
import "./slots";
// Side-effect only: carries the `ContributionRegistry` declaration-merge
// scaffold (Phase 1 of the contributions primitive; see ./contribution-
// slots.ts's own header). Same reasoning as the `./slots` import above, one
// merge target per declaration-merge seam.
import "./contribution-slots";
// Side-effect only: carries the `ContributionRegistry` declaration-merge for
// the `plots` slot. Same reasoning as the two imports above, one merge target
// per declaration-merge seam. `./plot-layers` needs no such import: it is
// `PlotEntry`'s contents rather than a slot of its own, so it merges nothing.
import "./plots";
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
  UseCommandOptions,
  UseCommandResult,
  UseRouteCommandsResult,
} from "./types";

// --- Author-facing types (re-exported real, erased at runtime) --------------

export type { GonogoHost } from "./host";
export { GONOGO_HOST_KEY, hasHost } from "./host";
export type { LogContext, Logger, TaggedLogger } from "./logger-contract";
// The plot-layer vocabulary. Its own module rather than a line in `./types`,
// because the union is the whole surface a contributor writes against and it
// carries the reasoning for the data-space and tone-not-colour rules.
export type {
  PlotAnnotationLayer,
  PlotCaptionLayer,
  PlotEmphasis,
  PlotFieldLayer,
  PlotLayer,
  PlotMarkerLayer,
  PlotPoint,
  PlotRegionLayer,
  PlotReliefLayer,
  PlotRuleLayer,
  PlotSeriesLayer,
  PlotTone,
} from "./plot-layers";
// The `plots` contribution slot's own types: the frame a plot pins and the
// entry it contributes. Its own module for the reason `./plot-layers` is one.
export type {
  PlotEntry,
  PlotFrame,
  PlotSubject,
  PlotSubjectRegistry,
} from "./plots";
// The message-pipe contract. Defined entirely in terms of this package's own
// wire messages, so it belongs here rather than in `sitrep-client`, and living
// here is what lets the transport double ship from `/testing`.
export type {
  Transport,
  TransportStatus,
  UndeliveredCommand,
} from "./transport";
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
  CoverageSourceDefinition,
  DataKey,
  DataRequirement,
  DataSource,
  DataSourceStatus,
  DelayClockLike,
  DelayMode,
  DepTopics,
  HostIceServers,
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
  Seat,
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
  StatEntry,
  StreamBackedSetting,
  StreamBackedSettingOf,
  StreamStatusValue,
  TelemetryClient,
  ThemeDefinition,
  UplinkClientHandle,
  UplinkClientIdentity,
  UplinkRelay,
  UseCommandOptions,
  UseCommandResult,
  UseCommandResultFor,
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

// A burn's clock. Five calendar fields rather than one seconds box, because a
// burn is scheduled against a date and nudged against a minute, and the
// countdown runs to IGNITION rather than to the node: counting to the node puts
// ignition half a burn in the past by the time it reaches zero.
export type { BurnInstantParts } from "../burn-clock";
export {
  composeUt,
  decomposeUt,
  isBurning,
  timeToIgnition,
} from "../burn-clock";
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

/*
 * These three, and `AugmentSlot` below, are also exported from
 * `@ksp-gonogo/ui-kit`, and there the declaration is the registry itself rather
 * than a shim onto the host. Both spellings now reach ONE registry: ui-kit
 * holds it in a global slot precisely so that a second loaded copy of that
 * package cannot fork it, which is what a mis-bundled Uplink used to do
 * silently. The pair is worth knowing about anyway, because the two differ with
 * no host installed: these throw a named error naming the fix, ui-kit's carry
 * on.
 */

/**
 * Every augment bound into `slot`, in render order. The read half of
 * {@link registerAugment}: an Uplink's test observes what it registered through
 * the same host it registered into.
 */
export const getAugmentsForSlot = (slot: string) =>
  getHost().getAugmentsForSlot(slot);
/** Empty the augment registry. For tests; a running app never calls it. */
export const clearAugments = (): void => {
  getHost().clearAugments();
};
/**
 * Bind a component into another widget's named slot. Call at module load,
 * exactly like `registerComponent`. Several augments may target one slot and
 * all of them render, ordered by `priority`, none of them aware of the others.
 *
 * `component` is typed against the slot's own props through the declaration-
 * merging seam, so `S` is checked here, at the only place it can be.
 */
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
  clearCoverageSources,
  getCoverageSourceSettings,
  getCoverageSources,
  onCoverageSourcesChange,
  registerCoverageSource,
  unregisterCoverageSource,
} from "./coverage-source";
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
 * Declare an Uplink client's identity.
 * One call per client bundle; stamp the returned handle as `owner` on every
 * `registerComponent`/`registerAugment` call the client makes, or call the
 * returned handle's own `registerContribution` for the contributions path.
 */
export const defineUplinkClient = (cfg: {
  id: string;
  version: string;
  name: string;
  /** What the Uplink does, in one or two sentences. See `UplinkClientHandle`. */
  description?: string;
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
export function registerSetting<T extends SettingType = "boolean">(
  def: SettingDefinitionOf<T>,
): void;
/**
 * Register an ALREADY-TYPED definition, for a client that built its rows as a
 * list and registers them in a loop.
 *
 * The spine's own `registerSetting` has carried this overload since the
 * registry grew past one type; the author-facing facade did not, so a client
 * with enough rows to want a list could declare them and then not register
 * them. Mixed rows collapse to `SettingDefinition` the moment they share an
 * array, and `write`'s parameter is contravariant, so the generic form rejects
 * exactly the shape a list has.
 */
export function registerSetting(def: SettingDefinition): void;
export function registerSetting(def: SettingDefinition): void {
  // The cast collapses an unresolved T to the union the host takes. Every
  // instantiation of T IS a member of that union, but TypeScript will not
  // prove it while T is still a parameter.
  getHost().registerSetting(def as SettingDefinition);
}

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
 * The declared return MUST stay a `Reading`, because that is what the host's
 * implementation this forwards to returns. Declaring `TopicPayload<T> |
 * undefined` here instead is a lie `tsc` cannot see in either direction: every
 * Uplink client typechecks clean, a sweep of the clients reports zero errors,
 * and the break arrives at runtime as "experiments is not iterable" deep inside
 * a parser typed `(raw: unknown)`.
 *
 * An Uplink drawing a radiation dose has to confront currency for the same reasons a
 * built-in widget does, so the honest signature is the one that makes it.
 *
 * A topic the CONTRACT declares reckonable answers with `ReckonableReading`
 * instead, whose `reckoned` is only the fields a declared model moves. Both
 * declarations of this hook carry that arm, and they have to: an Uplink reading
 * `vessel.flight` through this facade and a built-in widget reading it through
 * the spine are reading the same store, and a facade that flattened the
 * projection back to the whole payload would hand an author a `situation` off a
 * modelled value.
 */
export function useTelemetry<T extends TopicId>(
  topic: T,
): T extends ReckonableTopic
  ? ReckonableReading<
      TopicPayload<T>,
      ReckonableFields<T> & keyof TopicPayload<T>
    >
  : Reading<TopicPayload<T>>;
/**
 * Legacy two-arg overload, reading ONE field rather than a Topic's payload:
 * `dataSourceId` names a registered non-Sitrep source (`"kos"`, `"camera"`) or
 * `"data"` for the stream itself, and `key` is a field path the contract
 * declares under a Topic, e.g.
 * `useTelemetry<number>("data", "vessel.control.throttle")`.
 *
 * A bare Topic id resolves to nothing here: the resolution needs at least one
 * field segment after the Topic, so `useTelemetry("data", "comms.signalStrength")`
 * reads `undefined` for ever rather than erroring. Read a whole Topic through
 * the one-arg form above, which answers with a {@link Reading} and is what a
 * new widget should use.
 */
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

/**
 * Canonical overload: keyed by `CommandId`, answers a handle whose `send` takes
 * that command's arguments and resolves that command's reply.
 *
 *   const setSas = useCommand("vessel.control.setSas");
 *   const result = await setSas.send({ enabled: true });
 *   // result: CommandResult
 *
 * `send` RESOLVES only when the command ran. The game refusing is a REJECTION,
 * carrying a `CommandErrorCode` a caller can switch on, so a resolved reply is
 * never a polite no. A dispatch the mod never answered rejects too, once the
 * loss deadline passes; a `void`ed `send` is safe, the hook marks its own
 * rejection handled and surfaces refusals on `refusals` instead.
 *
 *   try {
 *     await setThrottle.send({ value: 1.2 });
 *   } catch (err) {
 *     // CommandErrorCode.Range: validated at admission, never clamped
 *   }
 *
 * Every command is DELAYED unless it is sim-meta, so a dispatch is not an event
 * that has happened, it is one that is travelling. The handle carries the whole
 * delay surface for that (`inFlight`, `effectiveDelaySeconds`, `gate`,
 * `refusals`), and `<CommandDelay handle={cmd}>` renders it; in development the
 * hook throws on a dispatch made without one, so a delayed command cannot ship
 * with no delay UX.
 *
 * The full command vocabulary is `COMMAND_IDS`, generated from the mod's own
 * `[SitrepCommand]` declarations.
 */
export function useCommand<C extends CommandId>(
  command: C,
  options?: UseCommandOptions,
): UseCommandResult<CommandArgs<C>, CommandReply<C>>;
/**
 * Escape-hatch overload, for a command id this SDK's map does not carry: an
 * Uplink's own before its client package has augmented `CommandArgsMap`, or a
 * DYNAMIC command whose id is computed per subject and so can have no static
 * member. Args stay `unknown` unless the caller names them; the reply falls back
 * to `AnyCommandReply`, the result envelope every command answers with, so even
 * a command nobody could name is not readable as though it were its own payload.
 *
 *   const reset = useCommand<{ id: string }>(`my-uplink.probe.${probeId}.reset`);
 *
 * An Uplink declaring its OWN commands should not live here. Augment
 * `CommandArgsMap`/`CommandReplyMap` from the client package and call
 * `registerUplinkCommand`, and the first overload covers them like any other.
 */
export function useCommand<TArgs = unknown, TReply = AnyCommandReply>(
  command: string,
  options?: UseCommandOptions,
): UseCommandResult<TArgs, TReply>;
export function useCommand(
  command: string,
  options?: UseCommandOptions,
): UseCommandResult {
  return getHost().useCommand(command, options);
}

/**
 * Call one of an Uplink's own methods from a widget, on either screen.
 *
 * A Topic carries what the game is doing and a command changes it; this is
 * neither. It is for the calls an Uplink's client makes to its own host-side
 * object: a WebRTC offer to answer, an inventory to fetch, anything whose shape
 * only that Uplink knows. Register the object with `registerUplinkHandle`, then
 * call it from anywhere with this.
 *
 * The hook is the screen boundary. On the main screen the call reaches the
 * handle directly. On a station it is relayed through the main screen, which is
 * the only thing a station ever talks to, and the Uplink's code is identical
 * either way.
 *
 *   const relay = useUplinkRelay("my-uplink");
 *   const cameras = await relay("listCameras", { vesselId });
 *
 * The returned function is stable for as long as the route is, so it is safe in
 * a dependency array. It rejects, rather than hanging, when no route exists.
 */
export function useUplinkRelay(uplinkId: string) {
  return getHost().useUplinkRelay(uplinkId);
}

/**
 * The ICE servers the main screen is handing out, for an Uplink opening a media
 * connection from a station.
 *
 * A station has no route to the relay that issues TURN credentials, so the main
 * screen broadcasts them and this is where they are read. Empty on the main
 * screen itself, which reaches the relay directly.
 *
 *   const ice = useHostIceServers();
 *   const pc = new RTCPeerConnection({ iceServers: ice.current() });
 *   useEffect(() => ice.onChange((servers) => reconfigure(pc, servers)), [ice, pc]);
 *
 * Credentials rotate, so a long-lived connection has to watch `onChange` rather
 * than read `current()` once.
 */
export function useHostIceServers() {
  return getHost().useHostIceServers();
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

/**
 * Discards every draft on this screen.
 *
 * <p>Test-facing, and the sibling of `clearAugments` beside it: the store is
 * module scope by design, which means it OUTLIVES a rendered tree, so without
 * this a plan composed in one case is still there in the next and the two are
 * asserting against each other's drafts. Call it after unmounting rather than
 * before: clearing while a tree is still mounted notifies its subscribers
 * outside `act`.</p>
 */
export const clearPlanDrafts = (): void => {
  for (const draft of PLAN_DRAFTS.list()) {
    PLAN_DRAFTS.remove(draft.id);
  }
};

/**
 * Transmit a composed manoeuvre plan, and track the one send in flight.
 *
 * Wraps {@link SEND_PLAN_COMMAND} with the checks a plan needs that an ordinary
 * command does not: {@link whyNotSendable} runs against the current view time
 * FIRST, so a plan whose burn has already passed resolves as a refusal without
 * a message leaving, and the returned {@link SendPlanOutcome} distinguishes
 * that from the game rejecting a plan it did receive. `send` never throws; a
 * transport failure arrives as a refusal too.
 *
 * The handle's `command` is exposed so the caller can pass it to ui-kit's
 * `usePanelDelay`. That is not optional: like any other command this one
 * refuses to commit until a delay schedule is contributed, so a widget that
 * skips it gets a throw on the first press rather than a control with no delay
 * UX.
 */
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

  return { send, pending, outcome, command };
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

/**
 * Reactively read the latest payload on `topic`, raw wire Topic or client-side
 * derived channel alike, sampled at the current view instant. `undefined` with
 * no stream mounted, before the first sample, and for a topic nothing publishes.
 *
 * `topic` is a `string` rather than a {@link TopicId} because the ids this
 * resolves are a superset of the generated union in two directions: a derived
 * channel (`"vessel.state"`, `"system.uplinkHealth"`) is computed in the
 * browser and has no `[SitrepTopic]` type for codegen to reflect, and a
 * third-party Uplink's own topics are declared at runtime and appear in no
 * union at all. {@link WidgetChannelId} is the closed union of the two
 * first-party halves, and is the type to annotate a first-party read with.
 *
 * Unlike {@link useTelemetry} this collapses every kind of absence into
 * `undefined`: pending, unowned, absent and stale are indistinguishable, and
 * `T` is whatever the caller supplies with nothing checking it was right. Reach
 * for it when the topic has no {@link TopicId} entry (a derived channel, or your
 * own Uplink's), and for a wire Topic prefer `useTelemetry`, whose
 * {@link Reading} carries the currency an operator needs.
 */
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

/**
 * The shared view clock the whole dashboard renders against, for a widget that
 * needs the clock OBJECT rather than a reactive time: to schedule against a
 * frame tick, or to read the confirmed edge separately from a scrub target.
 * THROWS when no stream is mounted, so a widget that renders on a disconnected
 * dashboard wants {@link useViewClockOptional} instead, and one that just needs
 * the current time wants {@link useViewUt}, which is reactive per frame.
 *
 * Opaque here for the same reason as {@link useTelemetryStoreOptional}'s
 * return: narrow or cast at the call site.
 */
export function useViewClock(): unknown {
  return getHost().useViewClock();
}

/**
 * Bind a widget's declared actions to handlers, so a mapped serial input can
 * fire them. Keyed by action id off the `actions` array the widget registered:
 *
 *     const actions = [
 *       { id: "toggle", label: "Toggle", accepts: ["button"] },
 *     ] as const satisfies readonly ActionDefinition[];
 *
 *     useActionInput<typeof actions>({
 *       toggle: () => { handleToggle(); return { on: isOn }; },
 *     });
 *
 * The instance id comes from the enclosing dashboard item, so no call site
 * passes it. An inline handler object is the expected shape: the latest one is
 * held in a ref behind stable proxies registered once on mount, so a handler
 * closing over fresh state needs no memoisation and re-registers nothing. A
 * handler's return value is fed back to the device's render style, which is how
 * a display on the hardware follows the widget.
 */
export function useActionInput<TActions extends readonly ActionDefinition[]>(
  handlers: ActionHandlers<TActions>,
): void {
  getHost().useActionInput(handlers);
}

/**
 * Every registered data source with its live connection status, re-rendering on
 * each status change. `DataSourceState[]`, opaque here for the same reason as
 * {@link useViewClock}'s return.
 *
 * For a connection banner or a diagnostics panel. It says nothing about the
 * Sitrep stream itself, which is not a registered source: a widget asking
 * whether ITS data is current reads that off the {@link Reading} its
 * {@link useTelemetry} call already returns.
 */
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

/** Every contribution that wins a slot: the highest priority band present, in registration order. */
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
 * The composition point a widget OWNING a slot drops in for other Uplinks'
 * augments to fill. An Uplink that only fills someone else's slot never renders
 * this; it calls {@link registerAugment} and the owning widget renders it.
 *
 * Generic over the slot id, so `props` is checked against that slot's declared
 * {@link SlotProps} rather than a loose bag. Resolves to the app's own component
 * at render, which is what applies each augment's presence gating: an augment
 * whose Domain is absent contributes nothing here rather than being filtered at
 * registration.
 *
 * `@ksp-gonogo/ui-kit` exports this name too, and that one is the component
 * this resolves to. A widget should take it from there: same registry, and it
 * renders with no host installed, which an Uplink's own test wants.
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
  COMMAND_UNDELIVERED,
  type CommandRejection,
  classifyCommandRejection,
  commandRefusalSubject,
} from "./command-rejection";
// The coverage mask store, its in-memory cache and the React context that
// carries them. Owned here for the same reason the settings context is: a second
// copy of a context is invisible to the other side's provider, and `useCoverageMaskCache`
// was a shim precisely so an Uplink's hook would read the app's. With one context in
// one published package there is no second copy, so that shim retires too.
/**
 * Every `X as FogY` below is a deprecated alias of the name beside it. There is
 * no fog of war in this product: a coverage source contributes per-body masks
 * and a base-layer augment gates its own paint on them, so the fog names
 * described a model that no longer exists.
 *
 * They stay exported because a coverage-contributing Uplink lives in a separate
 * repository and calls `registerFogRevealSource` and `useFogMaskCache` against a
 * published sdk. Drop them once that Uplink has shipped a release built on the
 * coverage names, along with the two `Fog` type aliases at the foot of this file,
 * the matching entries in `api-shape.gate.test.ts`, and
 * `deprecated-fog-aliases.test.ts` entire.
 */
export {
  CoverageMaskCache,
  CoverageMaskCache as FogMaskCache,
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
} from "./coverage/CoverageMaskCache";
export {
  CoverageMaskCacheProvider,
  CoverageMaskCacheProvider as FogMaskCacheProvider,
  CoverageMaskStoreProvider,
  CoverageMaskStoreProvider as FogMaskStoreProvider,
  DEFAULT_PROFILE_ID,
  useBodyCoverageMask,
  useBodyCoverageMask as useBodyFogMask,
  useCoverageMaskCache,
  useCoverageMaskCache as useFogMaskCache,
  useCoverageMaskStore,
  useCoverageMaskStore as useFogMaskStore,
} from "./coverage/CoverageMaskContext";
export {
  type CoverageMaskChangeListener,
  type CoverageMaskChangeListener as FogMaskChangeListener,
  CoverageMaskStore,
  CoverageMaskStore as FogMaskStore,
  MASK_SCHEMA_VERSION,
  type StoredMask,
} from "./coverage/CoverageMaskStore";
export {
  clearCoverageSources as clearFogRevealSources,
  getCoverageSourceSettings as getFogRevealSourceSettings,
  getCoverageSources as getFogRevealSources,
  onCoverageSourcesChange as onFogRevealSourcesChange,
  registerCoverageSource as registerFogRevealSource,
  unregisterCoverageSource as unregisterFogRevealSource,
} from "./coverage-source";
/*
 * Root providers: how an Uplink mounts a context Provider at the top of a
 * screen's tree without the app importing it to hand-wire one in. Published
 * here rather than in `core` because `core` is not an author surface: an
 * Uplink may import this package and `ui-kit` and nothing else of the repo.
 */
/*
 * Revealed event sources: how an Uplink feeds the `event` alarm trigger with
 * the occurrences behind its own Topic, without the app importing it to build
 * the reader.
 */
export {
  clearRevealedEventSources,
  getRevealedEventSources,
  type RevealedEventSourceDefinition,
  readRevealedEvents,
  registerRevealedEventSource,
} from "./event-reveal";
/**
 * A small typed wrapper around `localStorage`. Stateless (no module-global
 * registry): a byte-for-byte port of `@ksp-gonogo/data`'s implementation,
 * not a re-export. See `./localStorageStore.ts`'s module header for why.
 */
export { LocalStorageStore } from "./localStorageStore";
export {
  clearRootProviders,
  getRootProviders,
  type RootProviderDefinition,
  RootProviders,
  registerRootProvider,
} from "./root-providers";
export { safeRandomUuid } from "./safe-random-uuid";
/** The type half of the deprecated fog aliases; see the value half above. */
export type {
  CoverageMaskCacheHandle as FogMaskCacheHandle,
  CoverageSourceDefinition as FogRevealSourceDefinition,
} from "./types";
