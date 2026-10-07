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
 * The four parts of a test host that come from `@ksp-gonogo/ui-kit`, which
 * {@link installRealTestHost} takes because this package cannot import them.
 * Pass them from your test setup, where ui-kit is already imported.
 *
 * @category Test hosts
 */
export interface UiKitHostPieces {
  // Typed `never` so ui-kit's slot-generic functions are assignable without a cast at each call site; the casts happen in installRealTestHost.
  /** ui-kit's `AugmentSlot`. */
  AugmentSlot: ComponentType<never>;
  /** ui-kit's `clearAugments`. */
  clearAugments: () => void;
  /** ui-kit's `getAugmentsForSlot`. */
  getAugmentsForSlot: (slot: string) => unknown[];
  /** ui-kit's `registerAugment`. */
  registerAugment: (def: never) => void;
}

/**
 * Installs the app's own host for an Uplink's tests, so widgets that call
 * {@link useTelemetry}, {@link registerComponent}, {@link useCommand} and the
 * rest work as they do in the app. Without a host they throw.
 *
 * Call it once, in the test setup file. It returns a function that removes the
 * host again, which most suites never need: the host keeps no state of its
 * own, so there is nothing to clear between tests.
 *
 * @example The setup file a client's `vitest.config.ts` names in `setupFiles`
 * ```ts
 * import { installDomStubs, installRealTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
 * import {
 *   AugmentSlot,
 *   clearAugments,
 *   getAugmentsForSlot,
 *   registerAugment,
 * } from "@ksp-gonogo/ui-kit";
 *
 * installDomStubs();
 * // Here and not in a beforeEach: registerComponent runs when a widget's module loads, which is before any hook.
 * installRealTestHost({
 *   AugmentSlot,
 *   clearAugments,
 *   getAugmentsForSlot,
 *   registerAugment,
 * });
 * ```
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
