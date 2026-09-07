import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandGroup } from "./CommandGroup";

interface PanTiltValue {
  pan: number;
  tilt: number;
  [key: string]: unknown;
}

function PanTiltHarness({
  onCommit,
  gated,
  orientation,
  wrap,
}: {
  onCommit: (v: PanTiltValue) => void;
  gated?: boolean;
  orientation?: "column" | "row";
  wrap?: boolean;
}) {
  const [value, setValue] = useState<PanTiltValue>({ pan: 0, tilt: 0 });
  return (
    <CommandGroup
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      gated={gated}
      orientation={orientation}
      wrap={wrap}
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
    await expectNoA11yViolations(container);

    rerender(<PanTiltHarness onCommit={vi.fn()} gated />);
    await expectNoA11yViolations(container);
  });
});

/**
 * Arrangement. A stacked group spends about 30px of height on the commit row
 * and wraps its inputs unconditionally, which is the wrong shape for a strip of
 * corner-sized controls; neither could be changed from outside.
 */
describe("CommandGroup arrangement", () => {
  const parts = (container: HTMLElement) => {
    const root = container.firstElementChild as HTMLElement;
    const inputs = root.firstElementChild as HTMLElement;
    return {
      direction: getComputedStyle(root).flexDirection,
      wrap: getComputedStyle(inputs).flexWrap,
      commitAlign: getComputedStyle(root.lastElementChild as HTMLElement)
        .alignSelf,
    };
  };

  it("stacks and wraps by default, exactly as it always has", () => {
    const { container } = render(<PanTiltHarness onCommit={vi.fn()} />);
    expect(parts(container)).toEqual({
      direction: "column",
      wrap: "wrap",
      commitAlign: "flex-start",
    });
  });

  it("puts the commit beside the inputs when asked", () => {
    const { container } = render(
      <PanTiltHarness onCommit={vi.fn()} orientation="row" />,
    );
    expect(parts(container)).toMatchObject({
      direction: "row",
      commitAlign: "center",
    });
  });

  it("holds the inputs on one line when wrapping is turned off", () => {
    const { container } = render(
      <PanTiltHarness onCommit={vi.fn()} wrap={false} />,
    );
    expect(parts(container).wrap).toBe("nowrap");
  });

  it("still commits once with the whole value in the inline arrangement", () => {
    const onCommit = vi.fn();
    render(
      <PanTiltHarness onCommit={onCommit} orientation="row" wrap={false} />,
    );

    fireEvent.change(screen.getByLabelText("Pan"), { target: { value: "45" } });
    fireEvent.click(screen.getByText("Commit"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ pan: 45, tilt: 0 });
  });

  it("has no axe violations in the inline arrangement", async () => {
    const { container } = render(
      <PanTiltHarness onCommit={vi.fn()} orientation="row" wrap={false} />,
    );
    await expectNoA11yViolations(container);
  });
});
