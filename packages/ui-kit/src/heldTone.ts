import type { Tone } from "@ksp-gonogo/sitrep-sdk";

/**
 * The tone a badge takes while the reading behind it is held, from the tone it
 * has while live. A good state (`go`, `info`) reads `caution`, since a held
 * reading can no longer vouch for it. `caution`, `warn`, `nogo` and `offline`
 * keep their own tone, as a held bad state is no better for being held. A
 * neutral badge, or one with no tone, stays neutral.
 */
export function heldTone(tone: Tone | undefined): Tone | undefined {
  return tone === "go" || tone === "info" ? "caution" : tone;
}
