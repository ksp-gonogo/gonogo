import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SendIcon } from "../Icons";
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

/**
 * A commit with no room for the word. The type-level half of this (a glyph
 * cannot be passed without a name) is pinned in `CommandGroup.test-d.tsx`;
 * these are the halves a typecheck cannot see.
 */
describe("CommandGroup icon-only commit", () => {
  /*
   * `commitAriaLabel` is passed through a non-null assertion so a test can omit
   * it: that stands in for the caller the types cannot see, which is the whole
   * reason the component warns as well as refusing at compile time.
   */
  const IconCommit = ({
    onCommit = vi.fn(),
    commitLabel = <SendIcon size={16} />,
    commitAriaLabel,
  }: {
    onCommit?: (v: { pan: number }) => void;
    commitLabel?: ReactNode;
    commitAriaLabel?: string;
  }) => (
    <CommandGroup
      value={{ pan: 0 }}
      onChange={vi.fn()}
      onCommit={onCommit}
      commitLabel={commitLabel}
      // biome-ignore lint/style/noNonNullAssertion: stands in for a caller the types cannot see
      commitAriaLabel={commitAriaLabel!}
    >
      <label>
        Pan
        <input type="number" readOnly value={0} />
      </label>
    </CommandGroup>
  );

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the button by the action, and commits on press", () => {
    const onCommit = vi.fn();
    render(<IconCommit onCommit={onCommit} commitAriaLabel="Commit framing" />);

    fireEvent.click(screen.getByRole("button", { name: "Commit framing" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ pan: 0 });
  });

  it("squares the inset so the glyph is not sitting in a word-shaped gap", () => {
    render(<IconCommit commitAriaLabel="Commit framing" />);
    expect(getComputedStyle(screen.getByRole("button")).display).toBe(
      "inline-flex",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <IconCommit commitAriaLabel="Commit framing" />,
    );
    await expectNoA11yViolations(container);
  });

  /*
   * What is left when the name goes missing is a button whose only content is
   * an `aria-hidden` glyph, i.e. no accessible name at all. It renders fine and
   * it commits fine, which is exactly why it has to say something.
   */
  it("warns in dev when a glyph commit arrives with no name to go with it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<IconCommit commitAriaLabel={undefined} />);

    expect(screen.getByRole("button")).not.toHaveAccessibleName();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no accessible name"),
    );
  });

  it("says nothing when the label is a word, which names itself", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<IconCommit commitLabel="Commit" commitAriaLabel={undefined} />);

    expect(screen.getByRole("button", { name: "Commit" })).toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
  });
});
