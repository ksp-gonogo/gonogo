// ---------------------------------------------------------------------------
// The injected-host lookup (design §4.3, decision D-A: fail-loud shim).
//
// The stateful author-facing surface — every `registerX`, every hook — cannot
// be a bundled re-export of `@ksp-gonogo/core`: N copies of core's module-global
// registries and React contexts fail SILENTLY (a widget registers into a Map the
// app never reads). Instead the published sitrep-sdk exposes SHIMS that resolve
// to the app's single instance at runtime, looked up on `globalThis`.
//
// The app installs the real implementation once at boot
// (`globalThis.__GONOGO_SDK__ = <facade>`) — that wiring is the loader task and
// is deliberately NOT built here. Until it exists, calling a stateful shim throws
// a NAMED error instead of failing silently: the project's single scariest
// failure mode (a dead registry) becomes a thrown error with the fix in its
// message. Tests inject a host via `@ksp-gonogo/sitrep-sdk/testing`.
// ---------------------------------------------------------------------------

import type { Logger } from "@ksp-gonogo/logger";
import type { ComponentType } from "react";
import type { TopicId, TopicPayload } from "../topics";
import type {
  ActionDefinition,
  ActionHandlers,
  AugmentDefinition,
  ComponentDefinition,
  KosScriptDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  ThemeDefinition,
  UseCommandResult,
} from "./types";

/**
 * The surface the gonogo app injects at boot. Every member here is stateful —
 * it must resolve to the app's single registry / context instance, never a
 * bundled copy. Stateless helpers (wire types, `parseServerMessage`, `TOPIC_IDS`)
 * are NOT here: they are real, published bytes re-exported directly from the sdk.
 */
export interface GonogoHost {
  registerComponent<TConfig = Record<string, unknown>>(
    def: ComponentDefinition<TConfig>,
  ): void;
  registerDataSource(def: unknown): void;
  registerTheme(def: ThemeDefinition): void;
  registerKosScript(def: KosScriptDefinition): void;
  registerAugment<S extends string>(def: AugmentDefinition<S>): void;

  useDataValue<T = unknown>(dataSourceId: string, key: string): T | undefined;
  useExecuteAction(dataSourceId: string): (action: string) => Promise<void>;
  useTelemetry<T extends TopicId>(topic: T): TopicPayload<T> | undefined;
  useCommand(command: string): UseCommandResult;
  useStream<T>(topic: string): T | undefined;
  useViewClock(): unknown;
  useActionInput<TActions extends readonly ActionDefinition[]>(
    handlers: ActionHandlers<TActions>,
  ): void;
  useDataSources(): unknown;

  AugmentSlot: ComponentType<{ name: string; props?: Record<string, unknown> }>;
  createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle;

  /**
   * The app's single logger instance (ring buffer, session id, Axiom
   * transport installed at boot). Never bundle @ksp-gonogo/logger's
   * `logger` export directly — a second copy is console-only and never
   * reaches the shared buffer or Axiom.
   */
  logger: Logger;
}

/** The single global slot the app populates at boot. */
export const GONOGO_HOST_KEY = "__GONOGO_SDK__" as const;

interface HostGlobal {
  [GONOGO_HOST_KEY]?: GonogoHost;
}

/**
 * Resolve the injected host, or throw a named, actionable error. The message
 * names the package and states the fix (mark the specifier `external`) so a
 * mis-bundled Uplink fails loud at first registration rather than vanishing.
 */
export function getHost(): GonogoHost {
  const host = (globalThis as unknown as HostGlobal)[GONOGO_HOST_KEY];
  if (!host) {
    throw new Error(
      "@ksp-gonogo/sitrep-sdk: the gonogo host has not been installed. " +
        "This package's stateful surface (registerComponent, the hooks, …) is " +
        "runtime-injected by the app — mark @ksp-gonogo/sitrep-sdk `external` in " +
        "your bundle so it resolves to the host, and do not bundle a second copy. " +
        "In tests, install a host with @ksp-gonogo/sitrep-sdk/testing.",
    );
  }
  return host;
}

/** True when a host is installed. Lets a shim probe without throwing. */
export function hasHost(): boolean {
  return Boolean((globalThis as unknown as HostGlobal)[GONOGO_HOST_KEY]);
}

/**
 * Internal: install / clear the host. Public installation is the app's job (at
 * boot) and tests' job (via the `/testing` subpath) — this is the shared plumbing
 * both use. Not part of the author-facing barrel.
 */
export function __setGonogoHost(host: GonogoHost | undefined): void {
  (globalThis as unknown as HostGlobal)[GONOGO_HOST_KEY] = host;
}
