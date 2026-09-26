import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { FitLabelButton } from "./FitLabelButton";

/**
 * jsdom computes no boxes, so the label always fits and the collapse is left to
 * the render gate. What is tested here is the accessible name, which must be
 * the same whether or not the word is on screen.
 */
describe("FitLabelButton: the accessible name", () => {
  it("names the button by its label", () => {
    render(<FitLabelButton label="Upgrade" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
  });

  it("does not double up the name when the label is also visible", () => {
    // The accessible name is the label exactly, not "Upgrade Upgrade".
    render(<FitLabelButton label="Upgrade" icon={<svg />} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Upgrade",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the measuring ghost out of the accessible name", () => {
    // The ghost copy of the label must not be readable, or the name would change with the state.
    const { container } = render(
      <FitLabelButton label="Upgrade" icon={<svg />} />,
    );
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
  });

  it("carries a disabled button's reason through, since the word may not be there to explain it", () => {
    render(
      <FitLabelButton
        label="Upgrade"
        icon={<svg />}
        disabled
        title="Not enough funds"
      />,
    );
    const button = screen.getByRole("button", { name: "Upgrade" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Not enough funds");
  });

  it("defaults to type=button so it never submits a surrounding form", () => {
    render(<FitLabelButton label="Upgrade" icon={<svg />} />);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});
