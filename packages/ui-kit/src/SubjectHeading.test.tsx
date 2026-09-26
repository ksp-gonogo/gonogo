import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { SubjectHeading } from "./SubjectHeading";

describe("SubjectHeading", () => {
  // Order is asserted in the DOM, because node order is what a screen reader walks.
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

  // Control: the same shape built the wrong way round must produce the reading the guard rejects.
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
