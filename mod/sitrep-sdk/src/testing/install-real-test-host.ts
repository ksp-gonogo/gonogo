import type { ComponentType } from "react";
import type { GonogoHost } from "../api/host";
import { PerfBudget } from "../perf/PerfBudget";
import {
  getActiveTelemetryClient,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  useUtNow,
  useViewClock,
  useViewClockOptional,
  useViewUt,
} from "../spine/context";
import {
  clearContributions,
  getContributionsForSlot,
  onContributionsChange,
} from "../spine/contributions";
import { useReplaySessionActive } from "../spine/replay-session";
import { registerSetting } from "../spine/settings-registry";
import { registerSettingsTab } from "../spine/settings-tabs";
import { defineUplinkClient } from "../spine/uplink-clients";
import { useActionInput } from "../spine/use-action-input";
import { useCommand } from "../spine/use-command";
import { useDataSources } from "../spine/use-data-sources";
import { useLateTelemetrySubscribe } from "../spine/use-late-telemetry-subscribe";
import { useProcessor } from "../spine/use-processor";
import { useRouteCommands } from "../spine/use-route-commands";
import { useLatestValue, useStream } from "../spine/use-stream";
import { useStreamEvent } from "../spine/use-stream-event";
import { useTelemetry } from "../spine/use-telemetry";
import { consoleLogger } from "./console-logger";
import { installTestHost } from "./install-test-host";

/**
 * The four host members whose implementations belong to `@ksp-gonogo/ui-kit`.
 *
 * The augment registry and the `<AugmentSlot>` composition point live in ui-kit,
 * which imports this package, so this package cannot import them back: the edge
 * would be a `^build` cycle. The caller supplies them, and the caller CAN, because
 * ui-kit is published and an Uplink's `test/setup.ts` already imports it.
 *
 * Four values, one import, and TypeScript names any one a caller forgets. It is the
 * same shape as a sdk function taking an injectable seam for the one thing the leaf
 * cannot see, rather than a partial host: everything else here is the real
 * implementation, reached directly.
 *
 * Deliberately NOT solved by having ui-kit register itself with this package at
 * module load. That would be an ordering contract nothing enforces and nothing can
 * see, which is exactly how `SettingsService` constructing a `PerfBudget` at module
 * scope held by luck until the flight layer imported directly and the suite died
 * with "PerfBudget is not a constructor". An explicit parameter cannot fail that
 * way.
 */
export interface UiKitHostPieces {
  /**
   * ui-kit's `<AugmentSlot>` and `registerAugment` are generic over the
   * declaration-merged slot id, and this leaf cannot name `SlotProps` or
   * `AugmentSegmentProps`, so their parameters are accepted as `never` here: a
   * function taking a specific argument IS assignable to one taking `never`
   * (parameters are contravariant), and the narrowing casts happen below rather
   * than at the call site. Typing these as the host members directly would have
   * pushed an `as GonogoHost["AugmentSlot"]` cast into all eight Uplink setup
   * files, which is a worse trade than four casts in one place.
   */
  AugmentSlot: ComponentType<never>;
  clearAugments: () => void;
  getAugmentsForSlot: (slot: string) => unknown[];
  registerAugment: (def: never) => void;
}

/**
 * Install the REAL host for an Uplink's test run.
 *
 * A widget only ever touches sdk shims (`useTelemetry`, `registerComponent`,
 * `useCommand`, …), which delegate to whatever host is installed and throw a named
 * error when none is. So a test has to install one, and every Uplink used to
 * hand-roll its own: nine `test/setup.ts` files each calling `installTestHost` with
 * a partial host "scoped to the subset this client's widget actually calls",
 * assembled by importing the real singletons out of `@ksp-gonogo/core` and
 * `@ksp-gonogo/sitrep-client`, both `private: true`.
 *
 * That is why nine Uplinks each had a `@ksp-gonogo/core` import they could not
 * have: it was never a widget reaching into the app, it was the harness. And the
 * partial-host approach fails in a specific way, repeatedly: re-point one widget
 * hook at the facade and the suite dies with
 * `getHost().registerAugment is not a function`, because that member was not in
 * the subset. The reason to install a WHOLE host is that a test gains nothing from
 * the host lacking members.
 *
 * `GonogoHost` is a full interface and this returns one, so TypeScript requires
 * every member: a new shim on the sdk breaks the build here rather than at a call
 * site months later. `packages/app/src/uplinks/host.ts` builds the same host for
 * the app at boot and is checked the same way, so the two cannot silently diverge
 * in shape, only in wiring.
 *
 * Returns the disposer `installTestHost` returns: call it in `afterEach` if a
 * suite needs the host gone between tests. Most do not, since the host is
 * stateless dispatch and the state lives in the registries `resetRegistries`
 * clears.
 */
