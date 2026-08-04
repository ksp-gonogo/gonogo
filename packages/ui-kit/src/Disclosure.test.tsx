import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Disclosure } from "./Disclosure";
import { axe } from "./test/axe";

describe("Disclosure", () => {
  it("is collapsed by default and toggles the panel on click", () => {
    render(
      <Disclosure label="Delay">
        <span>4.5 s one-way</span>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Delay" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("4.5 s one-way")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("4.5 s one-way")).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(
      <Disclosure label="Delay">
        <span>detail</span>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Delay" });
    fireEvent.click(trigger);
    expect(screen.getByText("detail")).toBeInTheDocument();
    // Escape from within the disclosure (fired on the trigger, which bubbles to
    // the root handler) closes it and returns focus to the trigger.
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByText("detail")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("labels the trigger with ariaLabel when the label is a non-text node", () => {
    render(
      <Disclosure
        ariaLabel="Explorer signal"
        label={<svg aria-hidden="true" />}
      >
        <span>detail</span>
      </Disclosure>,
    );
    expect(
      screen.getByRole("button", { name: "Explorer signal" }),
    ).toBeInTheDocument();
  });

  it("has no accessible violations, open or closed", async () => {
    const { container } = render(
      <Disclosure label="Delay">
        <span>detail</span>
      </Disclosure>,
    );
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Delay" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
