/**
 * Pure half of the debt list's shrink-only check, so the rule can be exercised
 * on planted lists as well as on the real one.
 */

/** `Saga <number>`. */
const TICKET = /^Saga \d+$/;

export interface DebtCheckInput {
  /** Keys the debt list held at the ratchet base. */
  baseDebt: ReadonlySet<string>;
  /** Keys the debt list holds now. */
  debt: ReadonlySet<string>;
  /** Added keys now, each with the ticket that owns getting it a reader. */
  allowance: Readonly<Record<string, string>>;
  /** The allowance as it stood at the base, `undefined` when the base had none. */
  baseAllowance: ReadonlySet<string> | undefined;
}

/** Everything wrong with the list, one sentence each; empty when it is fine. */
export function debtListProblems(input: DebtCheckInput): string[] {
  const { baseDebt, debt, allowance, baseAllowance } = input;
  const problems: string[] = [];
  for (const key of debt) {
    if (baseDebt.has(key)) continue;
    if (!(key in allowance)) {
      problems.push(`${key} is new debt and is not on the allowance`);
    }
  }
  for (const [key, ticket] of Object.entries(allowance)) {
    if (!TICKET.test(ticket)) {
      problems.push(
        `${key} is on the allowance without a ticket ("${ticket}")`,
      );
    }
    if (!debt.has(key)) {
      problems.push(`${key} is on the allowance but is not debt any more`);
    }
    if (baseAllowance && !baseAllowance.has(key)) {
      problems.push(`${key} was added to an allowance that only shrinks`);
    }
  }
  return problems;
}