export function installRealTestHost(uiKit: UiKitHostPieces): () => void {
  const host: { [K in keyof GonogoHost]: GonogoHost[K] } = {
    registerAugment: uiKit.registerAugment as GonogoHost["registerAugment"],
    getAugmentsForSlot:
      uiKit.getAugmentsForSlot as GonogoHost["getAugmentsForSlot"],
    clearAugments: uiKit.clearAugments,
    AugmentSlot: uiKit.AugmentSlot as GonogoHost["AugmentSlot"],

    // A single unconditional forward of both args, never a conditional call to
    // two different hook invocations: `useTelemetry` already branches internally
    // on whether `key` is present while keeping every hook call unconditional.
    useTelemetry: ((dataSourceIdOrTopic: string, key?: string) =>
      (useTelemetry as (a: string, b?: string) => unknown)(
        dataSourceIdOrTopic,
        key,
      )) as GonogoHost["useTelemetry"],
    useViewUt: () => useViewUt(),
    useCommand: (command) =>
      useCommand(command) as unknown as ReturnType<GonogoHost["useCommand"]>,
    useRouteCommands: (topic) =>
      useRouteCommands(topic) as unknown as ReturnType<
        GonogoHost["useRouteCommands"]
      >,
    useStream: (topic) => useStream(topic),
    useProcessor: ((handle) =>
      useProcessor(handle)) as GonogoHost["useProcessor"],
    useViewClock: () => useViewClock(),
    useActionInput: (handlers) =>
      useActionInput(handlers as Parameters<typeof useActionInput>[0]),
    useDataSources: () => useDataSources(),

    useLatestValue: (topic) => useLatestValue(topic),
    useStreamEvent: (topic, handler) => useStreamEvent(topic, handler),
    useLateTelemetrySubscribe: () =>
      useLateTelemetrySubscribe() as ReturnType<
        GonogoHost["useLateTelemetrySubscribe"]
      >,
    useUtNow: () => useUtNow(),
    useTelemetryStoreOptional: () => useTelemetryStoreOptional(),
    useViewClockOptional: () => useViewClockOptional(),
    getActiveTelemetryClient: () =>
      getActiveTelemetryClient() as ReturnType<
        GonogoHost["getActiveTelemetryClient"]
      >,
    useTelemetryClientOptional: () =>
      useTelemetryClientOptional() as ReturnType<
        GonogoHost["useTelemetryClientOptional"]
      >,

    useReplaySessionActive: () => useReplaySessionActive(),

    getContributionsForSlot: (slot) =>
      getContributionsForSlot(slot) as ReturnType<
        GonogoHost["getContributionsForSlot"]
      >,
    onContributionsChange: (cb) => onContributionsChange(cb),
    clearContributions: () => {
      clearContributions();
    },

    defineUplinkClient: (cfg) => defineUplinkClient(cfg),

    registerSettingsTab: (def) =>
      registerSettingsTab(def as Parameters<typeof registerSettingsTab>[0]),
    registerSetting: (def) =>
      registerSetting(def as Parameters<typeof registerSetting>[0]),

    createPerfBudget: (opts) => new PerfBudget(opts),

    // NOT `api/logger.ts`'s export. That is a Proxy over `getHost().logger`, so
    // installing it here makes every log read the Proxy, which reads the host, which
    // is the Proxy: `RangeError: Maximum call stack size exceeded`, in thirty suites
    // at once. See `./console-logger.ts`.
    logger: consoleLogger,
  };
  return installTestHost(host);
}
