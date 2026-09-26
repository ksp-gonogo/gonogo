import { CommandErrorCode, railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { CommandRefusalList, type RailRefusal } from "./CommandRefusalList";
import { commandRefusalSentence } from "./commandRefusalSentence";

const refusal: RailRefusal = {
  id: "r0",
  errorCode: CommandErrorCode.LimitReached,
  command: "vessel.control.stage",
  tags: railTagsForCommand("vessel.control.stage"),
};

describe("CommandRefusalList", () => {
  it("announces a refusal that arrives after the list is on screen", () => {
    const { rerender } = render(<CommandRefusalList refusals={[]} />);
    const region = screen.getByRole("status", { name: "Refused commands" });
    expect(region).toBeEmptyDOMElement();

    rerender(<CommandRefusalList refusals={[refusal]} />);

    expect(screen.getByRole("status", { name: "Refused commands" })).toBe(
      region,
    );
    expect(region).toHaveTextContent(commandRefusalSentence(refusal));
  });

  it("is a plain list when something else announces it", () => {
    render(<CommandRefusalList refusals={[refusal]} live={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("list", { name: "Refused commands" })).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CommandRefusalList refusals={[refusal]} onDismiss={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
