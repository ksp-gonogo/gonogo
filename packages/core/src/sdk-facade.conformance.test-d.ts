// ---------------------------------------------------------------------------
// Drift guard: the @ksp-gonogo/sitrep-sdk author-facing type MIRROR vs core's
// real types.
//
// sitrep-sdk is the dependency-graph leaf, so it cannot import core (that would
// be a turbo `^build` cycle). Its author-facing types are therefore mirrored by
// hand in `mod/sitrep-sdk/src/api/types.ts`. THIS file — living in core, which
// already devDepends on the sdk — is the only place both sides are visible, so
// it is where the mirror is kept honest: if a core type drifts out of structural
// compatibility with the published facade, this fails core's `tsc` typecheck.
//
// Retire this file when the loader work inverts the type source into the leaf
// (the facade then re-exports core's real types and there is nothing to mirror).
// ---------------------------------------------------------------------------

import type {
  ActionDefinition as SdkActionDefinition,
  AugmentDefinition as SdkAugmentDefinition,
  ComponentDefinition as SdkComponentDefinition,
  ComponentProps as SdkComponentProps,
  ConfigComponentProps as SdkConfigComponentProps,
  KosScriptDefinition as SdkKosScriptDefinition,
  PerfBudgetOptions as SdkPerfBudgetOptions,
  ThemeDefinition as SdkThemeDefinition,
} from "@ksp-gonogo/sitrep-sdk";
import type { AugmentDefinition as CoreAugmentDefinition } from "./augments";
import type { KosScriptDefinition as CoreKosScriptDefinition } from "./kos/scriptRegistry";
import type { PerfBudgetOptions as CorePerfBudgetOptions } from "./perf/PerfBudget";
import type * as Core from "./types";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

// Registration-boundary direction (facade value must satisfy the real API): the
// facade type is assignable to core's, so an author's def is accepted by the
// app's real registerX at the injection seam.
type _Component = Expect<
  Assignable<SdkComponentDefinition, Core.ComponentDefinition>
>;
type _ComponentBack = Expect<
  Assignable<Core.ComponentDefinition, SdkComponentDefinition>
>;
type _ComponentProps = Expect<
  Assignable<SdkComponentProps, Core.ComponentProps>
>;
type _ComponentPropsBack = Expect<
  Assignable<Core.ComponentProps, SdkComponentProps>
>;
type _ConfigProps = Expect<
  Assignable<SdkConfigComponentProps, Core.ConfigComponentProps>
>;
type _Action = Expect<Assignable<SdkActionDefinition, Core.ActionDefinition>>;
type _ActionBack = Expect<
  Assignable<Core.ActionDefinition, SdkActionDefinition>
>;
type _Augment = Expect<Assignable<SdkAugmentDefinition, CoreAugmentDefinition>>;
type _AugmentBack = Expect<
  Assignable<CoreAugmentDefinition, SdkAugmentDefinition>
>;
type _Kos = Expect<Assignable<SdkKosScriptDefinition, CoreKosScriptDefinition>>;
type _KosBack = Expect<
  Assignable<CoreKosScriptDefinition, SdkKosScriptDefinition>
>;
type _Perf = Expect<Assignable<SdkPerfBudgetOptions, CorePerfBudgetOptions>>;
type _PerfBack = Expect<
  Assignable<CorePerfBudgetOptions, SdkPerfBudgetOptions>
>;
// ThemeDefinition mirrors `theme` loosely (the real token type ships from ui-kit,
// not this leaf), so only the read direction — core's concrete theme fits the
// facade view — is asserted.
type _Theme = Expect<Assignable<Core.ThemeDefinition, SdkThemeDefinition>>;

// Keep the aliases "used" under noUnusedLocals.
export type _SdkFacadeConformance = [
  _Component,
  _ComponentBack,
  _ComponentProps,
  _ComponentPropsBack,
  _ConfigProps,
  _Action,
  _ActionBack,
  _Augment,
  _AugmentBack,
  _Kos,
  _KosBack,
  _Perf,
  _PerfBack,
  _Theme,
];
