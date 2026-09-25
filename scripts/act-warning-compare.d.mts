/** Types for `act-warning-compare.mjs`, plain ESM because the gate script loads it. */

export type Counts = Record<string, number>;

export interface Problem {
  kind: "NEW" | "WORSE" | "BETTER";
  file: string;
  known: number;
  n: number;
  /** The first run's count, on a problem the confirmation reproduced. */
  firstN?: number;
}

export function compare(
  counts: Counts,
  debt: Counts,
  inScope: (file: string) => boolean,
): Problem[];

export function packageOf(file: string): string;

export function sumOf(counts: Counts): number;

export function reconcile(args: {
  first: Counts;
  confirmation: Counts;
  debt: Counts;
  inScope: (file: string) => boolean;
}): {
  reproduced: Problem[];
  vanished: Problem[];
  confirmationOnly: Problem[];
};

export function formatProblem(p: Problem, run: string): string;

export function confirmationTotalLine(
  confirmation: Counts,
  remeasured: Set<string>,
): string;
