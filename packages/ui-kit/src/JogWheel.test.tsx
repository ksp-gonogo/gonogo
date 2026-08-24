import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { JogWheel } from "./JogWheel";

describe("JogWheel", () => {
  it("exposes slider semantics with current/bounds/valuetext", () => {
    render(
      <JogWheel
        value={30}
        min={0}
        max={90}
        step={1}
        ariaLabel="Yaw"
        format={(v) => `${v}°`}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Yaw" });
    expect(slider).toHaveAttribute("aria-valuenow", "30");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "90");
    expect(slider).toHaveAttribute("aria-valuetext", "30°");
  });

  it("increments by step on ArrowRight and clamps at max", () => {
    const onChange = vi.fn();
    render(
      <JogWheel
        value={89}
        min={0}
        max={90}
        step={1}
        ariaLabel="Yaw"
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Yaw" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(90);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(90); // clamped, no overshoot
  });

  it("does not emit when disabled", () => {
    const onChange = vi.fn();
    render(
      <JogWheel
        value={30}
        min={0}
        max={90}
        step={1}
        ariaLabel="Yaw"
        disabled
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "Yaw" }), {
      key: "ArrowRight",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <JogWheel
        value={30}
        min={0}
        max={90}
        step={1}
        ariaLabel="Yaw"
        onChange={() => {}}
      />,
    );
    await expectNoA11yViolations(container);
  });
});

/**
 * Rate mode: displacement is a SPEED, not a position.
 *
 * <p>The mode exists because a position control cannot serve an instant. A UT is
 * legitimately years out, and no pair of bounds spans that while leaving useful
 * precision anywhere inside it. Displacement setting a rate needs no bounds at
 * all, which is how the producer's own planner drives time.</p>
 */
describe("JogWheel in rate mode", () => {
  // jsdom implements neither, and the component calls both. Without these the
  // handler THROWS partway through, React swallows it, and the drag half-works:
  // the tests below passed that way, which is a pass for the wrong reason.
  beforeAll(() => {
    Object.assign(HTMLElement.prototype, {
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture() {
        return true;
      },
    });
  });

  const drag = (handle: HTMLElement, pixels: number) => {
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: pixels, pointerId: 1 });
  };

  it("moves the value while held off centre, and needs no bounds", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(
        <JogWheel
          mode="rate"
          value={1000}
          step={1}
          stepsPerSecond={10}
          ariaLabel="Ignition"
          onChange={onChange}
        />,
      );

      drag(screen.getByRole("slider", { name: "Ignition" }), 80);
      expect(onChange).not.toHaveBeenCalled();

      // Nothing moves on the pointer itself: the tick does the moving, so a
      // value driven by both would advance twice.
      vi.advanceTimersByTime(600);
      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.calls[0][0]).toBeGreaterThan(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back to centre and stops on release", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(
        <JogWheel
          mode="rate"
          value={1000}
          step={1}
          ariaLabel="Ignition"
          onChange={onChange}
        />,
      );
      const handle = screen.getByRole("slider", { name: "Ignition" });

      drag(handle, 80);
      vi.advanceTimersByTime(300);
      const movedWhileHeld = onChange.mock.calls.length;
      expect(movedWhileHeld).toBeGreaterThan(0);

      fireEvent.pointerUp(handle, { pointerId: 1 });
      vi.advanceTimersByTime(1000);
      // A rate control left displaced would keep driving a value nobody is
      // holding: for a burn instant that is a plan sliding unattended.
      expect(onChange.mock.calls.length).toBe(movedWhileHeld);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when it is unmounted mid-drag", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { unmount } = render(
        <JogWheel
          mode="rate"
          value={1000}
          step={1}
          ariaLabel="Ignition"
          onChange={onChange}
        />,
      );

      drag(screen.getByRole("slider", { name: "Ignition" }), 80);
      vi.advanceTimersByTime(200);
      const before = onChange.mock.calls.length;

      unmount();
      vi.advanceTimersByTime(2000);
      expect(onChange.mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
