/**
 * Where "worth mentioning" is decided, once, for the whole reliability surface.
 *
 * The contract deliberately carries no `wear` condition, because wear is a
 * threshold on a number and the numbers are on the wire. If a backend graded it
 * too there would be two authorities for one word, which is how a badge reading
 * "2 wearing" comes to disagree with the number of wearing rows beneath it.
 */

/**
 * How far into a budget counts as worth a row, keyed on what crossing the limit
 * MEANS. They differ because the meanings do: a schedule budget at 0.74 is 74%
 * of the way to an inspection date and nothing happens at the line, while a
 * risk-ramp budget at 0.76 is already into the ramp. One shared cutoff would
 * either shout about maintenance or stay quiet about risk.
 */
export const BUDGET_ATTENTION: Record<string, number> = {
  "risk-ramp": 0.75,
  "hard-limit": 0.75,
  schedule: 0.9,
  advisory: 1.0,
};

/**
 * An unrecognised or absent `kind` only earns a row once it is AT the limit. A
 * third-party dimension we cannot interpret gets the most conservative reading,
 * never a guess dressed as a warning.
 */
export const BUDGET_ATTENTION_DEFAULT = 1.0;

/** Below this survival probability the part is worth a row at all. */
export const SURVIVAL_ATTENTION = 0.95;

/**
 * Below this it is a warning rather than a caution. There is no critical band:
 * a forward probability over a stated horizon can prompt attention, it can
 * never justify an abort, and the horizon is always on screen beside it.
 */
export const SURVIVAL_WARNING = 0.85;

/** The attention threshold for a budget of this kind. */
export function budgetAttention(kind: string | null | undefined): number {
  if (kind == null) return BUDGET_ATTENTION_DEFAULT;
  return BUDGET_ATTENTION[kind] ?? BUDGET_ATTENTION_DEFAULT;
}
