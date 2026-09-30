import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { ReadFrameControl } from "./ReadFrameControl";

const INERTIAL = { kind: "body-centred-inertial", bodyIndex: 1 } as const;
const PARENT_DIRECTION = { kind: "parent-direction", bodyIndex: 1 } as const;
const FOLLOW = { kind: "follow-control-frame" } as const;

const OPTIONS = [
  { choice: INERTIAL, label: "Hold the sky still" },
  { choice: PARENT_DIRECTION, label: "Hold the parent still" },
  { choice: FOLLOW, label: "Follow the in-game view" },
];

describe("ReadFrameControl", () => {
  it("labels the control and selects the option matching the current value", () => {
    render(
      <ReadFrameControl
        id="rf"
        label="Draw the picture in"
        value={PARENT_DIRECTION}
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", {
      name: "Draw the picture in",
    }) as HTMLSelectElement;
    expect(select.value).toBe("1");
    expect((select.options[1] as HTMLOptionElement).textContent).toBe(
      "Hold the parent still",
    );
  });

  it("reports the chosen option's ReadFrameChoice, not a string id, on change", () => {
    const onChange = vi.fn();
    render(
      <ReadFrameControl
        id="rf"
        label="Draw the picture in"
        value={INERTIAL}
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const select = screen.getByRole("combobox", {
      name: "Draw the picture in",
    });
    fireEvent.change(select, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(FOLLOW);
  });

  it("is keyboard-operable: focusing and changing via keys fires onChange", () => {
    const onChange = vi.fn();
    render(
      <ReadFrameControl
        id="rf"
        label="Draw the picture in"
        value={INERTIAL}
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const select = screen.getByRole("combobox", {
      name: "Draw the picture in",
    }) as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);
    fireEvent.change(select, { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith(PARENT_DIRECTION);
  });

  it("shows the hint when given one", () => {
    render(
      <ReadFrameControl
        id="rf"
        label="Draw the picture in"
        value={INERTIAL}
        options={OPTIONS}
        onChange={vi.fn()}
        hint="This changes what the axes do."
      />,
    );
    expect(screen.getByText("This changes what the axes do.")).toBeTruthy();
  });

  it("falls back to a blank, disabled placeholder when the value matches nothing on offer", () => {
    render(
      <ReadFrameControl
        id="rf"
        label="Draw the picture in"
        value={{ kind: "rotating-pulsating", bodyIndex: 9 }}
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", {
      name: "Draw the picture in",
    }) as HTMLSelectElement;
    expect(select.value).toBe("");
  });
});
