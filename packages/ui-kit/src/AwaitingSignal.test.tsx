import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwaitingSignal } from "./AwaitingSignal";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { installTestGameClock } from "./test/gameClock";

const gameClock = installTestGameClock();

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

  it("counts the expected time down in game time and drops it once the report is overdue", () => {
    const { container } = render(<AwaitingSignal expectedIn={4} />);
    expect(container.textContent).toContain("Awaiting first signal");
    expect(container.textContent).toContain("4s");

    act(() => {
      gameClock.advance(2);
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain("2s");

    act(() => {
      gameClock.advance(3);
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toBe("Awaiting first signal");
  });

  it("falls at the warp rate rather than one second per real second", () => {
    const { container } = render(<AwaitingSignal expectedIn={600} />);
    expect(container.textContent).toContain("10min");

    act(() => {
      gameClock.advance(100);
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain("8min 20s");
  });

  it("stands still while the game is paused, however long the wall clock runs", () => {
    const { container } = render(<AwaitingSignal expectedIn={30} />);
    expect(container.textContent).toContain("30s");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toContain("30s");
  });

  it("has no accessibility violations", async () => {
    vi.useRealTimers();
    const { container } = render(<AwaitingSignal expectedIn={12} />);

    expect(screen.getByText(/Awaiting first signal/)).toBeTruthy();
    await expectNoA11yViolations(container);
  });
});
