import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { emittedRuleFor } from "../test/emittedRule";
import { CommandOutcomeList } from "./CommandOutcomeList";

const DISCRETE = railTagsForCommand("vessel.control.setSasMode");

const REFUSED = {
  id: "r1",
  subject: "Stage",
  sentence: "Stage refused: no control",
  dismissLabel: "Clear stage refusal",
  tags: DISCRETE,
};

describe("CommandOutcomeList", () => {
  it("draws a warning outcome's command identity in the colour made for text on a dark ground", () => {
    render(<CommandOutcomeList ariaLabel="Refused" items={[REFUSED]} />);
    const [glyph] = screen.getAllByText("STAG");
    expect(emittedRuleFor(glyph)).toContain(
      "var(--color-status-warning-fg-muted)",
    );
  });

  it("has no axe violations with and without a clear control", async () => {
    const { container } = render(
      <>
        <CommandOutcomeList ariaLabel="Refused" items={[REFUSED]} />
        <CommandOutcomeList
          ariaLabel="Found"
          tone="notice"
          items={[{ ...REFUSED, id: "f1", sentence: "Stage found" }]}
          onDismiss={() => {}}
        />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
