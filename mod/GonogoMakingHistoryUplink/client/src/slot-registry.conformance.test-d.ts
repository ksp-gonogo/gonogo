/**
 * Drift guard: the source component must accept exactly the props the sdk's `objectives.source` slot passes, so a change to the slot's mirror breaks this file rather than a load in the app.
 */

import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import type { ComponentProps } from "react";
import type { MissionObjectivesSource } from "./ObjectivesSource";

type Assignable<Left, Right> = Left extends Right ? true : false;
type Expect<Condition extends true> = Condition;

type _AcceptsSlotProps = Expect<
  Assignable<
    SlotProps<"objectives.source">,
    ComponentProps<typeof MissionObjectivesSource>
  >
>;
