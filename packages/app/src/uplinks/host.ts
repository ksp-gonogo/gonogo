// Install the injected SDK host at app boot (design §2.2c / sdk-one-import §4.3).
//
// The published `@ksp-gonogo/sitrep-sdk` exposes its stateful author-facing
// surface, every `registerX`, every hook, `AugmentSlot`, `createPerfBudget`, as
// SHIMS that look up `globalThis.__GONOGO_SDK__` and throw a NAMED error when it
// is absent (mod/sitrep-sdk/src/api/host.ts). This module builds the real host
// from the app's OWN singletons and installs it, so an Uplink that imports the sdk
// facade resolves to the app's single registry / contexts rather than a dead copy.
//
// This is belt-and-braces alongside the import map: a correctly-externalised
// Uplink resolves the sdk specifier to the ext-sitrep-sdk chunk directly; a
// mis-bundled one still finds the host here instead of silently failing. Because
// the app imports @ksp-gonogo/core / sitrep-client directly and Rollup keeps each
// in one chunk, these references ARE the same instances the ext-* chunks re-export.

import {
  AugmentSlot,
  clearAugments,
  clearContributions,
  defineUplinkClient,
  getAugmentsForSlot,
  getContributionsForSlot,
  onContributionsChange,
  PerfBudget,
  registerAugment,
  registerSetting,
  registerSettingsTab,
  useActionInput,
  useDataSources,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useReplaySessionActive } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";
import {
  getActiveTelemetryClient,
  useCommand,
  useLatestValue,
  useLateTelemetrySubscribe,
  useProcessor,
  useRouteCommands,
  useStream,
  useStreamEvent,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  useUtNow,
  useViewClock,
  useViewClockOptional,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  GONOGO_HOST_KEY,
  type GonogoHost,
  hasHost,
} from "@ksp-gonogo/sitrep-sdk";

/** Build the host facade over the app's single registry + context instances. */
export function buildGonogoHost(): GonogoHost {
  // The GonogoHost interface (in @ksp-gonogo/sitrep-sdk) intentionally uses the
  // sdk's SELF-CONTAINED author-facing types (design: the sdk leaf must not import
  // core), which are structurally aligned with core's internal types but nominally
  // distinct. This builder is the adapter between the two worlds, the members ARE
  // the app's real singleton functions, so the casts at the boundary are honest
  // (same runtime, mirrored type surface), not a papered-over shape mismatch.
  type Loose = {
    [K in keyof GonogoHost]: GonogoHost[K];
  };
  const host: Loose = {
    registerAugment: (def) =>
      registerAugment(def as unknown as Parameters<typeof registerAugment>[0]),

    useExecuteAction: (dataSourceId) => useExecuteAction(dataSourceId),
    // Overloaded on the sdk side (canonical one-arg Topic read, and the
    // retired useDataValue's legacy two-arg DataSourceRegistry read carried
    // over onto this same name: see GonogoHost.useTelemetry's doc). Real
    // core `useTelemetry` already branches internally on whether `key` is
    // present while keeping every hook call unconditional (its own
    // `(dataSourceId, key?)` implementation signature), so this is a single,
    // unconditional forward of both args: never a conditional call to two
    // different hook invocations, which the rules-of-hooks lint (rightly)
    // flags even though a given call site's arity never changes across
    // renders. The loose cast mirrors core's own internal implementation
    // signature against the host's overloaded declared type.
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

    getAugmentsForSlot: (slot) =>
      getAugmentsForSlot(slot) as ReturnType<GonogoHost["getAugmentsForSlot"]>,
    clearAugments: () => {
      clearAugments();
    },
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

    AugmentSlot: AugmentSlot as GonogoHost["AugmentSlot"],
    createPerfBudget: (opts) => new PerfBudget(opts),

    logger,
  };
  return host;
}

/**
 * Install the host on `globalThis.__GONOGO_SDK__` once, before any Uplink bundle
 * is `import()`ed. Idempotent, a second call is a no-op so a StrictMode double
 * boot doesn't churn the global.
 */
export function installGonogoHost(): void {
  if (hasHost()) return;
  (globalThis as unknown as Record<string, unknown>)[GONOGO_HOST_KEY] =
    buildGonogoHost();
  logger.info("[uplink-loader] SDK host installed on globalThis");
}
