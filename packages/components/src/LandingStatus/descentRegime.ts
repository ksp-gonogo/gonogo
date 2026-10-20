import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { useRef } from "react";

/** Distance of the drag-to-weight ratio from unity inside which the mod calls a descent at-terminal. */
const AT_TERMINAL_TOLERANCE = 0.05;

/**
 * How far past the at-terminal tolerance the ratio must go before a descent held at-terminal is relabelled. Under full chutes the ratio scatters between 0.83 and 1.12 sample to sample while the real descent holds steady, so the label leaves at-terminal only beyond 0.80 or 1.20.
 */
const AT_TERMINAL_EXIT_MARGIN = 0.15;

/**
 * The regime label to show, given the one the mod reported and the drag-to-weight ratio behind it. A descent enters at-terminal the moment the mod says so and leaves it only once the ratio is past the tolerance plus the exit margin, so scatter around the edge does not flip the label. Any other label, or a missing ratio, is shown as reported.
 */
export function holdRegime(
  held: string | undefined,
  reported: string,
  ratio: Value<"1"> | null | undefined,
): string {
  if (held !== "at-terminal" || reported === "at-terminal") return reported;
  if (ratio == null || !ratio.isFinite()) return reported;
  const exit = AT_TERMINAL_TOLERANCE + AT_TERMINAL_EXIT_MARGIN;
  return ratio.minus(1).abs().lessThanOrEqual(exit) ? held : reported;
}

/** The regime label of {@link holdRegime}, remembering the label it showed last. Null while the mod reports no regime. */
export function useHeldRegime(
  reported: string | null | undefined,
  ratio: Value<"1"> | null | undefined,
): string | null {
  const held = useRef<string | undefined>(undefined);
  const shown =
    reported == null || reported === ""
      ? undefined
      : holdRegime(held.current, reported, ratio);
  held.current = shown;
  return shown ?? null;
}
