import {
  AugmentSlot,
  ContributionsProvider,
  clearAugments,
  clearContributions,
  defineUplinkClient,
  getAugmentsForSlot,
  getBody,
  getContributionsForSlot,
  getFogRevealSources,
  getGameHost,
  onContributionsChange,
  onFogRevealSourcesChange,
  PerfBudget,
  registerAugment,
  registerComponent,
  registerFogRevealSource,
  registerSetting,
  registerSettingsTab,
  registerTheme,
  setSetting,
  subscribeSetting,
  useActionInput,
  useDataSources,
  useExecuteAction,
  useSetting,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  useDataSchema,
  useFogMaskCache,
  useReplaySessionActive,
} from "@ksp-gonogo/data";
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
} from "@ksp-gonogo/sitrep-client";
import type { GonogoHost } from "@ksp-gonogo/sitrep-sdk";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";

/**
 * Install the REAL host for an Uplink's test run.
 *
 * A widget only ever touches sdk shims (`useTelemetry`, `registerComponent`,
 * `useCommand`, …), which delegate to whatever host is installed and throw a named
 * error when none is. So a test has to install one, and until now every Uplink
 * hand-rolled its own: nine `test/setup.ts` files each calling `installTestHost`
 * with a partial host "scoped to the subset this client's widget actually calls",
 * assembled by importing the real singletons out of `core` and `sitrep-client`.
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
export function installRealTestHost(): () => void {
  // The GonogoHost interface uses the sdk's SELF-CONTAINED author-facing types
  // (the sdk leaf must not import core), structurally aligned with core's
  // internal ones but nominally distinct. The casts at this boundary are the
  // adapter between the two worlds: the members ARE the real singletons, so they
  // are honest (same runtime, mirrored type surface) rather than papering over a
  // shape mismatch. Same reasoning, same casts, as the app's own builder.
  const host: { [K in keyof GonogoHost]: GonogoHost[K] } = {
    registerComponent: (def) =>
      registerComponent(def as Parameters<typeof registerComponent>[0]),
    registerTheme: (def) =>
      registerTheme(def as Parameters<typeof registerTheme>[0]),
    registerAugment: (def) =>
      registerAugment(def as unknown as Parameters<typeof registerAugment>[0]),
    registerFogRevealSource: (def) =>
      registerFogRevealSource(
        def as Parameters<typeof registerFogRevealSource>[0],
      ),

    useExecuteAction: (dataSourceId) => useExecuteAction(dataSourceId),
    // A single unconditional forward of both args, never a conditional call to
    // two different hook invocations: core's `useTelemetry` already branches
    // internally on whether `key` is present while keeping every hook call
    // unconditional.
    useTelemetry: ((dataSourceIdOrTopic: string, key?: string) =>
      (useTelemetry as (a: string, b?: string) => unknown)(
        dataSourceIdOrTopic,
        key,
      )) as GonogoHost["useTelemetry"],
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

    useDataSchema: (sourceId) => useDataSchema(sourceId),
    useReplaySessionActive: () => useReplaySessionActive(),

    getGameHost: () => getGameHost(),
    subscribeSetting: (key, cb) => subscribeSetting(key, cb),
    setSetting: (key, value) => {
      setSetting(key, value);
    },

    getBody: (id) => getBody(id) as ReturnType<GonogoHost["getBody"]>,
    getAugmentsForSlot: (slot) =>
      getAugmentsForSlot(slot) as ReturnType<GonogoHost["getAugmentsForSlot"]>,
    clearAugments: () => {
      clearAugments();
    },
    getFogRevealSources: () => getFogRevealSources(),
    onFogRevealSourcesChange: (cb) => onFogRevealSourcesChange(cb),
    getContributionsForSlot: (slot) =>
      getContributionsForSlot(slot) as ReturnType<
        GonogoHost["getContributionsForSlot"]
      >,
    onContributionsChange: (cb) => onContributionsChange(cb),
    clearContributions: () => {
      clearContributions();
    },
    ContributionsProvider:
      ContributionsProvider as GonogoHost["ContributionsProvider"],
    useFogMaskCache: () =>
      useFogMaskCache() as ReturnType<GonogoHost["useFogMaskCache"]>,

    defineUplinkClient: (cfg) => defineUplinkClient(cfg),

    registerSettingsTab: (def) =>
      registerSettingsTab(def as Parameters<typeof registerSettingsTab>[0]),
    registerSetting: (def) =>
      registerSetting(def as Parameters<typeof registerSetting>[0]),
    useSetting: ((key: string, defaultValue: unknown) =>
      useSetting(key, defaultValue)) as GonogoHost["useSetting"],

    AugmentSlot: AugmentSlot as GonogoHost["AugmentSlot"],
    createPerfBudget: (opts) => new PerfBudget(opts),

    logger,
  };
  return installTestHost(host);
}
