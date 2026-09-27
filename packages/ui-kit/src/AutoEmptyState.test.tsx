import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { AutoEmptyState } from "./AutoEmptyState";
import { emittedRuleFor } from "./test/emittedRule";

describe("AutoEmptyState", () => {
  it("shows the fallback when the content area renders nothing", () => {
    render(
      <AutoEmptyState fallback={<span>No active objectives</span>}>
        {null}
      </AutoEmptyState>,
    );
    expect(screen.getByText("No active objectives")).toBeVisible();
  });

  it("hides the fallback once the content area has rendered children", () => {
    render(
      <AutoEmptyState fallback={<span>No active objectives</span>}>
        <div>Reach the Mun</div>
      </AutoEmptyState>,
    );
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
    expect(screen.getByText("No active objectives")).not.toBeVisible();
  });

  it("forwards arbitrary content-area attributes (e.g. aria-label)", () => {
    render(
      <AutoEmptyState fallback={null} aria-label="Objectives">
        <div>Reach the Mun</div>
      </AutoEmptyState>,
    );
    expect(screen.getByLabelText("Objectives")).toBeInTheDocument();
  });

  it("is never a scroller of its own, so the panel body stays the only one", () => {
    render(
      <AutoEmptyState fallback={<span>none</span>} data-testid="content">
        <span>row</span>
      </AutoEmptyState>,
    );
    const rule = emittedRuleFor(screen.getByTestId("content"));
    expect(rule).not.toMatch(/overflow/);
    expect(rule).not.toMatch(/min-height:0/);
  });
});
