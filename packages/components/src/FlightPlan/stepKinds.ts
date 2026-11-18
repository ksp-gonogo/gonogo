import type { PlanStepKind } from "@ksp-gonogo/sitrep-sdk";
import {
  getContributionsForSlot,
  onContributionsChange,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { useSyncExternalStore } from "react";

const SLOT = "flight-plan.steps";
let cache: readonly PlanStepKind[] | undefined;
onContributionsChange(() => {
  cache = undefined;
});

/*
 * A step kind does not change with the flight, so its contribution names no
 * Topics and is computed here once per registration rather than per frame.
 */
function read(): readonly PlanStepKind[] {
  if (cache) return cache;
  const all = getContributionsForSlot(SLOT)
    .flatMap((c) => c.compute({}) ?? [])
    .filter(isStepKind);
  cache = [...all.filter((k) => !k.group), ...all.filter((k) => k.group)];
  return cache;
}

/* The registry erases each slot's entry type, so an entry is checked for the fields every kind carries. */
function isStepKind(
  entry: Record<string, unknown>,
): entry is Record<string, unknown> & PlanStepKind {
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.inputs === "object" &&
    entry.inputs !== null
  );
}

/** The step kind with this id, or `undefined`. */
export function stepKind(id: string): PlanStepKind | undefined {
  return read().find((k) => k.id === id);
}

/** Every step kind contributed to the Flight Plan, core's first and then each group in the order contributed. */
export function useStepKinds(): readonly PlanStepKind[] {
  return useSyncExternalStore(onContributionsChange, read, read);
}
