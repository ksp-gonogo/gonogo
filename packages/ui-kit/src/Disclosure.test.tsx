import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
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

  it("asButton renders the trigger as a real button, toggling the same way", () => {
    render(
      <Disclosure
        variant="inline"
        chevron={false}
        asButton
        label={(open) => (open ? "Hide detail" : "Show detail")}
        ariaLabel="Show rate breakdown for Water"
      >
        <span>ledger</span>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", {
      name: "Show rate breakdown for Water",
    });
    // A real ui-kit Button, not the bare unstyled trigger: the bordered
    // GhostButton chrome (background/border/uppercase/letter-spacing) comes
    // from the SAME styled component every other bordered button in the kit
    // uses, so a change to that shared style shows up here too rather than
    // this trigger silently drifting back to plain text.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveTextContent("Show detail");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveTextContent("Hide detail");
    expect(screen.getByText("ledger")).toBeInTheDocument();
  });

  it("buttonSize sm renders a compact, normal-case trigger (not the tracked-out md chrome)", () => {
    render(
      <Disclosure
        variant="inline"
        chevron={false}
        asButton
        buttonSize="sm"
        label={(open) => (open ? "Hide detail" : "Show detail")}
        ariaLabel="Show rate breakdown for Water"
      >
        <span>ledger</span>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", {
      name: "Show rate breakdown for Water",
    });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveTextContent("Show detail");
    const styles = getComputedStyle(trigger);
    expect(styles.textTransform).toBe("none");
  });

  it("asButton has no accessible violations, open or closed", async () => {
    const { container } = render(
      <Disclosure
        variant="inline"
        chevron={false}
        asButton
        label={(open) => (open ? "Hide detail" : "Show detail")}
        ariaLabel="Show rate breakdown for Water"
      >
        <span>ledger</span>
      </Disclosure>,
    );
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(
      screen.getByRole("button", { name: "Show rate breakdown for Water" }),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
