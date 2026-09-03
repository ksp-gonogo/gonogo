import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ConsoleFrame } from "./ConsoleFrame";
import { expectNoA11yViolations } from "./expectNoA11yViolations";

describe("ConsoleFrame", () => {
  it("renders its content", () => {
    render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    expect(screen.getByText("scrollback")).toBeInTheDocument();
  });

  it("is a positioning context, so a pinned child costs the body no height", () => {
    // The whole reason this primitive exists rather than a plain bordered div: a status badge stacked above the pane adds a row, and at a widget's declared minSize that row pushes the composer out of the tile.
    render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const frame = screen.getByText("scrollback").parentElement;
    expect(frame && getComputedStyle(frame).position).toBe("relative");
  });

  it("holds the footer inside its own border, with the scrollback", () => {
    /*
     * The property this whole primitive gained a slot for. Both consoles used
     * to stack their composer BELOW the frame, so the border contained a
     * terminal screen in one and a column of messages in the other and the two
     * widgets read as unrelated. Inside, the outline contains the same two
     * things everywhere: what has been said, and where you say the next thing.
     */
    const { container } = render(
      <ConsoleFrame footer={<button type="button">Send</button>}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const frame = container.querySelector("[data-console-frame]");
    expect(frame).not.toBeNull();
    expect(frame?.contains(screen.getByText("scrollback"))).toBe(true);
    expect(frame?.contains(screen.getByRole("button", { name: "Send" }))).toBe(
      true,
    );
  });

  it("draws no foot at all when there is nothing to type", () => {
    // An inbox is a list of conversations with no composer, and an empty band
    // at the bottom of it would be a control that is not there.
    const { container } = render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    expect(
      container.querySelector("[data-console-frame]")?.children,
    ).toHaveLength(1);
  });

  it("takes its accent from the tone prop, and the error tone over both", () => {
    /*
     * The one difference between the app's two consoles, and a prop rather than
     * a stylesheet each: a terminal dispatching to a craft keeps the primary
     * accent, a message log carrying words takes the informational one. Read
     * off the custom property because that is also what the composer's rule and
     * a caller's prompt glyph resolve, so this pins that they cannot disagree.
     */
    const toneOf = (element: Element | null) =>
      element &&
      getComputedStyle(element).getPropertyValue("--console-tone-fg");

    const accent = render(<ConsoleFrame>a</ConsoleFrame>);
    expect(
      toneOf(accent.container.querySelector("[data-console-frame]")),
    ).toContain("--color-accent-fg");

    const info = render(<ConsoleFrame tone="info">b</ConsoleFrame>);
    expect(
      toneOf(info.container.querySelector("[data-console-frame]")),
    ).toContain("--color-status-info-fg");

    /*
     * Refusing input outranks whichever accent the console normally answers in:
     * an operator typing into a console that is not sending must see it on the
     * box, not work it out from a chip.
     */
    const blocked = render(
      <ConsoleFrame tone="info" blocked>
        c
      </ConsoleFrame>,
    );
    expect(
      toneOf(blocked.container.querySelector("[data-console-frame]")),
    ).toContain("--color-status-nogo-fg");
  });

  it("has no a11y violations", async () => {
    const { container } = render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    await expectNoA11yViolations(container);
  });
});
