import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { JOG_WHEEL_MIN_TARGET_PX, JogWheel } from "./JogWheel";

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

/** Sizing changes the box only: neither the drag nor the keyboard reads the element's dimensions. */
describe("JogWheel sizing", () => {
  const box = (name: string) => {
    const cs = getComputedStyle(screen.getByRole("slider", { name }));
    return { width: cs.width, height: cs.height };
  };

  /**
   * The declaration block styled-components wrote for this element, since
   * jsdom resolves a `var()` with a fallback to the empty string.
   */
  const declarations = (name: string): string => {
    const el = screen.getByRole("slider", { name });
    const css = [...document.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("");
    for (const cls of el.classList) {
      const at = css.indexOf(`.${cls}{`);
      if (at >= 0) return css.slice(at, css.indexOf("}", at));
    }
    throw new Error(`no styled-components rule found for "${name}"`);
  };

  it("is the compact strip when neither axis is given", () => {
    render(
      <>
        <JogWheel
          value={30}
          min={0}
          max={90}
          step={1}
          ariaLabel="Across"
          onChange={() => {}}
        />
        <JogWheel
          value={30}
          min={0}
          max={90}
          step={1}
          orientation="vertical"
          ariaLabel="Down"
          onChange={() => {}}
        />
      </>,
    );
    expect(box("Across")).toEqual({ width: "56px", height: "24px" });
    expect(box("Down")).toEqual({ width: "24px", height: "56px" });
    expect(declarations("Across")).toContain(
      "padding:var(--inset-jog-wheel-compact)",
    );
    expect(declarations("Down")).toContain(
      "padding:var(--inset-jog-wheel-compact)",
    );
  });

  it("draws the box it is asked for, down to a corner-sized strip", () => {
    render(
      <JogWheel
        value={30}
        min={0}
        max={90}
        step={1}
        width={72}
        height={24}
        ariaLabel="Yaw"
        onChange={() => {}}
      />,
    );
    expect(box("Yaw")).toEqual({ width: "72px", height: "24px" });
    // 2px, not 4: at 24 tall the wider inset clips the caret label.
    expect(declarations("Yaw")).toContain(
      "padding:var(--inset-jog-wheel-compact)",
    );
  });

  it("refuses an unpressable box, clamping either axis to the target-size floor", () => {
    render(
      <JogWheel
        value={30}
        min={0}
        max={90}
        step={1}
        width={8}
        height={6}
        ariaLabel="Yaw"
        onChange={() => {}}
      />,
    );
    expect(box("Yaw")).toMatchObject({
      width: `${JOG_WHEEL_MIN_TARGET_PX}px`,
      height: `${JOG_WHEEL_MIN_TARGET_PX}px`,
    });
  });

  it("steps and clamps identically at the compact size", () => {
    const onChange = vi.fn();
    render(
      <JogWheel
        value={89}
        min={0}
        max={90}
        step={1}
        width={72}
        height={24}
        ariaLabel="Yaw"
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Yaw" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(90);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("keeps a visible focus ring at the compact size", () => {
    render(
      <JogWheel
        value={30}
        min={0}
        max={90}
        step={1}
        width={72}
        height={24}
        ariaLabel="Yaw"
        onChange={() => {}}
      />,
    );
    // Drawn outside the border box, so shrinking the box cannot eat it.
    const rule = [...document.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("");
    expect(rule).toContain("outline:2px solid var(--color-focus)");
    expect(screen.getByRole("slider", { name: "Yaw" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("has no axe violations at the compact size", async () => {
    const { container } = render(
      <JogWheel
        value={30}
        min={0}
        max={90}
        step={1}
        width={72}
        height={24}
        ariaLabel="Yaw"
        onChange={() => {}}
      />,
    );
    await expectNoA11yViolations(container);
  });
});

/** Rate mode: displacement is a speed, not a position, and needs no bounds. */
describe("JogWheel in rate mode", () => {
  // jsdom implements neither; without them the handler throws partway and the drag only half-works.
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

      // Nothing moves on the pointer itself: the tick does the moving.
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
      // Released, nothing keeps driving the value.
      expect(onChange.mock.calls.length).toBe(movedWhileHeld);
    } finally {
      vi.useRealTimers();
    }
  });

  it("steps by one on an arrow key, with no bounds to measure from", () => {
    // An unbounded control must still be arrowable, without a grid from negative infinity producing NaN.
    const onChange = vi.fn();
    render(
      <JogWheel
        mode="rate"
        value={1000}
        step={60}
        ariaLabel="Ignition"
        onChange={onChange}
      />,
    );
    const handle = screen.getByRole("slider", { name: "Ignition" });

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange.mock.calls[0][0]).toBe(1060);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange.mock.calls[1][0]).toBe(940);
  });

  it("moves an off-grid value by exactly one step, and snaps it to nothing", () => {
    // With no minimum there is no grid anchor, so one press moves by exactly one step.
    const onChange = vi.fn();
    render(
      <JogWheel
        mode="rate"
        value={1030}
        step={60}
        ariaLabel="Ignition"
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Ignition" }), {
      key: "ArrowRight",
    });

    expect(onChange.mock.calls[0][0]).toBe(1090);
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

describe("JogWheel with no value to show", () => {
  it("announces no number rather than NaN", () => {
    render(
      <JogWheel
        value={Number.NaN}
        min={0}
        max={90}
        step={1}
        ariaLabel="Yaw"
        format={() => "no reading"}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Yaw" });
    expect(slider).not.toHaveAttribute("aria-valuenow");
    expect(slider).toHaveAttribute("aria-valuetext", "no reading");
  });
});

describe("JogWheel label", () => {
  const wheel = (label?: string | false) => (
    <JogWheel
      value={5}
      min={0}
      max={9}
      step={1}
      ariaLabel="Yaw"
      label={label}
      onChange={() => {}}
    />
  );

  it("draws its accessible name above the wheel by default", () => {
    render(wheel());
    expect(screen.getByText("Yaw")).toBeInTheDocument();
  });

  it("draws the name it is given in place of the accessible one", () => {
    render(wheel("Heading"));
    expect(screen.getByText("Heading")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Yaw" })).toBeInTheDocument();
  });

  it("draws no name when told not to", () => {
    render(wheel(false));
    expect(screen.queryByText("Yaw")).toBeNull();
  });
});
