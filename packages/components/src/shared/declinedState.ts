import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";

/**
 * One state word for every decline, in the register of `NO DATA`; the specific reason is in the hover note.
 * `null` for `input-absent`, where the dashes already say "not arrived".
 */
export function declinedState(declined: ReckoningDecline): string | null {
  const reason = declined.reason;
  switch (reason) {
    case "under-physics":
    case "beyond-horizon":
    case "model-inapplicable":
    case "contested":
    case "insufficient-history":
      return "CANNOT MODEL";
    case "input-absent":
      return null;
    default: {
      const unnamed: never = reason;
      return unnamed;
    }
  }
}
