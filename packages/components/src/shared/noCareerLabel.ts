import { GameMode } from "@ksp-gonogo/sitrep-sdk";

/**
 * The sentence for a career widget in a save whose mode has no career data,
 * naming what that mode lacks, or null where the mode says nothing about it.
 * Used by the Administration Building and the Contract Manager in place of a
 * loading state.
 */
export function noCareerLabel(
  mode: GameMode | undefined,
  lacks: string,
): string | null {
  if (mode === GameMode.Science) return `Science mode has no ${lacks}`;
  if (mode === GameMode.Sandbox) return `Sandbox has no ${lacks}`;
  return null;
}
