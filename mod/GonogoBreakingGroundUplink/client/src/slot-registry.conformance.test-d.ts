// ---------------------------------------------------------------------------
// Drift guard: the `@ksp-gonogo/sitrep-sdk` slot-registry MIRROR
// (`mod/sitrep-sdk/src/api/slots.ts`) vs the real widget-owned
// `DeployedExperimentContext` type declared in this package.
//
// Split out of `@ksp-gonogo/components`'s own
// `slot-registry.conformance.test-d.ts` alongside the Breaking Ground uplink
// extraction: DeployedScience moved here, so this package (which
// devDepends on the sdk AND owns the real type) is now the one place both
// sides are visible for THIS slot; see the components-side file's own doc
// comment for the full facade-sealing-gap rationale (every other widget's
// slot-context conformance check still lives there).
//
// Checked bidirectionally (same convention `packages/core/src/
// sdk-facade.conformance.test-d.ts` and the components-side file use): an
// augment authored against the sdk's mirrored `SlotProps<S>` must satisfy
// the real widget's `registerAugment`/`<AugmentSlot>` call (mirror -> real),
// and a real context value read back must satisfy the sdk-typed author view
// (real -> mirror).
// ---------------------------------------------------------------------------

// Type-only, unused-looking import: forces `@ksp-gonogo/core`'s declarations
// into this isolated `tsconfig.test-d.json` program so DeployedScience's own
// `declare module "@ksp-gonogo/core" { interface SlotRegistry { ... } }`
// augmentation (index.tsx) can resolve its target module. Nothing else in
// this file's import graph reaches a real `@ksp-gonogo/core` import (unlike
// the components-side sibling file, which transitively does via its many
// OTHER widget imports): the same "type-only import pulls in a SlotRegistry
// merge" idiom other Uplink client packages in this repo already use for
// the same reason.
import type {} from "@ksp-gonogo/core";
import type { SlotProps as SdkSlotProps } from "@ksp-gonogo/sitrep-sdk";
import type { DeployedExperimentContext } from "./DeployedScience";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

type _DeployedSections = Expect<
  Assignable<
    SdkSlotProps<"deployed-science.sections">,
    DeployedExperimentContext
  >
>;
type _DeployedSectionsBack = Expect<
  Assignable<
    DeployedExperimentContext,
    SdkSlotProps<"deployed-science.sections">
  >
>;
