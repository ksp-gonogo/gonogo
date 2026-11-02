import type { ReadingState } from "@ksp-gonogo/sitrep-client";
import { useState } from "react";
import {
  FIRST_LEVEL,
  followingLevel,
  hasLevel,
  LEVELS_FOR,
  type LevelInput,
  nextLevel,
  previousLevel,
  type RendezvousLevel,
  type TargetClass,
} from "./levels";

/**
 * The level the view is at: the one chosen from where the target is, or the
 * one the operator stepped to by hand, which holds until the chosen level
 * itself changes. The specialised levels assert something about now, so a
 * target that is not currently observed is always Far, which can state its age.
 */
export function useRendezvousLevel(params: {
  autoSwitch: boolean;
  target: TargetClass;
  input: Omit<LevelInput, "target">;
  targetState: ReadingState;
}): {
  level: RendezvousLevel;
  levels: readonly RendezvousLevel[];
  setLevel: (level: RendezvousLevel) => void;
  stepIn: () => void;
  stepOut: () => void;
} {
  const { autoSwitch, target, input, targetState } = params;
  // `serial` counts the changes of the view's own choice, so a hand-picked level lapses for good when one happens, even if the choice later returns to the level it was made under.
  const [autoState, setAuto] = useState<{
    level: RendezvousLevel;
    serial: number;
  }>({
    level: FIRST_LEVEL,
    serial: 0,
  });
  const auto = autoState.level;
  // A hand-picked level is held against the choice it was made under, so it lapses by itself when that choice moves on.
  const [manual, setManual] = useState<{
    level: RendezvousLevel;
    serial: number;
    target: TargetClass;
  } | null>(null);

  const observed = targetState === "observed";
  const { range, dockingAvailable, rangeInSoi, pathEntersBody } = input;
  // Derived while rendering, not in an effect, so the first drawn frame is already at the right level and the turret has nothing to animate on arrival.
  const wanted =
    !autoSwitch || !observed
      ? FIRST_LEVEL
      : nextLevel(auto, {
          target,
          range,
          dockingAvailable,
          rangeInSoi,
          pathEntersBody,
        });
  if (wanted !== auto) setAuto({ level: wanted, serial: autoState.serial + 1 });

  const held =
    manual !== null &&
    manual.serial === autoState.serial &&
    manual.target === target &&
    hasLevel(target, manual.level)
      ? manual.level
      : null;
  const level = held ?? (hasLevel(target, auto) ? auto : FIRST_LEVEL);
  const pick = (next: RendezvousLevel) =>
    setManual({ level: next, serial: autoState.serial, target });
  return {
    level,
    levels: LEVELS_FOR[target],
    setLevel: pick,
    stepIn: () => {
      const next = followingLevel(target, level);
      if (next !== null) pick(next);
    },
    stepOut: () => {
      const prev = previousLevel(target, level);
      if (prev !== null) pick(prev);
    },
  };
}
