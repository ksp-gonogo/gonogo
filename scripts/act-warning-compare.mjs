/**
 * The act-warning gate's comparison and confirmation logic, kept apart from the
 * script that runs the suites so it can be tested without running any.
 *
 * A gate run can take two measurements: the first run of every package, and a
 * confirmation run of only the packages that disagreed with the debt. Every count
 * printed says which of the two it came from, and the confirmation gets a total of
 * its own, because a first-run total printed above confirmation-run lines reads as
 * one measurement that does not add up.
 */

/**
 * Every file whose count disagrees with `debt`, as `{ kind, file, known, n }`.
 * A debt entry for a package outside `inScope` was not measured, so its absence
 * is not read as a fix.
 */
export function compare(counts, debt, inScope) {
  const out = [];
  for (const [file, n] of Object.entries(counts)) {
    const known = debt[file];
    if (known === undefined) {
      out.push({ kind: "NEW", file, known: 0, n });
      continue;
    }
    if (n > known) out.push({ kind: "WORSE", file, known, n });
  }
  for (const [file, known] of Object.entries(debt)) {
    if (!inScope(file)) continue;
    const n = counts[file] ?? 0;
    if (n < known) out.push({ kind: "BETTER", file, known, n });
  }
  return out;
}

export function packageOf(file) {
  return file.split("/")[0];
}

export function sumOf(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * Settle the first run's problems against a confirmation run of the packages in
 * `remeasured`. A problem reproduces when the confirmation finds the same kind
 * in the same file, whatever its count, and is then reported at the
 * confirmation's count with the first run's beside it.
 *
 * `vanished` fired on the first run only and `confirmationOnly` on the
 * confirmation only; neither is failed on, and both are returned so the report
 * can account for every warning either run counted.
 */
export function reconcile({ first, confirmation, debt, inScope }) {
  const key = (p) => `${p.kind} ${p.file}`;
  const firstProblems = compare(first, debt, inScope);
  const secondProblems = compare(confirmation, debt, inScope);
  const firstKeys = new Map(firstProblems.map((p) => [key(p), p]));
  const secondKeys = new Map(secondProblems.map((p) => [key(p), p]));
  return {
    reproduced: secondProblems
      .filter((p) => firstKeys.has(key(p)))
      .map((p) => ({ ...p, firstN: firstKeys.get(key(p)).n })),
    vanished: firstProblems.filter((p) => !secondKeys.has(key(p))),
    confirmationOnly: secondProblems.filter((p) => !firstKeys.has(key(p))),
  };
}

/** One problem as a report line, naming the run each count came from. */
export function formatProblem(p, run) {
  const count = p.kind === "NEW" ? `${p.n}` : `${p.known} -> ${p.n}`;
  const first = p.firstN === undefined ? "" : ` (first run ${p.firstN})`;
  return `${p.kind.padEnd(6)} ${p.file}: ${count} on the ${run}${first}`;
}

/**
 * The confirmation's own summary line. It totals only the re-measured packages,
 * which are the only ones the confirmation ran.
 */
export function confirmationTotalLine(confirmation, remeasured) {
  const scoped = Object.fromEntries(
    Object.entries(confirmation).filter(([file]) =>
      remeasured.has(packageOf(file)),
    ),
  );
  return (
    `confirmation run total: ${sumOf(scoped)} act warnings across ` +
    `${Object.keys(scoped).length} files in ${[...remeasured].join(", ")}`
  );
}
