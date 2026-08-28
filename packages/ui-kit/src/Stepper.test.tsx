import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { Stepper } from "./Stepper";

const STEPS = [64, 128, 256, 512] as const;

describe("Stepper", () => {
  it("announces the member rather than the index", () => {
    render(
      <Stepper
        options={STEPS}
        value={256}
        onChange={() => {}}
        label="Max steps"
        format={(v) => v.toLocaleString("en-GB")}
      />,
    );
    const spin = screen.getByRole("spinbutton", { name: "Max steps" });
    expect(spin).toHaveAttribute("aria-valuetext", "256");
    // The index, not the value: the members are not evenly spaced, so a
    // position on the set is the only thing a min/max pair can honestly bound.
    expect(spin).toHaveAttribute("aria-valuenow", "2");
    expect(spin).toHaveAttribute("aria-valuemax", "3");
  });

  it("steps through the set on the arrow keys and to the ends on Home and End", () => {
    const onChange = vi.fn();
    render(
      <Stepper
        options={STEPS}
        value={128}
        onChange={onChange}
        label="Max steps"
      />,
    );
    const spin = screen.getByRole("spinbutton", { name: "Max steps" });

    fireEvent.keyDown(spin, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(256);
    fireEvent.keyDown(spin, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(64);
    fireEvent.keyDown(spin, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(512);
    fireEvent.keyDown(spin, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(64);
  });

  it("never steps past either end", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper
        options={STEPS}
        value={512}
        onChange={onChange}
        label="Max steps"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Increase Max steps" }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <Stepper
        options={STEPS}
        value={64}
        onChange={onChange}
        label="Max steps"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Decrease Max steps" }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "ArrowDown" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("steps to an end from a value the set does not contain", () => {
    // A producer may hold a value no control here offered, and the operator
    // still has to be able to move it. Disabling both controls would strand
    // them; guessing a neighbour would move the number somewhere they did not
    // ask for.
    const onChange = vi.fn();
    render(
      <Stepper
        options={STEPS}
        value={100}
        onChange={onChange}
        label="Max steps"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Increase Max steps" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Decrease Max steps" }));
    expect(onChange).toHaveBeenLastCalledWith(64);
  });

  it("takes the keyboard out of the tab order while disabled", () => {
    render(
      <Stepper
        options={STEPS}
        value={128}
        onChange={() => {}}
        label="Max steps"
        disabled
      />,
    );
    expect(screen.getByRole("spinbutton")).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByRole("button", { name: "Increase Max steps" }),
    ).toBeDisabled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Stepper
        options={STEPS}
        value={128}
        onChange={() => {}}
        label="Max steps"
      >
        Raise this when the plan cannot be drawn.
      </Stepper>,
    );
    await expectNoA11yViolations(container);
  });
});
