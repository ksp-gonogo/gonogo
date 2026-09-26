import type { InFlightListItem } from "./InFlightList";

/** The structural subset of an in-flight command that this mapping reads. */
export interface InFlightCommandLike {
  id: string;
  label: string;
  command: string;
  reachEtaSeconds: number | null;
  replyEtaSeconds: number | null;
  predictedPhase: InFlightListItem["phase"];
  /** The issuing button's own terse glyph ("PRO", "RET"). Defaults to an abbreviation of `label`. */
  glyph?: string;
}

/**
 * Fallback queue glyph: the significant word of the label, upper-cased and cut
 * to 4 chars ("SAS Prograde" -> "PROG"). An identity, never a status word.
 */
export function deriveGlyph(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const pick = words.length > 1 ? words[words.length - 1] : (words[0] ?? "");
  const letters = pick.replace(/[^a-zA-Z0-9]/g, "");
  return (letters || label).slice(0, 4).toUpperCase();
}

/** Progress anchored by phase, for when the eta geometry is missing (overdue, lost, zero delay, or a hand-built item). */
export const PHASE_PROGRESS: Record<InFlightListItem["phase"], number> = {
  "in-transit": 0.18,
  "awaiting-reply": 0.5,
  due: 0.62,
  overdue: 0.82,
  lost: 0.95,
};

/**
 * A command's TRUE progress along the 3-stage delay axis (0 just sent, 1 the
 * end of the 3T span). `T = replyEta - reachEta`, which holds even once
 * `reachEta` goes negative; elapsed is `T - reachEta`. Falls back to a phase
 * anchor when either eta is absent.
 */
export function journeyProgress(item: InFlightCommandLike): number {
  const reach = item.reachEtaSeconds;
  const reply = item.replyEtaSeconds;
  if (reach !== null && reply !== null && reply > reach) {
    const t = reply - reach;
    const elapsed = t - reach;
    return Math.max(0, Math.min(1, elapsed / (3 * t)));
  }
  return PHASE_PROGRESS[item.predictedPhase];
}

/**
 * The one in-flight command to list item adapter. While `in-transit` a row
 * counts down to the command REACHING the craft; after that, to the
 * acknowledgement coming back. `label` falls back to the command id.
 */
export function toInFlightListItems(
  items: readonly InFlightCommandLike[],
): InFlightListItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label || item.command,
    etaSeconds:
      item.predictedPhase === "in-transit"
        ? item.reachEtaSeconds
        : item.replyEtaSeconds,
    phase: item.predictedPhase,
    progress: journeyProgress(item),
    glyph: item.glyph ?? deriveGlyph(item.label || item.command),
  }));
}
