// ---------------------------------------------------------------------------
// Drift guard: the @ksp-gonogo/sitrep-sdk author-facing type MIRROR vs core's
// (and, since Phase 0.4, sitrep-client's) real types.
//
// sitrep-sdk is the dependency-graph leaf, so it cannot import core OR
// sitrep-client (either would form a turbo `^build` cycle — core and
// sitrep-client both depend on the sdk already). Its author-facing types are
// therefore mirrored by hand in `mod/sitrep-sdk/src/api/types.ts`. THIS file —
// living in core, which already devDepends on the sdk AND carries a real
// dependency on sitrep-client — is the only place all three sides are
// visible, so it is where every mirror is kept honest: if a real type drifts
// out of structural compatibility with the published facade, this fails
// core's `tsc` typecheck.
//
// Retire this file when the loader work inverts the type source into the leaf
// (the facade then re-exports the real types and there is nothing to mirror).
// ---------------------------------------------------------------------------

import type { StreamStatusValue as ClientStreamStatusValue } from "@ksp-gonogo/sitrep-client";
import type {
  ActionDefinition as SdkActionDefinition,
  AugmentDefinition as SdkAugmentDefinition,
  ComponentDefinition as SdkComponentDefinition,
  ComponentProps as SdkComponentProps,
  ConfigComponentProps as SdkConfigComponentProps,
  PerfBudgetOptions as SdkPerfBudgetOptions,
  StreamStatusValue as SdkStreamStatusValue,
  ThemeDefinition as SdkThemeDefinition,
} from "@ksp-gonogo/sitrep-sdk";
import type { AugmentDefinition as CoreAugmentDefinition } from "./augments";
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
type _Perf = Expect<Assignable<SdkPerfBudgetOptions, CorePerfBudgetOptions>>;
type _PerfBack = Expect<
  Assignable<CorePerfBudgetOptions, SdkPerfBudgetOptions>
>;
// ThemeDefinition mirrors `theme` loosely (the real token type ships from ui-kit,
// not this leaf), so only the read direction — core's concrete theme fits the
// facade view — is asserted.
type _Theme = Expect<Assignable<Core.ThemeDefinition, SdkThemeDefinition>>;

// Stream SPI (Phase 0.4): StreamStatusValue is owned by sitrep-client, not
// core, but core carries a real dependency on sitrep-client so it is visible
// here too — same drift-guard shape as the core-owned types above.
type _StreamStatus = Expect<
  Assignable<SdkStreamStatusValue, ClientStreamStatusValue>
>;
type _StreamStatusBack = Expect<
  Assignable<ClientStreamStatusValue, SdkStreamStatusValue>
>;

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
  _Perf,
  _PerfBack,
  _Theme,
  _StreamStatus,
  _StreamStatusBack,
];
