import type { LogEntry } from "@ksp-gonogo/logger";

/**
 * The shadow comparison's verdict, from a run's own log.
 *
 * Kept apart from the runner that produces the log so the judgement can be
 * exercised without a game: a classifier that decides whether a feature is safe
 * to flip has to be shown capable of saying no, and it cannot be shown that
 * against a session nobody can reproduce.
 */

/** The two lines that mean the evaluators reached the same answer. */
const AGREEMENTS = [
  "alarm-shadow: mod agrees, client had already fired",
  "alarm-shadow: client fired, mod had already agreed",
] as const;

/**
 * The three that mean they did not, each a different failure.
 *
 * `client fired, mod has not` is the one that matters most: after a flip the
 * mod owns the latch, so an alarm it never reached a verdict on is an alarm
 * that does not go off, which is the outcome the whole feature exists to
 * prevent.
 */
const DISAGREEMENTS = [
  "alarm-shadow: mod fired first, client still pending",
  "alarm-shadow: client fired, mod has not",
  "alarm-shadow: mod fired an alarm this client does not hold",
] as const;

/**
 * How many agreements a run needs before its silence means anything. Below
 * this a clean log says only that little happened.
 */
export const MINIMUM_FIRINGS = 10;

export interface ShadowRunInput {
  entries: readonly LogEntry[];
  /**
   * One-way light time during the run, seconds. `null` is the mod's own word
   * for nothing measurable, and a run without a delay cannot tell the two
   * evaluators apart at all.
   */
  owltSeconds: number | null;
}

export interface ShadowRunVerdict {
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  reason: string;
  agreements: number;
  disagreements: number;
  byMessage: Record<string, number>;
  /** Every disagreement, in order, for a report that has to name them. */
  divergences: readonly LogEntry[];
}

export function classifyShadowRun(input: ShadowRunInput): ShadowRunVerdict {
  const shadow = input.entries.filter((e) =>
    e.message.startsWith("alarm-shadow:"),
  );
  const byMessage: Record<string, number> = {};
  for (const e of shadow) {
    byMessage[e.message] = (byMessage[e.message] ?? 0) + 1;
  }
  const divergences = shadow.filter((e) =>
    DISAGREEMENTS.some((d) => e.message === d),
  );
  const agreements = shadow.filter((e) =>
    AGREEMENTS.some((a) => e.message === a),
  ).length;

  if (divergences.length > 0) {
    return {
      verdict: "FAIL",
      reason: `${divergences.length} disagreement(s) between the two evaluators`,
      agreements,
      disagreements: divergences.length,
      byMessage,
      divergences,
    };
  }
  if (input.owltSeconds === null || input.owltSeconds <= 0) {
    return {
      verdict: "INCONCLUSIVE",
      reason:
        "no one-way delay, so the two evaluators cannot disagree and a clean log proves nothing",
      agreements,
      disagreements: 0,
      byMessage,
      divergences,
    };
  }
  if (agreements < MINIMUM_FIRINGS) {
    return {
      verdict: "INCONCLUSIVE",
      reason: `only ${agreements} agreement(s); a run needs ${MINIMUM_FIRINGS} before quiet means agreement rather than inactivity`,
      agreements,
      disagreements: 0,
      byMessage,
      divergences,
    };
  }
  return {
    verdict: "PASS",
    reason: `${agreements} agreements, no disagreements, at a one-way delay of ${input.owltSeconds} seconds`,
    agreements,
    disagreements: 0,
    byMessage,
    divergences,
  };
}
