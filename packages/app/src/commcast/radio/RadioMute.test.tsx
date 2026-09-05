/**
 * The per-conversation mute, as an operator and an assistive technology find
 * it.
 *
 * What only a render can show: that it is a real button carrying its own
 * pressed state, that an icon-only control still names what it mutes, and that
 * the keyboard alone can work it.
 */
import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RadioMute } from "./RadioMute";

describe("the conversation mute", () => {
  it("is a real button whose pressed state is the mute", () => {
    const { rerender } = render(
      <RadioMute muted={false} threadName="Ares 4" onToggle={() => {}} />,
    );
    const key = screen.getByRole("button", { name: "Mute Ares 4" });
    expect(key).toHaveAttribute("aria-pressed", "false");

    rerender(
      <RadioMute muted={true} threadName="Ares 4" onToggle={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Mute Ares 4" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("names the conversation it mutes, not just 'mute'", () => {
    /*
     * An operator with two loops open has two of these controls, and an
     * icon-only button labelled "Mute" would leave a screen reader unable to
     * say which one it is about.
     */
    render(
      <RadioMute
        muted={false}
        threadName="Woomera Range"
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Mute Woomera Range" }),
    ).toBeInTheDocument();
  });

  it("works from the keyboard alone", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<RadioMute muted={false} threadName="Ares 4" onToggle={onToggle} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Mute Ares 4" })).toHaveFocus();
    await user.keyboard("[Space]");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations, muted or not", async () => {
    const { container, rerender } = render(
      <RadioMute muted={false} threadName="Ares 4" onToggle={() => {}} />,
    );
    await expectNoA11yViolations(container);
    rerender(
      <RadioMute muted={true} threadName="Ares 4" onToggle={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
