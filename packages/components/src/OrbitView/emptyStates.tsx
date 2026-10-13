import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";

/** The empty-state sentence, from why the conic withdrew; the switch is exhaustive so a new reason is a compile error. */
export function noOrbitSentence(
  declined: ReckoningDecline | undefined,
): string {
  if (declined === undefined) return "No orbital data";
  const reason = declined.reason;
  switch (reason) {
    case "under-physics":
      // The craft is loaded and its elements are osculating; what is refused is advancing them in time.
      return "No coast under physics";
    case "input-absent":
    case "beyond-horizon":
    case "model-inapplicable":
    case "contested":
    case "insufficient-history":
    case "frame-unavailable":
      return "No orbital data";
    default: {
      const unnamed: never = reason;
      return unnamed;
    }
  }
}
