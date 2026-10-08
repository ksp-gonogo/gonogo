// The curated author-facing barrel: the one framework, data and hook surface a
// third-party Uplink author imports. It carries the author-facing TYPES
// (declared here rather than re-exported, see ./types for why this leaf cannot
// reach the app's) and fail-loud SHIMS for the stateful members, every
// register function and every hook, which delegate to the app-injected host and throw
// a named error naming the fix when no host is installed. No stateful member
// reaches the app, so a packed Uplink never carries a second registry, which is
// the whole point.
//
// The export list is derived and held by the published surface lock (`extension-api.ledger.json`), so any change to it is declared.
//
// EVERY Uplink goes through this barrel, including the ones bundled with the
// mod. There is no first-party path: bundling changes how an Uplink ships, not
// what it may import, and an Uplink that reaches past this barrel stops
// modelling what an outside author can actually build.

import type { ReactElement } from "react";
import { createElement } from "react";
import type { ModSettingsModel } from "../__generated__/contract";
import type {
  AnyCommandReply,
  CommandArgs,
  CommandId,
  CommandReply,
} from "../commands";
import type { Reading, ReckonableReading, TopicReading } from "../reading";
import type { ReckonableFields, ReckonableTopic } from "../reckonability";
import type { CommandGroupHandle } from "../spine/command-group";
import type { TopicId, TopicPayload } from "../topics";
import type { Value } from "../value";
import { getHost } from "./host";
// Carries the `SlotRegistry` declaration-merge for every first-party slot into any program that imports this barrel.
import "./slots";
// Carries the first-party `ContributionRegistry` declaration-merge, the same way.
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
  DataSourceState,
  LateTelemetrySubscribe,
  ModSettingDep,
  ModSettingsRegistry,
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

