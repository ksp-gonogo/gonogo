import type { HeldGrade, Reading } from "@ksp-gonogo/sitrep-sdk";
import type { DeployedExperiment } from "./parseBases";

/** Props passed to every `deployed-science.experiment` augment, rendered once per experiment card. */
export interface DeployedExperimentContext {
  /** The deployed experiment this card renders, the augment's datum. */
  experiment: DeployedExperiment;
  /** The body the parent base sits on, for context. */
  body: string;
  /**
   * The reading the experiment's figures were drawn from. Only a held reading
   * changes anything; while it is held, draw them as held rather than as
   * current. `heldMarking` from `@ksp-gonogo/ui-kit` gives the mark.
   */
  held: HeldGrade | Reading<unknown> | undefined;
}

// Merged into the sdk's `SlotRegistry`, since a merge against the private `@ksp-gonogo/core` would silently never resolve for an outside author.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface SlotRegistry {
    "deployed-science.experiment": DeployedExperimentContext;
  }
}
