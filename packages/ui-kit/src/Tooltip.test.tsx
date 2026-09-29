import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HeldFigure } from "./HeldMark";
import { useTooltip } from "./Tooltip";

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
