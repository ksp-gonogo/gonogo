import { PerfBudget } from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { PerfBudgetsComponent } from "./index";

const budgets: PerfBudget[] = [];

function budget(name: string, threshold: number): PerfBudget {
  const b = new PerfBudget({ name, threshold, windowMs: 1000, unit: "ops" });
  budgets.push(b);
  return b;
}

afterEach(() => {
  for (const b of budgets) b.reset();
  budgets.length = 0;
});

describe("PerfBudgets dot summary", () => {
  it("names each dot's budget and its state, so the summary is not colour alone", async () => {
    budget("Quiet source/sec", 100);
    const hot = budget("Hot source/sec", 10);
    for (let i = 0; i < 20; i++) hot.record();

    const { container } = render(
      <PerfBudgetsComponent config={{}} id="perf" w={4} h={4} />,
    );

    expect(
      screen.getByRole("img", { name: "Hot source/sec: over" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Quiet source/sec: under" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
