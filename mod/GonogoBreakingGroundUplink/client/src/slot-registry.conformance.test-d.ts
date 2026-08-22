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

import type { SlotProps as SdkSlotProps } from "@ksp-gonogo/sitrep-sdk";
import type { DeployedExperimentContext } from "./DeployedScience";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

type _DeployedSections = Expect<
  Assignable<
    SdkSlotProps<"deployed-science.experiment">,
    DeployedExperimentContext
  >
>;
type _DeployedSectionsBack = Expect<
  Assignable<
    DeployedExperimentContext,
    SdkSlotProps<"deployed-science.experiment">
  >
>;
