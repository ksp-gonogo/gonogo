import { withoutReckoning } from "@ksp-gonogo/sitrep-client";
import { stillTrue, type TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { closingRateReading, rangeReading } from "../shared/dockAngles";
import { targetPickerTopics } from "./topics";
import { useClearTarget } from "./useClearTarget";

const NAME_MAX = 12;

/** The target's name cut to what a tile row can hold. */
function nameLabel(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= NAME_MAX
    ? trimmed
    : `${trimmed.slice(0, NAME_MAX - 3).trimEnd()}...`;
}

/**
 * The current target's name over its range, with the closing rate under it
 * where the tile has the room. With no target set the tile says so. The
 * clear-target action stays bound, so a key still clears the target.
 */
export function useTargetPickerEssentials(): readonly TinyEssential[] {
  useClearTarget();
  const targetReading = targetPickerTopics.useTelemetry("vessel.target");
  // The model is dropped: a range drawn beside a name must be one that was measured.
  const target = stillTrue(withoutReckoning(targetReading), undefined);
  if (target?.name === undefined) return [{ label: "TARGET", word: "NONE" }];
  return [
    {
      label: nameLabel(target.name),
      value: rangeReading(targetReading.relativePosition),
    },
    {
      label: "Closing",
      value: closingRateReading(
        targetReading.relativePosition,
        targetReading.relativeVelocity,
      ),
      decimals: 2,
    },
  ];
}
