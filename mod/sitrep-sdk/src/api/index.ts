// ---------------------------------------------------------------------------
// The curated author-facing barrel — PROPOSAL (design D-B/D-D).
//
// This is the one framework/data/hook surface a third-party Uplink author
// imports. It carries:
//   • the author-facing TYPES (self-contained here — see ./types on why the leaf
//     cannot re-export them from core), and
//   • fail-loud SHIMS for the stateful members (every registerX, the hooks),
//     which delegate to the app-injected host and throw a named error when it is
//     absent (design §4.3 / D-A). No stateful member imports core, so the packed
//     sdk never bundles a second registry — the whole point of the design.
//
// The EXPORT LIST below is what the operator reviews for D-D before the first
// external Uplink is published. It is NOT frozen. The api-shape gate
// (./api-shape.gate.test.ts) records it so any change is deliberate.
//
// First-party in-tree code is UNAFFECTED: it imports @ksp-gonogo/core /
// sitrep-client directly (same singletons), never these shims.
// ---------------------------------------------------------------------------

import type { ComponentType } from "react";
import { createElement } from "react";
import type { TopicId, TopicPayload } from "../topics";
import { getHost } from "./host";
import type {
  ActionDefinition,
  ActionHandlers,
  AugmentDefinition,
  ComponentDefinition,
  KosScriptDefinition,
  PerfBudgetHandle,
  PerfBudgetOptions,
  ThemeDefinition,
} from "./types";

// --- Author-facing types (re-exported real, erased at runtime) --------------

export type { GonogoHost } from "./host";
export { GONOGO_HOST_KEY, hasHost } from "./host";
export type {
  ActionDefinition,
  ActionHandlers,
  ActionInputKind,
  ActionInputPayload,
  AugmentDefinition,
  AugmentSettingField,
  ComponentBehavior,
  ComponentDefinition,
  ComponentProps,
  ComponentRequirement,
  ConfigComponentProps,
  DataRequirement,
  KosScriptDefinition,
  KosScriptField,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SlotId,
  SlotProps,
  SlotRegistry,
  ThemeDefinition,
  UseCommandResult,
} from "./types";

// --- Registration shims (stateful → injected host) --------------------------

export const registerComponent = <TConfig = Record<string, unknown>>(
  def: ComponentDefinition<TConfig>,
): void => getHost().registerComponent(def);

export const registerDataSource = (def: unknown): void =>
  getHost().registerDataSource(def);

export const registerTheme = (def: ThemeDefinition): void =>
  getHost().registerTheme(def);

export const registerKosScript = (def: KosScriptDefinition): void =>
  getHost().registerKosScript(def);

export const registerAugment = <S extends string>(
  def: AugmentDefinition<S>,
): void => getHost().registerAugment(def);

// --- Hook shims (stateful → injected host) ----------------------------------

export function useDataValue<T = unknown>(
  dataSourceId: string,
  key: string,
): T | undefined {
  return getHost().useDataValue<T>(dataSourceId, key);
}

export function useExecuteAction(
  dataSourceId: string,
): (action: string) => Promise<void> {
  return getHost().useExecuteAction(dataSourceId);
}

export function useTelemetry<T extends TopicId>(
  topic: T,
): TopicPayload<T> | undefined {
  return getHost().useTelemetry(topic);
}

export function useCommand(command: string) {
  return getHost().useCommand(command);
}

export function useStream<T>(topic: string): T | undefined {
  return getHost().useStream<T>(topic);
}

export function useViewClock(): unknown {
  return getHost().useViewClock();
}

export function useActionInput<TActions extends readonly ActionDefinition[]>(
  handlers: ActionHandlers<TActions>,
): void {
  getHost().useActionInput(handlers);
}

export function useDataSources(): unknown {
  return getHost().useDataSources();
}

// --- Component + class shims ------------------------------------------------

/**
 * The slot composition point a base widget drops in for augments to fill.
 * Resolves to the host's real `AugmentSlot` so it reads the app's single augment
 * registry; `createElement` (not a direct call) keeps React's hook rules intact.
 */
export const AugmentSlot: ComponentType<{
  name: string;
  props?: Record<string, unknown>;
}> = (props) => createElement(getHost().AugmentSlot, props);

/**
 * Construct a performance budget on the app's single registry (design: every
 * new data source MUST register one). A factory, not a re-exported class, so the
 * budget self-registers into the host's registry rather than a bundled copy.
 */
export function createPerfBudget(opts: PerfBudgetOptions): PerfBudgetHandle {
  return getHost().createPerfBudget(opts);
}
