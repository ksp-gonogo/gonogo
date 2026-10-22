import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwaitingSignal } from "./AwaitingSignal";
import { expectNoA11yViolations } from "./expectNoA11yViolations";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AwaitingSignal", () => {
  it("says the first signal is awaited, with no time when no delay is known", () => {
    const { container } = render(<AwaitingSignal />);

    expect(container.textContent).toBe("Awaiting first signal");
  });

  it("never draws a zero or a null token for an unknown or zero delay", () => {
    const { container, rerender } = render(<AwaitingSignal expectedIn={0} />);
    expect(container.textContent).toBe("Awaiting first signal");

    rerender(<AwaitingSignal expectedIn={null} />);
    expect(container.textContent).toBe("Awaiting first signal");
  });

  it("counts the expected time down and drops it once the report is overdue", () => {
    const { container } = render(<AwaitingSignal expectedIn={4} />);
    expect(container.textContent).toContain("Awaiting first signal");
    expect(container.textContent).toContain("4s");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.textContent).toContain("2s");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).toBe("Awaiting first signal");
  });

  it("has no accessibility violations", async () => {
    vi.useRealTimers();
    const { container } = render(<AwaitingSignal expectedIn={12} />);

    expect(screen.getByText(/Awaiting first signal/)).toBeTruthy();
    await expectNoA11yViolations(container);
  });
});
