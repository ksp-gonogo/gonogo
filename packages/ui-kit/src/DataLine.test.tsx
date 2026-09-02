import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { DataLine } from "./DataLine";
import { MissionDate } from "./MissionDate";
import { Unit } from "./Unit";

describe("DataLine", () => {
  it("draws the label and the reading at different weights", () => {
    const { container } = render(
      <DataLine label="Retires">
        <MissionDate value={200_000_000} />
      </DataLine>,
    );

    const label = screen.getByText("Retires");
    // The label is the quiet half and the reading the loud one. Asserted as the
    // two being DIFFERENT elements rather than on the computed colours, which
    // are theme tokens: the defect being guarded is one run of identical grey.
    expect(label.tagName).toBe("SPAN");
    expect(container.querySelectorAll("span")).not.toHaveLength(1);
    expect(container.textContent).toContain("Retires");
  });

  it("takes a chip between the label and the reading", () => {
    render(
      <DataLine label="Course" lead={<Badge size="sm">ENROLLED</Badge>}>
        Proficiency: Titan II
      </DataLine>,
    );

    expect(screen.getByText("ENROLLED")).toBeInTheDocument();
    expect(screen.getByText("Proficiency: Titan II")).toBeInTheDocument();
  });

  it("passes an a11y smoke check with a toned reading", async () => {
    const { container } = render(
      <DataLine label="Upkeep" tone="warn">
        <Unit value={value("funds", 1200)} />
      </DataLine>,
    );

    await expectNoA11yViolations(container);
  });
});
