// ---------------------------------------------------------------------------
// The injected-host lookup: a fail-loud shim.
//
// The stateful author-facing surface (every register function, every hook) cannot
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

import type { ComponentType } from "react";
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
import type { UplinkAlarmRequest } from "./alarm-request";
import type { Logger } from "./logger-contract";
import type {
  ActionDefinition,
  ActionHandlers,
  AnyContribution,
  AugmentDefinition,
  DataSourceState,
  HostIceServers,
  LateTelemetrySubscribe,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SettingDefinition,
  SettingsTabDefinition,
  TelemetryClient,
  UplinkClientHandle,
  UplinkRelay,
  UseCommandOptions,
  UseCommandResult,
  UseRouteCommandsResult,
} from "./types";

/**
 * The registries and hooks the app installs when it starts, which the sdk's
 * functions call through. An Uplink's own code never implements or calls it:
 * it calls the sdk's functions. A test is the one place you supply it, by
 * passing the members the code under test needs to `installTestHost`, or by
 * installing a whole one with `installRealTestHost`, both from
 * `@ksp-gonogo/sitrep-sdk/testing`.
 *
 * @category Host and runtime
 */
export interface GonogoHost {
  /** What {@link registerAugment} calls. */
  registerAugment<Slot extends string>(def: AugmentDefinition<Slot>): void;

  /** What {@link useTelemetry} calls. */
  useTelemetry<Topic extends TopicId>(
    topic: Topic,
  ): Topic extends ReckonableTopic
    ? ReckonableReading<
        TopicPayload<Topic>,
        ReckonableFields<Topic> & keyof TopicPayload<Topic>
      >
    : TopicReading<TopicPayload<Topic>>;
  /** What {@link useViewUt} calls. */
  useViewUt(): Value<"ut"> | undefined;
  // The app implements the untyped signature; the overloads only narrow it for callers.
  /** What {@link useCommand} calls. */
  useCommand<Command extends CommandId>(
    command: Command,
    options?: UseCommandOptions,
  ): UseCommandResult<CommandArgs<Command>, CommandReply<Command>>;
  useCommand<Args = unknown, Reply = AnyCommandReply>(
    command: string,
    options?: UseCommandOptions,
  ): UseCommandResult<Args, Reply>;
  /** What {@link sendTogether} calls. */
  sendTogether(build: () => void): CommandGroupHandle;
  /** What {@link useUplinkRelay} calls. */
  useUplinkRelay(uplinkId: string): UplinkRelay;
  /** What {@link useHostIceServers} calls. */
  useHostIceServers(): HostIceServers;
  /** What {@link useRouteCommands} calls. */
  useRouteCommands(topic: string): UseRouteCommandsResult;
  /** What {@link useStream} calls. */
  useStream<Payload>(topic: string): TopicReading<Payload>;
  /** What {@link useProcessor} calls. */
  useProcessor<Result, Carried extends boolean>(handle: {
    readonly id: string;
    readonly __resultType?: Result;
    readonly __carriesCurrency?: Carried;
  }): (Carried extends true ? Reading<Result> : Result) | undefined;
  /** What {@link useViewClock} calls. */
  useViewClock(): unknown;
  /** What {@link useAlarmRequest} calls. */
  useAlarmRequest(
    owner: UplinkClientHandle,
  ): (request: UplinkAlarmRequest) => void;
  /** What {@link useActionInput} calls. */
  useActionInput<Actions extends readonly ActionDefinition[]>(
    handlers: ActionHandlers<Actions>,
  ): void;
  /** What {@link useDataSources} calls. */
  useDataSources(): DataSourceState[];

  /** What {@link useLatestValue} calls. */
  useLatestValue<Payload = unknown>(topic: string): Payload | undefined;
  /** What {@link useStreamEvent} calls. */
  useStreamEvent<Payload = unknown>(
    topic: string,
    handler: (payload: Payload) => void,
  ): void;
  /** What {@link useLateTelemetrySubscribe} calls. */
  useLateTelemetrySubscribe(): LateTelemetrySubscribe;
  /** What {@link useUtNow} calls. */
  useUtNow(): number | undefined;
  /** What {@link useTelemetryStoreOptional} calls. */
  useTelemetryStoreOptional(): unknown;
  /** What {@link useViewClockOptional} calls. */
  useViewClockOptional(): unknown;

  /** What {@link useReplaySessionActive} calls. */
  useReplaySessionActive(): boolean;

  /** What {@link AugmentSlot} renders. */
  AugmentSlot: ComponentType<{ name: string; props?: Record<string, unknown> }>;
  /** What {@link createPerfBudget} calls. */
  createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle;

  /** The app's logger, which {@link logger} reads. */
  logger: Logger;

  /** What {@link getAugmentsForSlot} calls. */
  getAugmentsForSlot(slot: string): AugmentDefinition<string>[];
  /** What {@link clearAugments} calls. */
  clearAugments(): void;
  /** What {@link getContributionsForSlot} calls. */
  getContributionsForSlot(slot: string): AnyContribution[];
  /** What {@link onContributionsChange} calls. */
  onContributionsChange(cb: () => void): () => void;
  /** What {@link clearContributions} calls. */
  clearContributions(): void;

  /** What {@link defineUplinkClient} calls. */
  defineUplinkClient(cfg: {
    id: string;
    version: string;
    name: string;
    description?: string;
  }): UplinkClientHandle;

  /** What {@link registerSettingsTab} calls. */
  registerSettingsTab(def: SettingsTabDefinition): void;

  /** What {@link registerSetting} calls. */
  registerSetting(def: SettingDefinition): void;

  /** What {@link getActiveTelemetryClient} calls. */
  getActiveTelemetryClient(): TelemetryClient | undefined;
  /** What {@link useTelemetryClientOptional} calls. */
  useTelemetryClientOptional(): TelemetryClient | undefined;
}

/**
 * The `globalThis` key the app installs its {@link GonogoHost} under.
 *
 * @category Host and runtime
 */
export const GONOGO_HOST_KEY = "__GONOGO_SDK__" as const;

declare global {
  var __GONOGO_SDK__: GonogoHost | undefined;
}

/**
 * Resolve the injected host, or throw a named, actionable error. The message
 * names the package and states the fix (mark the specifier `external`) so a
 * mis-bundled Uplink fails loud at first registration rather than vanishing.
 */
export function getHost(): GonogoHost {
  const host = globalThis[GONOGO_HOST_KEY];
  if (!host) {
    throw new Error(
      "@ksp-gonogo/sitrep-sdk: the gonogo host has not been installed. " +
        "This package's stateful surface (the hooks, registerAugment, ...) is " +
        "runtime-injected by the app: mark @ksp-gonogo/sitrep-sdk `external` in " +
        "your bundle so it resolves to the host, and do not bundle a second copy. " +
        "In tests, install a host with @ksp-gonogo/sitrep-sdk/testing.",
    );
  }
  return host;
}

/**
 * Whether the app, or a test host, is installed. An sdk function that needs the
 * app throws without one, so check this first where that is expected, such as
 * at module load.
 *
 * @category Host and runtime
 */
export function hasHost(): boolean {
  return Boolean(globalThis[GONOGO_HOST_KEY]);
}

/**
 * Internal: install / clear the host. Public installation is the app's job (at
 * boot) and tests' job (via the `/testing` subpath), this is the shared plumbing
 * both use. Not part of the author-facing barrel.
 */
export function __setGonogoHost(host: GonogoHost | undefined): void {
  globalThis[GONOGO_HOST_KEY] = host;
}
