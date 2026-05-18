import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToggleButton } from "./ToggleButton";
import { axe } from "./test/axe";

describe("ToggleButton", () => {
  it("renders a real <button> element", () => {
    render(<ToggleButton>Toggle</ToggleButton>);
    expect(screen.getByRole("button", { name: "Toggle" })).toBeInstanceOf(
      HTMLButtonElement,
    );
  });

  it("defaults aria-pressed to false and reflects active=true", () => {
    const { rerender } = render(<ToggleButton>Mode</ToggleButton>);
    expect(screen.getByRole("button", { name: "Mode" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(<ToggleButton active>Mode</ToggleButton>);
    expect(screen.getByRole("button", { name: "Mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("respects an explicitly-provided aria-pressed", () => {
    render(
      <ToggleButton active aria-pressed="mixed">
        Mixed
      </ToggleButton>,
    );
    expect(screen.getByRole("button", { name: "Mixed" })).toHaveAttribute(
      "aria-pressed",
      "mixed",
    );
  });

  it("fires onClick when activated by keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ToggleButton onClick={onClick}>Press</ToggleButton>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Press" })).toHaveFocus();
    await user.keyboard("[Space]");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("active variant applies different inline styling than inactive", () => {
    const { rerender } = render(<ToggleButton tone="go">Go</ToggleButton>);
    const inactiveClass = screen.getByRole("button", { name: "Go" }).className;
    rerender(
      <ToggleButton active tone="go">
        Go
      </ToggleButton>,
    );
    expect(screen.getByRole("button", { name: "Go" }).className).not.toBe(
      inactiveClass,
    );
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ToggleButton disabled onClick={onClick}>
        Off
      </ToggleButton>,
    );
    await user.click(screen.getByRole("button", { name: "Off" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has no axe violations across tones and sizes", async () => {
    const { container } = render(
      <>
        <ToggleButton>Neutral inactive</ToggleButton>
        <ToggleButton active>Neutral active</ToggleButton>
        <ToggleButton tone="go" active>
          Go
        </ToggleButton>
        <ToggleButton tone="nogo" active>
          NoGo
        </ToggleButton>
        <ToggleButton tone="warn" active>
          Warn
        </ToggleButton>
        <ToggleButton size="sm">Small</ToggleButton>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
