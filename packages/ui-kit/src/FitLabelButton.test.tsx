import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { FitLabelButton } from "./FitLabelButton";

/**
 * The measured collapse cannot be exercised in jsdom, which computes no boxes:
 * every width is 0, so the label always "fits" and the component renders its
 * expanded state. That is stated rather than worked around, because a test
 * asserting a collapse jsdom cannot produce would be asserting the mock.
 *
 * What IS testable here is the half that rots silently: the accessible name. A
 * screen reader must say the same word whether or not the word is on screen, so
 * a user who cannot see the icon cannot tell which mode the button is in. The
 * collapse itself is proved by render on all three engines.
 */
describe("FitLabelButton: the accessible name", () => {
  it("names the button by its label", () => {
    render(<FitLabelButton label="Upgrade" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
  });

  it("does not double up the name when the label is also visible", () => {
    // aria-label carries the name and the visible copy is aria-hidden, so the
    // accessible name is the label EXACTLY, not "Upgrade Upgrade".
    render(<FitLabelButton label="Upgrade" icon={<svg />} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Upgrade",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the measuring ghost out of the accessible name", () => {
    // The ghost is a second copy of the label in the DOM. If it were readable
    // the name would change with the state, which is the whole defect.
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
