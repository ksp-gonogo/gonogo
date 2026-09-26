/*
 * Where "worth mentioning" is decided for the whole reliability surface. The
 * contract carries no `wear` condition: wear is a threshold on numbers already
 * on the wire, and a second authority would let a badge disagree with its rows.
 */

/**
 * How far into a budget counts as worth a row, keyed on what crossing the limit
 * MEANS: nothing happens at a schedule line, while a risk-ramp budget past 0.75
 * is already into the ramp.
 */
export const BUDGET_ATTENTION: Record<string, number> = {
  "risk-ramp": 0.75,
  "hard-limit": 0.75,
  schedule: 0.9,
  advisory: 1.0,
};

/** An unrecognised or absent `kind` earns a row only AT the limit: never a guess dressed as a warning. */
export const BUDGET_ATTENTION_DEFAULT = 1.0;

/** Below this survival probability the part is worth a row at all. */
export const SURVIVAL_ATTENTION = 0.95;

/** Below this it is a warning rather than a caution. No critical band: a forward probability never justifies an abort. */
export const SURVIVAL_WARNING = 0.85;

/** The attention threshold for a budget of this kind. */
export function budgetAttention(kind: string | null | undefined): number {
  if (kind == null) return BUDGET_ATTENTION_DEFAULT;
  return BUDGET_ATTENTION[kind] ?? BUDGET_ATTENTION_DEFAULT;
}
