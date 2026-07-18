// Install the injected SDK host at app boot (design §2.2c / sdk-one-import §4.3).
//
// The published `@ksp-gonogo/sitrep-sdk` exposes its stateful author-facing
// surface — every `registerX`, every hook, `AugmentSlot`, `createPerfBudget` — as
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
  PerfBudget,
  registerAugment,
  registerComponent,
  registerDataSource,
  registerKosScript,
  registerTheme,
  useActionInput,
  useDataSources,
  useDataValue,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { useCommand, useStream, useViewClock } from "@ksp-gonogo/sitrep-client";
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
  // distinct. This builder is the adapter between the two worlds — the members ARE
  // the app's real singleton functions, so the casts at the boundary are honest
  // (same runtime, mirrored type surface), not a papered-over shape mismatch.
  type Loose = {
    [K in keyof GonogoHost]: GonogoHost[K];
  };
  const host: Loose = {
    registerComponent: (def) =>
      registerComponent(def as Parameters<typeof registerComponent>[0]),
    registerDataSource: (def) =>
      registerDataSource(def as Parameters<typeof registerDataSource>[0]),
    registerTheme: (def) =>
      registerTheme(def as Parameters<typeof registerTheme>[0]),
    registerKosScript: (def) =>
      registerKosScript(def as Parameters<typeof registerKosScript>[0]),
    registerAugment: (def) =>
      registerAugment(def as unknown as Parameters<typeof registerAugment>[0]),

    useDataValue: (dataSourceId, key) => useDataValue(dataSourceId, key),
    useExecuteAction: (dataSourceId) => useExecuteAction(dataSourceId),
    useTelemetry: (topic) => useTelemetry(topic),
    useCommand: (command) =>
      useCommand(command) as unknown as ReturnType<GonogoHost["useCommand"]>,
    useStream: (topic) => useStream(topic),
    useViewClock: () => useViewClock(),
    useActionInput: (handlers) =>
      useActionInput(handlers as Parameters<typeof useActionInput>[0]),
    useDataSources: () => useDataSources(),

    AugmentSlot: AugmentSlot as GonogoHost["AugmentSlot"],
    createPerfBudget: (opts) => new PerfBudget(opts),

    logger,
  };
  return host;
}

/**
 * Install the host on `globalThis.__GONOGO_SDK__` once, before any Uplink bundle
 * is `import()`ed. Idempotent — a second call is a no-op so a StrictMode double
 * boot doesn't churn the global.
 */
export function installGonogoHost(): void {
  if (hasHost()) return;
  (globalThis as unknown as Record<string, unknown>)[GONOGO_HOST_KEY] =
    buildGonogoHost();
  logger.info("[uplink-loader] SDK host installed on globalThis");
}
