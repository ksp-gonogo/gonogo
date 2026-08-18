import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { JogWheel } from "./JogWheel";
import { axe } from "./test/axe";

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
    expect(await axe(container)).toHaveNoViolations();
  });
});
