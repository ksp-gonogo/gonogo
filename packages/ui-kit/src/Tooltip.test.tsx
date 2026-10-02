import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeldFigure } from "./HeldMark";
import { Tooltip, useTooltip } from "./Tooltip";

function Anchored({ text }: { text: string | null }) {
  const { anchor, tip } = useTooltip(text);
  return (
    <span data-testid="anchor" {...anchor}>
      42 km{tip}
    </span>
  );
}

const tipIn = (root: ParentNode) =>
  root.querySelector<HTMLElement>("[data-tooltip-tip]");

describe("useTooltip", () => {
  it("opens the tip on the document body while the pointer is over the anchor", async () => {
    const user = userEvent.setup();
    const { container } = render(<Anchored text="Held since Y1 D12" />);
    const anchor = screen.getByTestId("anchor");
    expect(tipIn(document.body)).toBeNull();

    await user.hover(anchor);
    const tip = tipIn(document.body);
    expect(tip).toHaveTextContent("Held since Y1 D12");
    expect(tip).toHaveAttribute("aria-hidden", "true");
    expect(container.contains(tip)).toBe(false);

    await user.unhover(anchor);
    expect(tipIn(document.body)).toBeNull();
  });

  it("leaves an anchor with nothing to say inert", async () => {
    const user = userEvent.setup();
    render(<Anchored text={null} />);
    const anchor = screen.getByTestId("anchor");
    expect(anchor).not.toHaveAttribute("data-tooltip");
    await user.hover(anchor);
    expect(tipIn(document.body)).toBeNull();
  });
});

describe("HeldFigure", () => {
  it("speaks its caption, marks the figure, and shows the caption as the kit tip rather than a native title", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HeldFigure caption="held, as of Y1 D12">12:00</HeldFigure>,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host).not.toHaveAttribute("title");
    expect(host.querySelector("[data-held-mark]")).not.toBeNull();
    expect(host).toHaveTextContent("12:00, held, as of Y1 D12");

    await user.hover(host);
    expect(tipIn(document.body)).toHaveTextContent("held, as of Y1 D12");
  });
});

describe("Tooltip", () => {
  it("describes a button by its text without a native title, on hover", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Saves the game first">
        <button type="button">Leave</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Leave" });
    expect(button).not.toHaveAttribute("title");
    expect(button).toHaveAttribute("aria-description", "Saves the game first");
    expect(tipIn(document.body)).toBeNull();

    await user.hover(button);
    expect(tipIn(document.body)).toHaveTextContent("Saves the game first");
    await user.unhover(button);
    expect(tipIn(document.body)).toBeNull();
  });

  it("opens for keyboard focus and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Pause the warp">
        <button type="button">Warp</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Warp" })).toHaveFocus();
    expect(tipIn(document.body)).toHaveTextContent("Pause the warp");

    await user.keyboard("{Escape}");
    expect(tipIn(document.body)).toBeNull();
  });

  it("makes a non-control child reachable only when asked", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip text="Held since Y1 D12" focusable>
          <span data-testid="readout">42 km</span>
        </Tooltip>
        <Tooltip text="Not a stop">
          <span data-testid="plain">7</span>
        </Tooltip>
      </>,
    );
    expect(screen.getByTestId("readout")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("plain")).not.toHaveAttribute("tabindex");
    await user.tab();
    expect(screen.getByTestId("readout")).toHaveFocus();
    expect(tipIn(document.body)).toHaveTextContent("Held since Y1 D12");
  });

  it("adds nothing when the child is already named by the same text", () => {
    render(
      <Tooltip text="Close details">
        <button type="button" aria-label="Close details">
          x
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Close details" });
    expect(button).not.toHaveAttribute("aria-description");
  });

  it("passes the child through when there is nothing to say", () => {
    render(
      <Tooltip text={null}>
        <button type="button">Plain</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Plain" });
    expect(button).not.toHaveAttribute("data-tooltip");
    expect(button).not.toHaveAttribute("aria-description");
  });

  it("keeps the child's own handlers", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onFocus = vi.fn();
    render(
      <Tooltip text="Go">
        <button type="button" onClick={onClick} onFocus={onFocus}>
          Go
        </button>
      </Tooltip>,
    );
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onFocus).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
