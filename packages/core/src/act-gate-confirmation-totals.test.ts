// @vitest-environment node
// Node realm rather than the package's jsdom default: this imports a repo script.
import { describe, expect, it } from "vitest";
import type { Counts, Problem } from "../../../scripts/act-warning-compare.mjs";
import * as gate from "../../../scripts/act-warning-compare.mjs";

/**
 * The act-warning gate prints a first-run total, then, when a file disagrees with
 * the debt, re-measures that package and prints per-file lines from the
 * confirmation. Every number in the output has to be traceable to the run it came
 * from: the confirmation's lines must add up to the confirmation's own total once
 * the files that fired on it alone are counted, and the first run's total must
 * add up from the first-run counts of the same lines plus the files that did not
 * reproduce.
 */
describe("the act-warning gate's confirmation report", () => {
  const first: Counts = {
    "components/a.test.tsx": 10,
    "components/b.test.tsx": 1,
    "components/c.test.tsx": 5,
  };
  const confirmation: Counts = {
    "components/a.test.tsx": 14,
    "components/c.test.tsx": 5,
    "components/d.test.tsx": 2,
  };
  const inScope = (file: string) => file.startsWith("components/");

  it("totals the confirmation separately, and its lines plus confirmation-only files add up to it", () => {
    const { reproduced, confirmationOnly } = gate.reconcile({
      first,
      confirmation,
      debt: {},
      inScope,
    });
    const line = gate.confirmationTotalLine(
      confirmation,
      new Set(["components"]),
    );
    const total = Number(/total: (\d+) act warnings/.exec(line)?.[1]);
    expect(line).toMatch(
      /^confirmation run total: 21 act warnings across 3 files/,
    );

    const printed = [...reproduced, ...confirmationOnly].map((p) =>
      gate.formatProblem(p, "confirmation run"),
    );
    const printedSum = printed
      .map((l) => Number(/: (\d+) on the confirmation run/.exec(l)?.[1]))
      .reduce((a, b) => a + b, 0);
    expect(printedSum).toBe(total);
  });

  it("accounts for the first-run total through each line's first-run count and the files that did not reproduce", () => {
    const { reproduced, vanished } = gate.reconcile({
      first,
      confirmation,
      debt: {},
      inScope,
    });
    const firstOfReproduced = reproduced.reduce(
      (a, p) => a + (p.firstN ?? Number.NaN),
      0,
    );
    const vanishedSum = vanished.reduce((a, p) => a + p.n, 0);
    expect(firstOfReproduced + vanishedSum).toBe(gate.sumOf(first));
    expect(vanished.map((p) => p.file)).toEqual(["components/b.test.tsx"]);
  });

  it("names the run on every line and carries the first run's count beside a reproduced one", () => {
    const { reproduced } = gate.reconcile({
      first,
      confirmation,
      debt: {},
      inScope,
    });
    const a = reproduced.find((p) => p.file === "components/a.test.tsx");
    expect(a).toBeDefined();
    expect(gate.formatProblem(a as Problem, "confirmation run")).toBe(
      "NEW    components/a.test.tsx: 14 on the confirmation run (first run 10)",
    );
  });

  it("keeps a debt entry for an unmeasured package out of the comparison", () => {
    const { reproduced, vanished, confirmationOnly } = gate.reconcile({
      first: {},
      confirmation: {},
      debt: { "app/x.test.tsx": 3 },
      inScope,
    });
    expect([...reproduced, ...vanished, ...confirmationOnly]).toEqual([]);
  });
});
