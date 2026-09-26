import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { CommandLossList, type RailLoss } from "./CommandLossList";

const loss: RailLoss = {
  id: "c0",
  command: "vessel.control.setSas",
  args: { enabled: true },
  label: "",
  tags: railTagsForCommand("vessel.control.setSasMode"),
};

describe("CommandLossList", () => {
  it("announces a loss that arrives after the list is on screen", () => {
    const { rerender } = render(<CommandLossList losses={[]} />);
    const region = screen.getByRole("status", {
      name: "Commands with no reply",
    });
    expect(region).toBeEmptyDOMElement();

    rerender(<CommandLossList losses={[loss]} />);

    expect(screen.getByRole("status", { name: "Commands with no reply" })).toBe(
      region,
    );
    expect(region).toHaveTextContent("no reply. May have run.");
  });

  it("is a plain list when something else announces it", () => {
    render(<CommandLossList losses={[loss]} live={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("list", { name: "Commands with no reply" }),
    ).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CommandLossList losses={[loss]} onDismiss={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
