import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { SubjectHeading } from "./SubjectHeading";

describe("SubjectHeading", () => {
  /*
   * Order is the reason this component exists, so order is what is asserted,
   * in the DOM rather than in the styling: what "reads before" means to a
   * screen reader walking the line is the order of the nodes, and no amount of
   * flex ordering changes that.
   */
  it("reads the subject before its status", () => {
    render(
      <SubjectHeading status={<Badge severity="info">ACTIVE</Badge>}>
        <span>Early Orbital Program</span>
      </SubjectHeading>,
    );

    const line = screen.getByText("Early Orbital Program").parentElement;
    expect(line?.textContent).toBe("Early Orbital ProgramACTIVE");
  });

  it("leaves the subject alone on the line when there is no status", () => {
    render(
      <SubjectHeading>
        <span>Early Orbital Program</span>
      </SubjectHeading>,
    );

    const line = screen.getByText("Early Orbital Program").parentElement;
    expect(line?.textContent).toBe("Early Orbital Program");
  });

  /*
   * The control: the assertion above would pass for the wrong reason if the
   * reading were somehow insensitive to order, so the same shape is built the
   * WRONG way round by hand and shown to produce the reading the guard
   * rejects.
   */
  it("would read the other way round if the order were reversed", () => {
    render(
      <div>
        <Badge severity="info">ACTIVE</Badge>
        <span>Early Orbital Program</span>
      </div>,
    );

    const line = screen.getByText("Early Orbital Program").parentElement;
    expect(line?.textContent).toBe("ACTIVEEarly Orbital Program");
  });
});
