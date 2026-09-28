import type { ComponentType } from "react";
import type { GonogoHost } from "../api/host";
import { getUplinkHandle } from "../api/uplink-handles";
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
import { recordAlarmRequest } from "./recorded-alarm-requests";

/**
 * The four host members whose implementations belong to `@ksp-gonogo/ui-kit`.
 *
 * The augment registry and the `<AugmentSlot>` composition point live in
 * ui-kit, which imports this package, so this package cannot import them back:
 * the edge would be a `^build` cycle. The caller supplies them, and the caller
 * CAN, because ui-kit is published and an Uplink's `test/setup.ts` already
 * imports it.
 *
 * Four values, one import, and TypeScript names any one a caller forgets. It is
 * the same shape as a sdk function taking an injectable seam for the one thing
 * the leaf cannot see, rather than a partial host: everything else here is the
 * real implementation, reached directly.
 *
 * Deliberately NOT solved by having ui-kit register itself with this package at
 * module load. That would be an ordering contract nothing enforces and nothing
 * can see, which is exactly how `SettingsService` constructing a `PerfBudget`
 * at module scope held by luck until the flight layer imported directly and the
 * suite died with "PerfBudget is not a constructor". An explicit parameter
 * cannot fail that way.
 *
 * @category Test hosts
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
 * `useCommand`, ...), which delegate to whatever host is installed and throw a
 * named error when none is. So a test has to install one, and this installs the
 * whole host: a partial one fails with `getHost().<member> is not a function`
 * the first time a widget reaches a member it left out.
 *
 * `GonogoHost` is a full interface and this returns one, so TypeScript requires
 * every member.
 *
 * Returns the disposer `installTestHost` returns: call it in `afterEach` if a
 * suite needs the host gone between tests. Most do not, since the host is
 * stateless dispatch and the state lives in the registries `resetRegistries`
 * clears.
 *
 * @category Test hosts
 */
export function installRealTestHost(uiKit: UiKitHostPieces): () => void {
  const host: { [Key in keyof GonogoHost]: GonogoHost[Key] } = {
    registerAugment: uiKit.registerAugment as GonogoHost["registerAugment"],
    getAugmentsForSlot:
      uiKit.getAugmentsForSlot as GonogoHost["getAugmentsForSlot"],
    clearAugments: uiKit.clearAugments,
    AugmentSlot: uiKit.AugmentSlot as GonogoHost["AugmentSlot"],

    useTelemetry: useTelemetry as GonogoHost["useTelemetry"],
    useViewUt: () => useViewUt(),
    useCommand: ((command: string, options?: { vantage?: string }) =>
      useCommand(command, options)) as GonogoHost["useCommand"],
    // An Uplink's own test run has no peer client, so a call goes straight to
    // the handle, which is what the main screen does too. The station's relayed
    // route is the app's to supply.
    // An Uplink's own test run has no host broadcasting credentials, and the
    // honest answer there is none rather than a fabricated server.
    useHostIceServers: () => ({
      current: () => [],
      onChange: () => () => {},
    }),
    useUplinkRelay: (uplinkId) => (method, args) => {
      const handle = getUplinkHandle<{
        relay?: (method: string, args: unknown) => Promise<unknown>;
      }>(uplinkId);
      if (typeof handle?.relay !== "function") {
        return Promise.reject(
          new Error(`"${uplinkId}" has no relay handle registered`),
        );
      }
      return handle.relay(method, args);
    },
    useRouteCommands: (topic) =>
      useRouteCommands(topic) as unknown as ReturnType<
        GonogoHost["useRouteCommands"]
      >,
    useStream: (topic) => useStream(topic),
    useProcessor: ((handle) =>
      useProcessor(handle)) as GonogoHost["useProcessor"],
    useViewClock: () => useViewClock(),
    // Records rather than creates: see `./recorded-alarm-requests.ts`.
    useAlarmRequest: (owner) => recordAlarmRequest(owner),
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
