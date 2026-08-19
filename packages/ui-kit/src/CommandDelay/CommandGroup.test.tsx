import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { CommandGroup } from "./CommandGroup";

interface PanTiltValue {
  pan: number;
  tilt: number;
  [key: string]: unknown;
}

function PanTiltHarness({
  onCommit,
  gated,
}: {
  onCommit: (v: PanTiltValue) => void;
  gated?: boolean;
}) {
  const [value, setValue] = useState<PanTiltValue>({ pan: 0, tilt: 0 });
  return (
    <CommandGroup
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      gated={gated}
    >
      <label>
        Pan
        <input
          type="number"
          value={value.pan}
          onChange={(e) =>
            setValue((v) => ({ ...v, pan: Number(e.target.value) }))
          }
        />
      </label>
      <label>
        Tilt
        <input
          type="number"
          value={value.tilt}
          onChange={(e) =>
            setValue((v) => ({ ...v, tilt: Number(e.target.value) }))
          }
        />
      </label>
    </CommandGroup>
  );
}

describe("CommandGroup", () => {
  it("collects N input values and fires onCommit ONCE with all of them, only on commit", () => {
    const onCommit = vi.fn();
    render(<PanTiltHarness onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText("Pan"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Tilt"), {
      target: { value: "12" },
    });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Commit"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ pan: 45, tilt: 12 });
  });

  it("disables and error-styles the commit control when gated, and never fires onCommit", () => {
    const onCommit = vi.fn();
    render(<PanTiltHarness onCommit={onCommit} gated />);

    fireEvent.change(screen.getByLabelText("Pan"), { target: { value: "90" } });
    const commitButton = screen.getByText("Commit");
    expect(commitButton).toBeDisabled();

    fireEvent.click(commitButton);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("has no axe violations, gated or not", async () => {
    const { container, rerender } = render(
      <PanTiltHarness onCommit={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(<PanTiltHarness onCommit={vi.fn()} gated />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