export type {
  CommandGroupHandle,
  CommandGroupPhase,
} from "../spine/command-group";
// The alarm request surface: an Uplink asks the app to create an alarm and the
// app owns the result. See `./alarm-request.ts` for why it cannot arm one for
// itself.
export type {
  UplinkAlarmRequest,
  UplinkAlarmThresholdOp,
  UplinkAlarmThresholdTrigger,
  UplinkAlarmTimeTrigger,
  UplinkAlarmTrigger,
  UplinkAlarmVantage,
} from "./alarm-request";
export { useAlarmRequest } from "./alarm-request";
export type {
  CommSignalHopRateEntry,
  CrewRowToneEntry,
  ExperimentsInstrumentEntry,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
  SpaceCenterFacilityEntry,
  StrategiesScreenEntry,
  SystemEntity,
  SystemEntityEmphasis,
  SystemEntityFixedPosition,
  SystemEntityMeta,
  SystemEntityOrbitPosition,
  SystemEntityPosition,
  SystemEntityShape,
  SystemEntityStyle,
  SystemEntitySubjectPosition,
  SystemProjectionExtent,
  SystemViewProjection,
  SystemViewVesselStatusEntry,
} from "./contribution-slots";
export { FRAMEWORK_READS } from "./framework-reads";
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
} from "./plot-layers";
// The `plots` contribution slot's own types: the frame a plot pins and the
// entry it contributes. Its own module for the reason `./plot-layers` is one.
export type {
  PlotEntry,
  PlotFrame,
  PlotSubject,
  PlotSubjectRegistry,
} from "./plots";
export type {
  ActionGroupSlotContext,
  ActionGroupSlotId,
  AstronautComplexCrewContext,
  CrewAvatarContext,
  CrewBadgeContext,
  DeployedExperimentContext,
  DeployedScienceExperiment,
  ExperimentsInstrument,
  ExperimentsInstrumentSlotContext,
  FleetRosterUpdatesContext,
  LaunchDirectorPadContext,
  LaunchDirectorSlotContext,
  MapBaseLayerContext,
  MapCoverageGate,
  MapOverlayContext,
  MapViewScope,
  ObjectiveSlotItem,
  ObjectiveSlotSection,
  ObjectiveSlotState,
  ObjectiveSourceContext,
  OrbitOverlayContext,
  PowerSystemsScope,
  ScienceDataAboardRowContext,
  ShipMapBounds,
  ShipMapOverlayContext,
  ShipMapPart,
  ShipMapPartStateModule,
  ShipMapPartType,
  StrategiesScreenBodyContext,
  SystemOverlayContext,
  TargetingHudContext,
} from "./slots";
export { TINY_SIZE } from "./tiny-size";
export { type AlertTone, TONES, type Tone } from "./tone";
// The message-pipe contract. Defined entirely in terms of this package's own
// wire messages, so it belongs here rather than in `sitrep-client`, and living
// here is what lets the transport double ship from `/testing`.
export type {
  LostCommand,
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
  CommandFailure,
  CommandFound,
  CommandFoundOutcome,
  CommandGateStatus,
  CommandLoss,
  CommandRefusal,
  CommandRefusalDetail,
  CommandStatus,
  CommandUndelivered,
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
  CoverageSourceDefinition,
  DataKey,
  DataRequirement,
  DataSource,
  DataSourceState,
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
  ModSettingDep,
  ModSettingsRegistry,
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
  SizeDelta,
  SlotId,
  SlotProps,
  SlotRegistry,
  StatEntry,
  StationBroker,
  StationBrokerAttach,
  StreamBackedSetting,
  StreamBackedSettingOf,
  StreamStatusValue,
  TelemetryClient,
  ThemeDefinition,
  TinyControl,
  TinyEssential,
  TinyEssentialMark,
  TinyEssentialTone,
  TinyGauge,
  TinyMode,
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
 * The setting that holds the address of the machine running KSP, which every
 * Uplink connects to. Read it with {@link getGameHost}.
 *
 * @category Host and runtime
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
export type { FrameValidity, QualifiedFrame } from "../frame-qualifier";
export {
  apsidesExist,
  controlFrameLabel,
  frameCaveat,
  lengthsAreLengths,
} from "../frame-qualifier";

// The component / data-source / theme registry is NOT a shim: it lives in this
// package (`./registry.ts`). It was the LAST place the shim story did not hold up,
// because registration was published and nothing else about the registry was: an
// Uplink could add a widget through `registerComponent` and then had no supported
// way to reset the registry between test cases (18 Uplink files call
// `clearRegistry`) or to read back what it had added.
//
// Only the author-and-test half is here. The ORCHESTRATION reads
// (`getResolvedComponents`, `getReplacementConflicts`, `getComponents`,
// `getThemes`, `getTheme`) are on the `/registry` subpath
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
 * Every augment registered to `slot`, in render order. For tests, to check
 * what an Uplink registered with {@link registerAugment}.
 *
 * @category Extensions
 */
export const getAugmentsForSlot = (slot: string) =>
  getHost().getAugmentsForSlot(slot);
/**
 * Empty the augment registry. For tests; a running app never calls it.
 *
 * @category Extensions
 */
export const clearAugments = (): void => {
  getHost().clearAugments();
};
/**
 * Renders a component inside another widget's slot. Call it once, when the
 * module loads. Several augments may fill one slot, and all of them render,
 * ordered by `priority`.
 *
 * `component` is checked against the props the slot passes, so an augment of a
 * misspelled slot does not typecheck.
 *
 * @category Extensions
 * @categoryDescription Extensions
 * Adding to widgets you do not own: an augment draws inside another widget, a
 * contribution hands it data to draw, and either goes into a slot that widget
 * opens. Read here to extend a core widget from an Uplink;
 * {@link ContributionSlotId} lists the slots.
 */
export const registerAugment = <Slot extends string>(
  def: AugmentDefinition<Slot>,
): void => getHost().registerAugment(def);

// Registries that are NOT shims: they live in this package. None of them named
// anything above this leaf (provider definitions, opaque handles, one payload
// type), so the host indirection bought nothing and cost an Uplink the read half:
// it could register a POI provider, a handle or an action handler and then had no
// published way to fire or observe it. See `./map-poi.ts` for why their state sits
// in a `globalThis` slot rather than a module static.
//
// `dispatchAction` is the one an Uplink TEST reaches for most: it is how a widget's action is exercised with no serial device attached.
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
export {
  clearStationBrokers,
  registerStationBroker,
  unregisterStationBroker,
} from "./station-brokers";
export { registerStockBodies } from "./stock-bodies";
export {
  clearUplinkHandles,
  getUplinkHandle,
  registerUplinkHandle,
  unregisterUplinkHandle,
} from "./uplink-handles";

/**
 * Declares an Uplink client and returns its handle. Call it once per client.
 *
 * Pass the handle as `owner` to every `registerComponent` and
 * {@link registerAugment} call the client makes, and register contributions
 * through the handle's own `registerContribution`. A widget registered without
 * an `owner` is not tied to its Uplink, so searching the add-widget picker for
 * the Uplink's id does not find it.
 *
 * @category Registering
 */
export const defineUplinkClient = (cfg: {
  id: string;
  version: string;
  name: string;
  /** What the Uplink does, in one or two sentences. See {@link UplinkClientHandle.description}. */
  description: string;
}): UplinkClientHandle => getHost().defineUplinkClient(cfg);

/**
 * Adds a custom tab to the app's Settings. Prefer `registerSetting`, which the
 * app renders for you.
 *
 * @category Settings
 */
export const registerSettingsTab = (def: SettingsTabDefinition): void =>
  getHost().registerSettingsTab(def);

/**
 * Adds a setting the app draws in its Settings, in place of a whole custom tab
 * ({@link registerSettingsTab}). A client setting is saved in the browser; a
 * setting the mod publishes on a Topic is shown and cannot be changed here. A
 * row is `boolean`, `text` or `number`, can be `readOnly`, and can be filed in a
 * named `group` within its category. See {@link SettingDefinition}.
 *
 * The row's `type` decides what `defaultValue` and `select` may be, so a
 * `"number"` row with a `defaultValue` of `true` does not compile.
 *
 * @category Settings
 * @categoryDescription Settings
 * Settings a client keeps: declaring one, reading and writing it from a widget,
 * and the tab it is shown on. A setting the mod holds arrives on the stream
 * instead, as a {@link SettingsModel} row.
 */
export function registerSetting<
  SettingKind extends SettingType = "boolean",
  Topic extends TopicId = TopicId,
>(def: SettingDefinitionOf<SettingKind, Topic>): void;
/**
 * This overload takes a row from a list, for a client that keeps its rows in an
 * array and registers them in a loop. Rows of different types in
 * one array are typed as the plain `SettingDefinition`, which the generic form
 * above does not accept.
 */
export function registerSetting(def: SettingDefinition): void;
export function registerSetting(
  def: SettingDefinitionOf<SettingType, TopicId> | SettingDefinition,
): void {
  // The cast collapses an unresolved T to the union the host takes. Every
  // instantiation of T IS a member of that union, but TypeScript will not
  // prove it while T is still a parameter.
  getHost().registerSetting(def as SettingDefinition);
}

/**
 * Whether a registered row is one the operator can change. The renderer's own
 * rule, exported so an Uplink asking the same question of its own definitions
 * gets the same answer: a `stream-backed` row is read-only whether or not it
 * said so.
 */
export { isReadOnlySetting, settingTypeOf } from "../spine/settings-registry";

/**
 * Subscribes to a Topic and returns its latest {@link TopicReading}: the
 * payload together with how current it is.
 *
 * The payload as a whole, `reading.value`, is only there when `state` is
 * `"observed"`, or `"held"` for a held value, so check `state` before reading
 * it. Every payload field is also on the reading itself as a {@link Reading}
 * of its own, `flight.altitudeAsl` beside `flight.value.altitudeAsl`. That one
 * can be passed to a kit component such as `Unit` without a check: it carries
 * its own state, and the component shows how current it is.
 *
 * For a Topic whose contract declares a forward model, such as
 * `vessel.flight`, it returns a {@link ReckonableReading}.
 *
 * A Topic with no `TopicId`, a per-subject namespace such as
 * `vessel.partActions.<flightId>`, is read with `useStream` instead.
 *
 * Where a payload is expected, pass the checked `value`, never the reading
 * itself: a payload type whose fields are all optional accepts a whole reading
 * without a type error, and then finds none of its fields.
 *
 * @param topic - The Topic to read, such as `"vessel.flight"`.
 *
 * @example A field passed on whole
 * ```tsx
 * import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
 * import { Unit } from "@ksp-gonogo/ui-kit";
 *
 * function VerticalSpeed() {
 *   const flight = useTelemetry("vessel.flight");
 *   return <Unit value={flight.verticalSpeed} />;
 * }
 * ```
 *
 * @example Checking the state, for something only a current value may decide
 * ```tsx
 * import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
 * import { Text } from "@ksp-gonogo/ui-kit";
 *
 * function DescentFlag() {
 *   const flight = useTelemetry("vessel.flight");
 *   if (flight.state !== "observed") return null;
 *   return flight.value.verticalSpeed.lessThan(0) ? <Text>Descending</Text> : null;
 * }
 * ```
 *
 * @category Reading telemetry
 * @categoryDescription Reading telemetry
 * Reading the stream in a widget: the Topic ids and their payloads, the hooks
 * that subscribe to one, how a reading says whether its value is current, held
 * or reckoned, and the fields a Topic carries. Most widgets need nothing else
 * from the SDK.
 */
export function useTelemetry<Topic extends TopicId>(
  topic: Topic,
): Topic extends ReckonableTopic
  ? ReckonableReading<
      TopicPayload<Topic>,
      ReckonableFields<Topic> & keyof TopicPayload<Topic>
    >
  : TopicReading<TopicPayload<Topic>> {
  // The declared return must stay what the host returns: a narrower one typechecks every client and breaks at runtime.
  return getHost().useTelemetry(topic);
}

/**
 * Returns the instant the screen is showing, as a UT. Under signal delay, or
 * while a recording is scrubbed, this is not the game's present. Subtract it
 * from an absolute UT to get a duration to show, such as the time to an
 * event.
 *
 * `undefined` when no telemetry stream is mounted. It never falls back to the
 * browser's clock.
 *
 * @category Delay and vantage
 *
 * @concept Delay and vantage
 * Every screen sees the game from a vantage: the command centre its connection
 * observes at and commands from, chosen with {@link SetVantage} from the
 * centres on the roster ({@link CommandCentreEntry}). News from a craft reaches
 * that centre one signal delay after it happened, so the screen shows the game
 * at a view time behind the game's own present, and {@link useViewUt} returns
 * that view time. Nothing on the screen is the game's truth at this instant; a
 * {@link TopicReckoning} is the nearest a widget gets, and it is drawn as
 * modelled.
 *
 * - a vantage is not the game: what a screen shows is what its centre has been
 *   told, so two centres at different distances show the same craft at
 *   different moments
 * - delayed is not true now: most Topics are read one delay back
 *   ({@link DelayLane} `"delayed"`). A {@link TrueNowTopic}, such as the warp
 *   state or the bodies, is true at the command centre and read with no delay
 *   subtracted, and a {@link HeldAtHomeTopic}, such as the career's finances,
 *   is read at the centre's delay from home
 * - sent is not arrived: a command leaves the vantage now and reaches the craft
 *   one delay later, and its effect is seen one more delay after that.
 *   {@link DelayMode} says how a command sent now would travel, and
 *   {@link useCommand} reports where it has got to
 *
 * A widget takes times from the view clock ({@link useViewUt},
 * {@link useViewClock}), never from the browser's clock, and works out a
 * countdown by subtracting the view time from an absolute UT.
 */
export function useViewUt(): Value<"ut"> | undefined {
  return getHost().useViewUt();
}

/**
 * Returns a handle for sending one command: `send` takes the command's
 * arguments and resolves with its reply. See {@link UseCommandResult}.
 *
 * `send` resolves only when the command has run. When the game refuses it,
 * `send` rejects with an error carrying a `CommandErrorCode`, which
 * {@link classifyCommandRejection} reads for you to branch on; when no reply
 * arrives in time, it rejects too. Both are also recorded on the handle, in
 * `refusals` and `losses`, so a `send` you do not await loses nothing.
 *
 * Every command except those about the game clock travels at the signal
 * delay of the command centre it is sent from, so a sent command has not yet
 * happened. Pass the handle to `<CommandDelay>` to show its delay and what
 * became of it.
 *
 * The dashboard mounts what tracks commands in flight, and so do the test
 * render helpers. A component rendered outside both, as in a test that renders
 * it bare, throws on `send` in a development build.
 *
 * Every command id is listed in {@link COMMAND_IDS}.
 *
 * @param command - The command to send, such as `"vessel.control.setSas"`.
 * @param options - See {@link UseCommandOptions}.
 *
 * @example
 * ```tsx
 * import { useCommand } from "@ksp-gonogo/sitrep-sdk";
 * import { Button } from "@ksp-gonogo/ui-kit";
 *
 * function SasOn() {
 *   const setSas = useCommand("vessel.control.setSas");
 *   return <Button onClick={() => void setSas.send({ enabled: true })}>SAS on</Button>;
 * }
 * ```
 *
 * @category Commands
 * @categoryDescription Commands
 * Sending commands to the game: the command ids with their typed arguments and
 * replies, the hook a widget sends through, how a refusal is classified, and
 * the rail a command travels on to reach the craft.
 */
export function useCommand<Command extends CommandId>(
  command: Command,
  options?: UseCommandOptions,
): UseCommandResult<CommandArgs<Command>, CommandReply<Command>>;
/**
 * Returns a handle for a command whose id is not in {@link CommandArgsMap},
 * such as one whose id is built at runtime. Name the argument and reply types
 * yourself, or the arguments are `unknown` and the reply is
 * {@link AnyCommandReply}.
 *
 * An Uplink's own commands do not need this form: augment
 * {@link CommandArgsMap} and {@link CommandReplyMap} from its client package,
 * call {@link registerUplinkCommand}, and use the first form.
 *
 * @example
 * ```ts
 * function useProbeReset(probeId: string) {
 *   return useCommand<{ hard: boolean }>(`myuplink.probe.${probeId}.reset`);
 * }
 * ```
 */
export function useCommand<Args = unknown, Reply = AnyCommandReply>(
  command: string,
  options?: UseCommandOptions,
): UseCommandResult<Args, Reply>;
export function useCommand(
  command: string,
  options?: UseCommandOptions,
): UseCommandResult {
  return getHost().useCommand(command, options);
}

/**
 * Sends the commands the callback makes as one group. Every `send` on a
 * `useCommand` handle made while the callback runs is held back, and when it
 * returns they go to the game as a single message: one place in the craft's
 * command order, delivered whole or not at all, refused whole if any one of them
 * is, and run in order in one physics tick.
 *
 * Each handle's own promise still settles with its own command's reply, so a
 * widget that already reads a handle needs no change.
 *
 * The callback must be synchronous and cannot nest: an `await` inside it would
 * let a send from somewhere else fall into the group. All the commands must go to
 * the same craft, from the same command centre, and none can be instant.
 * Breaking those rules throws, and nothing is sent.
 *
 * The game cannot take an action back. If a command in a group fails after the
 * ones before it ran, those stay done and the ones after it do not run; the
 * replies say which.
 *
 * @example
 * ```ts
 * const ag = useCommand("vessel.control.setActionGroup");
 * const sas = useCommand("vessel.control.setSas");
 *
 * const group = sendTogether(() => {
 *   void ag.send({ group: 1, state: true });
 *   void ag.send({ group: 2, state: true });
 *   void sas.send({ enabled: true });
 * });
 * await group.result;
 * ```
 *
 * @category Commands
 */
export function sendTogether(build: () => void): CommandGroupHandle {
  return getHost().sendTogether(build);
}

/**
 * Calls one of an Uplink's own methods from a widget, on any screen.
 *
 * It is for calls an Uplink's client makes to an object of its own on the main
 * screen: a WebRTC offer to answer, an inventory to fetch, anything whose shape
 * only that Uplink knows. A Topic carries what the game is doing and a command
 * changes it; this is neither. Register the object with
 * {@link registerUplinkHandle}, then call it from any widget with this.
 *
 * On the main screen the call reaches the object directly. On a station it is
 * passed on through the main screen, and the Uplink's code is the same either
 * way.
 *
 * The returned function stays the same while the route does, so it is safe in
 * a dependency array. It rejects, rather than hanging, when there is no route.
 *
 * @example Calling a method of the object the Uplink stored with `registerUplinkHandle("my-uplink", ...)`
 * ```tsx
 * import { useUplinkRelay } from "@ksp-gonogo/sitrep-sdk";
 * import { useEffect, useState } from "react";
 *
 * function CameraCount(props: { vesselId: string }) {
 *   const relay = useUplinkRelay("my-uplink");
 *   const [cameras, setCameras] = useState<unknown[]>([]);
 *   useEffect(() => {
 *     let stale = false;
 *     relay("listCameras", { vesselId: props.vesselId }).then(
 *       (list) => {
 *         if (!stale) setCameras(list as unknown[]);
 *       },
 *       () => {
 *         if (!stale) setCameras([]);
 *       },
 *     );
 *     return () => {
 *       stale = true;
 *     };
 *   }, [relay, props.vesselId]);
 *   return <span>{cameras.length} cameras</span>;
 * }
 * ```
 *
 * @category Host and runtime
 */
export function useUplinkRelay(uplinkId: string) {
  // gonogo:reads none
  return getHost().useUplinkRelay(uplinkId);
}

/**
 * The ICE servers the main screen hands out, for an Uplink opening a media
 * connection from a station.
 *
 * A station cannot reach the relay that issues TURN credentials, so the main
 * screen broadcasts them and this reads them. Empty on the main screen itself,
 * which reaches the relay directly.
 *
 * ```ts
 * const ice = useHostIceServers();
 * useEffect(() => {
 *   const pc = new RTCPeerConnection({ iceServers: ice.current() });
 *   const stop = ice.onChange((iceServers) => pc.setConfiguration({ iceServers }));
 *   return () => {
 *     stop();
 *     pc.close();
 *   };
 * }, [ice]);
 * ```
 *
 * Open the connection in an effect, as above, so it is made once and not on
 * every render. Credentials rotate, so a long-lived connection watches
 * `onChange` rather than reading `current()` once.
 *
 * @category Host and runtime
 */
export function useHostIceServers() {
  // gonogo:reads none
  return getHost().useHostIceServers();
}

/**
 * Returns every command travelling to `topic`, whichever command centre sent
 * it, and the state of the link. A handle from {@link useCommand} lists only
 * the commands that handle sent.
 *
 * @category Commands
 */
export function useRouteCommands(topic: string): UseRouteCommandsResult {
  return getHost().useRouteCommands(topic);
}

/**
 * Reads a Topic by a string id and returns its {@link TopicReading}, in the
 * same states as {@link useTelemetry}.
 *
 * Use it for a Topic that has no {@link TopicId}: a derived channel such as
 * `"system.state"`, an Uplink's own Topic, or a Topic whose id is built at
 * runtime such as `vessel.partActions.<flightId>`. `Payload` is whatever you
 * pass and nothing checks it, so prefer {@link useTelemetry} wherever the
 * Topic has a `TopicId`.
 *
 * @category Reading telemetry
 */
export function useStream<Payload>(topic: string): TopicReading<Payload> {
  return getHost().useStream<Payload>(topic);
}

/**
 * Reads the settings of one Uplink's mod, as that mod reports them. Change a
 * writable setting with the `settings.mod.write` command, then read the
 * change here rather than from the command's reply.
 *
 * @param uplinkId - The Uplink whose settings to read.
 *
 * @category Reading telemetry
 */
export function useModSettings(
  uplinkId: string,
): TopicReading<ModSettingsModel> {
  return getHost().useStream<ModSettingsModel>(`settings.${uplinkId}`);
}

/**
 * A contribution dependency on one setting of an Uplink's host mod. Both names
 * are checked against `ModSettingsRegistry`, so an Uplink or a setting nobody
 * declared does not compile, and `compute` receives the value under
 * `settings.<uplink>.<key>` as the type the registry declares.
 *
 * @example
 * ```ts
 * // Declare the host mod's settings once, in the Uplink's client:
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface ModSettingsRegistry {
 *     "my-uplink": { difficulty: number };
 *   }
 * }
 *
 * const deps = [modSettingDep("my-uplink", "difficulty")] as const;
 * ```
 *
 * @category Extensions
 */
export function modSettingDep<
  const Uplink extends keyof ModSettingsRegistry & string,
  const Key extends keyof ModSettingsRegistry[Uplink] & string,
>(uplink: Uplink, key: Key): ModSettingDep<Uplink, Key> {
  return { modSetting: { uplink, key } };
}

/**
 * Returns a processor's value for the current frame, and re-renders when it
 * changes. Pass the handle that {@link UplinkClientHandle.registerProcessor}
 * returned, or a handle the SDK publishes such as {@link CELESTIAL_FACTS}; the
 * result is typed from the handle. The processor runs once per frame however
 * many widgets read it. Returns `undefined` with no telemetry stream mounted,
 * or before the first frame.
 *
 * A processor with a reading among its dependencies returns a
 * `Reading<Result>`, dated by its inputs. One that depends only on Topic ids
 * returns the bare `Result`.
 *
 * @category Processors
 * @categoryDescription Processors
 * Values computed from Topics once and shared: a processor reads its
 * dependencies and returns a derived value each frame, and any Uplink can read
 * one through a handle without depending on the Uplink that implements it.
 * Also here are the pieces of a derived channel, a Topic the app computes from
 * other Topics ({@link DerivedChannelDefinition}), and {@link TimelinePoint},
 * the dated sample both a derived channel and a reckoner read.
 */
export function useProcessor<Result, Carried extends boolean>(handle: {
  readonly id: string;
  readonly __resultType?: Result;
  readonly __carriesCurrency?: Carried;
}): (Carried extends true ? Reading<Result> : Result) | undefined {
  return getHost().useProcessor(handle);
}

/**
 * Returns the view clock every widget on the screen renders against, for code
 * that needs the clock itself rather than the current time: to run on each
 * frame, or to read the latest instant that may be shown. For the current
 * time, use {@link useViewUt}.
 *
 * Throws when no telemetry stream is mounted; {@link useViewClockOptional}
 * returns `undefined` instead. The return is typed `unknown`: narrow it to the
 * shape you use, such as {@link DelayClockLike}.
 *
 * @category Delay and vantage
 * @categoryDescription Delay and vantage
 * Signal delay as a widget meets it: the clock the screen sees the game at,
 * which Topics are delayed and which are true now, where a command is on its
 * way out, and events shown only once the delay has passed. Read here before
 * showing a time, a countdown or a command in flight.
 */
export function useViewClock(): unknown {
  return getHost().useViewClock();
}

/**
 * Connects a widget's declared actions to handlers, so an input the operator
 * has bound, such as a key or a joystick button, fires them. Keys are the
 * action ids from {@link ComponentDefinition.actions}; an operator binds an
 * input to an action on the widget's Inputs tab, in its settings. What a
 * handler returns is sent back to the device that fired it, a control panel
 * with a display of its own for instance, so the display can follow the
 * widget. The built-in 21 by 8 text display takes a flat object of keys to
 * values, such as `{ ALT: "12.4 km", THR: "80%" }`, and prints one `KEY VALUE`
 * line per entry, sorted by key. Return nothing when the device has no display.
 *
 * Pass a new handler object on every render if you like: the latest handlers
 * are always the ones called, and nothing is registered again.
 *
 * @example
 * ```tsx
 * import { type ActionDefinition, useActionInput } from "@ksp-gonogo/sitrep-sdk";
 * import { Text } from "@ksp-gonogo/ui-kit";
 *
 * const actions = [
 *   { id: "toggle", label: "Toggle", accepts: ["button"] },
 * ] as const satisfies readonly ActionDefinition[];
 *
 * function LightSwitch() {
 *   useActionInput<typeof actions>({
 *     toggle: (input) => ({ pressed: input.value }),
 *   });
 *   return <Text>Light</Text>;
 * }
 * ```
 *
 * @category Actions
 */
export function useActionInput<Actions extends readonly ActionDefinition[]>(
  handlers: ActionHandlers<Actions>,
): void {
  getHost().useActionInput(handlers);
}

/**
 * Every registered data source with its connection status, re-rendering when
 * a status changes. Each element is `{ id, name, status }`, with `status` a
 * {@link DataSourceStatus}.
 *
 * For a connection banner or a diagnostics panel. It says nothing about the
 * game's telemetry stream, which is not a registered source: a widget reads
 * how current its own data is from the {@link Reading} {@link useTelemetry}
 * returns.
 *
 * @category Registering
 */
export function useDataSources(): DataSourceState[] {
  return getHost().useDataSources();
}

/**
 * Returns the latest value received on `topic`, without the signal delay and
 * without a state: `undefined` until something arrives.
 *
 * Only for values about the command centre itself, such as when a command was
 * sent or the state of a link. A value about a craft must be read with
 * {@link useTelemetry} or {@link useStream}, which hold it back by the signal
 * delay.
 *
 * @category Reading telemetry
 */
export function useLatestValue<Payload = unknown>(
  topic: string,
): Payload | undefined {
  return getHost().useLatestValue<Payload>(topic);
}

/**
 * Calls `handler` once for each event delivered on `topic`, such as a crash.
 * For a Topic that carries events rather than a value that changes; a value is
 * read with {@link useStream}.
 *
 * @category Reading telemetry
 */
export function useStreamEvent<Payload = unknown>(
  topic: string,
  handler: (payload: Payload) => void,
): void {
  getHost().useStreamEvent(topic, handler);
}

/**
 * Returns a function that subscribes to Topics from code, for Topics you only
 * know after some setup finishes, or whose number changes at runtime. See
 * {@link LateTelemetrySubscribe}. The function is the same on every render.
 *
 * @category Reading telemetry
 */
export function useLateTelemetrySubscribe(): LateTelemetrySubscribe {
  return getHost().useLateTelemetrySubscribe();
}

/**
 * Returns the instant the screen is showing, in UT seconds as a plain number,
 * and re-renders on each frame. `undefined` when no telemetry stream is
 * mounted. {@link useViewUt} returns the same instant as a `Value<"ut">`.
 *
 * @category Delay and vantage
 */
export function useUtNow(): number | undefined {
  return getHost().useUtNow();
}

/**
 * Returns the store that holds the received history of every Topic, or
 * `undefined` when no telemetry stream is mounted. It is here for ui-kit's own
 * components, and the store's type is not published, which is why the return
 * is `unknown`. An Uplink reads a Topic with {@link useTelemetry} or
 * {@link useStream}, and tests for a mounted stream by whether this is
 * `undefined`.
 *
 * @category Reading telemetry
 */
export function useTelemetryStoreOptional(): unknown {
  return getHost().useTelemetryStoreOptional();
}

/**
 * Returns the same clock as {@link useViewClock}, or `undefined` when no
 * telemetry stream is mounted.
 *
 * @category Delay and vantage
 */
export function useViewClockOptional(): unknown {
  return getHost().useViewClockOptional();
}

/**
 * Returns the {@link TelemetryClient} of the most recently mounted telemetry
 * stream, or `undefined` when none is mounted. For code outside a React
 * component; a component uses {@link useTelemetryClientOptional}.
 *
 * @category Reading telemetry
 */
export function getActiveTelemetryClient(): TelemetryClient | undefined {
  return getHost().getActiveTelemetryClient();
}

/**
 * Returns the {@link TelemetryClient} of the telemetry stream this component
 * is mounted under, or `undefined` when there is none.
 *
 * @category Reading telemetry
 */
export function useTelemetryClientOptional(): TelemetryClient | undefined {
  return getHost().useTelemetryClientOptional();
}

/**
 * Returns whether the screen is playing back a recorded flight rather than
 * showing the live game.
 *
 * @category Delay and vantage
 */
export function useReplaySessionActive(): boolean {
  return getHost().useReplaySessionActive();
}

/**
 * The address of the machine running KSP, which every Uplink connects to: the
 * address saved in Settings, or else the build's `VITE_SITREP_HOST`, or else
 * `localhost`. It carries no port; each service adds its own.
 *
 * @category Host and runtime
 */
export function getGameHost(): string {
  /* Spelled `import.meta.env` on purpose: Vite substitutes that exact text,
     and a read it cannot see (`Reflect.get(import.meta, "env")`) is undefined
     in both the dev server and the bundle. */
  const configured: unknown = (
    import.meta as ImportMeta & { env?: Record<string, unknown> }
  ).env?.VITE_SITREP_HOST;
  const buildDefault =
    typeof configured === "string" && configured ? configured : "localhost";
  return readSetting(GAME_HOST_KEY) ?? buildDefault;
}
// The read half of the contribution registry. The WRITE half stays on
// `defineUplinkClient`'s handle rather than appearing here: the handle stamps
// `${clientId}:` onto every id, and a bare `registerContribution` on this
// barrel would be a way to opt out of the namespacing that stops two Uplinks
// colliding.

/**
 * Every contribution that wins a slot: the highest priority band present, in
 * registration order.
 *
 * @category Extensions
 */
export function getContributionsForSlot(slot: string): AnyContribution[] {
  return getHost().getContributionsForSlot(slot);
}

/**
 * Calls `cb` whenever a contribution is registered or removed. Returns the
 * function that stops it.
 *
 * @category Extensions
 */
export function onContributionsChange(cb: () => void): () => void {
  return getHost().onContributionsChange(cb);
}

/**
 * Empty the contribution registry. For tests; a running app never calls it.
 *
 * @category Extensions
 */
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

/**
 * Renders every augment registered to the slot `name`, where a widget that
 * owns the slot places it. An Uplink that only fills another widget's slot
 * never renders this: it calls {@link registerAugment}.
 *
 * `props` is checked against the slot's {@link SlotProps}. An augment whose
 * `requires` Domain is not present renders nothing.
 *
 * `@ksp-gonogo/ui-kit` exports the same component, and a widget should import
 * it from there: it reads the same registry and also renders in a test with
 * no app around it.
 *
 * @category Extensions
 */
export function AugmentSlot<Slot extends string>(props: {
  name: Slot;
  props: SlotProps<Slot>;
}): ReactElement {
  /* The host's slot takes the erased form, because it renders slots for every
     widget and cannot know which one it holds. */
  const erased: { name: string; props?: Record<string, unknown> } = {
    name: props.name,
    props: props.props as Record<string, unknown>,
  };
  return createElement(getHost().AugmentSlot, erased);
}

// `ContributionsProvider` is NOT a shim here any more. It is
// `@ksp-gonogo/ui-kit`'s, directly: the aggregation moved there to sit beside the
// per-widget store it writes, and ui-kit is published, so an Uplink hosting its own
// slot imports it from the package that owns it. A shim would have made the name
// declared in two published packages, which
// `styleguide-shared-published-surface.test.ts` fails the build for, and it would
// have been indirection with one implementation on the other end.

/**
 * Creates a performance budget: a count of events, such as samples, over a
 * rolling window, that logs a warning when it goes over `threshold`. Call
 * `record()` on the handle for each event. In the running app that warning is
 * all it does. In a test run that has called `installTestGate()` on
 * {@link PerfBudget}, a test that pushes a budget over its threshold fails.
 *
 * Give anything that takes in samples or sends requests at a high rate one
 * budget, with a `name` that says what is counted and a `threshold` three to
 * five times the rate you expect in normal use, so a runaway loop or a
 * duplicated subscription is caught and an ordinary burst is not.
 *
 * @example
 * ```ts
 * import { createPerfBudget } from "@ksp-gonogo/sitrep-sdk";
 *
 * // Made once, when the client loads; `windowMs` defaults to one second.
 * const SAMPLES_IN = createPerfBudget({
 *   name: "MySource samples in/sec",
 *   threshold: 1500,
 *   unit: "samples",
 * });
 *
 * export function onSample(): void {
 *   SAMPLES_IN.record();
 * }
 * ```
 *
 * @category Logging and performance
 */
export function createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle {
  return getHost().createPerfBudget(opts);
}

/**
 * Sort a caught `send()` rejection into refused / lost / failed. Published
 * because the alternative for an author is `instanceof` against a class in the
 * unpublished spine, or matching a code string they could only have read in our
 * source. The three names match the `CommandStatus` phases deliberately.
 */
export {
  COMMAND_LOST,
  type CommandRejection,
  classifyCommandRejection,
  commandRefusalSubject,
} from "./command-rejection";
// The coverage mask cache and the React context that carries it. Owned here
// because a second copy of a context is invisible to the other side's provider:
// with one context in one published package, an Uplink's hook reads the app's.
export {
  CoverageMaskCache,
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
} from "./coverage/CoverageMaskCache";
export {
  CoverageMaskCacheProvider,
  useBodyCoverageMask,
  useCoverageMaskCache,
} from "./coverage/CoverageMaskContext";
/**
 * The error vocabulary: every refusal and fault code, typed, and the sentence
 * and meaning behind any id a client meets, including an Uplink's refinements.
 */
export {
  describeErrorCode,
  noteRosterErrorCodes,
  registerErrorCodes,
  registeredErrorCodes,
} from "./error-codes";
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
