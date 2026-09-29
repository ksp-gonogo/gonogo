import { act, fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { HoverCard } from "./HoverCard";

function mount() {
  return render(
    <div data-testid="widget" style={{ overflow: "hidden" }}>
      <HoverCard trigger={<span>RELAY</span>} ariaLabel="Probe signal">
        One-way 4.5 s
      </HoverCard>
    </div>,
  );
}

describe("HoverCard", () => {
  it("shows its card while the trigger has focus, as the trigger's description", () => {
    mount();
    const trigger = screen.getByRole("button", { name: "Probe signal" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => trigger.focus());
    const card = screen.getByRole("tooltip");
    expect(card.textContent).toBe("One-way 4.5 s");
    expect(trigger.getAttribute("aria-describedby")).toBe(card.id);
    act(() => trigger.blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("draws the card outside the widget, so the widget's clipping cannot cut it off", () => {
    mount();
    act(() => screen.getByRole("button", { name: "Probe signal" }).focus());
    const widget = screen.getByTestId("widget");
    expect(widget.contains(screen.getByRole("tooltip"))).toBe(false);
  });

  it("closes on Escape", () => {
    mount();
    act(() => screen.getByRole("button", { name: "Probe signal" }).focus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays open while the pointer crosses from the trigger onto the card", () => {
    vi.useFakeTimers();
    try {
      mount();
      const trigger = screen.getByRole("button", { name: "Probe signal" });
      fireEvent.pointerEnter(trigger);
      fireEvent.pointerLeave(trigger);
      fireEvent.pointerEnter(screen.getByRole("tooltip"));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("tooltip")).toBeTruthy();
      fireEvent.pointerLeave(screen.getByRole("tooltip"));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no accessibility violations while open", async () => {
    const { container } = mount();
    act(() => screen.getByRole("button", { name: "Probe signal" }).focus());
    // Checked apart, since the card is portalled outside the widget's container.
    await expectNoA11yViolations(container);
    await expectNoA11yViolations(screen.getByRole("tooltip"));
  });
});
