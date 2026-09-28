/**
 * Drift guard: the sdk's slot-registry mirror (`mod/sitrep-sdk/src/api/slots.ts`) against the real `DeployedExperimentContext`.
 * Checked in both directions, since an augment written against the mirror must satisfy the real slot and the real context must satisfy the author's view.
 */

import type { SlotProps as SdkSlotProps } from "@ksp-gonogo/sitrep-sdk";
import type { DeployedExperimentContext } from "./DeployedScience";

type Assignable<Left, Right> = Left extends Right ? true : false;
type Expect<Condition extends true> = Condition;

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
