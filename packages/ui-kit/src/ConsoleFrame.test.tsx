import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ConsoleFrame } from "./ConsoleFrame";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { emittedRuleFor as ruleFor } from "./test/emittedRule";

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

  it("holds the footer inside itself, with the scrollback", () => {
    /*
     * The property this whole primitive gained a slot for. Both consoles used
     * to stack their composer BELOW the frame, where it read as a box strapped
     * to the console rather than a control in the widget.
     */
    const { container } = render(
      <ConsoleFrame composer={<button type="button">Send</button>}>
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
    // An inbox is a list of conversations with no composer, and an inset empty
    // row at the bottom of it would be a control that is not there.
    const { container } = render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    expect(
      container.querySelector("[data-console-frame]")?.children,
    ).toHaveLength(1);
  });

  it("draws the standing reading at the foot, never over the scrollback", () => {
    /*
     * The defect this placement fixes. The slot was the top-right of the
     * scrollback, which on a column of prose is a sentence somebody has to
     * read: "I don't think it can stay in that top corner". At the foot it sits
     * on a border instead, and in the same column as the queue's countdowns,
     * because a separation and an ETA are the same kind of value and were
     * diagonally opposite each other.
     */
    const { container } = render(
      <ConsoleFrame
        standing={<span>one-way ~0.4 s</span>}
        composer={<button type="button">Send</button>}
      >
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const standing = container.querySelector("[data-console-standing]");
    expect(standing).not.toBeNull();
    expect(standing?.contains(screen.getByText("one-way ~0.4 s"))).toBe(true);
    // The foot that holds the input, never the surface that holds the log.
    expect(
      standing?.parentElement?.contains(
        screen.getByRole("button", { name: "Send" }),
      ),
    ).toBe(true);
    expect(
      standing?.parentElement?.contains(screen.getByText("scrollback")),
    ).toBe(false);
  });

  it("costs the body no height while there is a composer to straddle", () => {
    /*
     * The reason the slot is here rather than in each console: a badge as a
     * flex sibling adds its own row, and at a widget's declared minSize that
     * row pushes the composer out of the tile. Out of flow over the composer's
     * top border, so it adds none.
     */
    const { container } = render(
      <ConsoleFrame standing={<span>chip</span>} composer={<input />}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const standing = container.querySelector(
      "[data-console-standing]",
    ) as HTMLElement;
    expect(getComputedStyle(standing).position).toBe("absolute");
  });

  it("puts the standing reading back in flow when there is no composer", () => {
    /*
     * The state most likely to be got wrong. An inbox has nothing to type at,
     * so there is no border to straddle and an overlay would go back on the
     * prose. It takes a line of its own at the foot instead, growing a foot
     * that was not otherwise there, and pays the band of height that costs.
     */
    const { container } = render(
      <ConsoleFrame standing={<span>chip</span>}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const standing = container.querySelector(
      "[data-console-standing]",
    ) as HTMLElement;
    expect(getComputedStyle(standing).position).not.toBe("absolute");
    expect(
      container.querySelector("[data-console-frame]")?.children,
    ).toHaveLength(2);
    expect(
      standing.parentElement?.contains(screen.getByText("scrollback")),
    ).toBe(false);
  });

  it("keeps a falsy composer's foot but stops straddling it", () => {
    /*
     * A terminal in character mode composes nothing, so the foot stays (the
     * surface above must not change height with the mode) and the border it
     * would have straddled is gone with the composer.
     */
    const { container } = render(
      <ConsoleFrame standing={<span>chip</span>} composer={false}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const standing = container.querySelector(
      "[data-console-standing]",
    ) as HTMLElement;
    expect(getComputedStyle(standing).position).not.toBe("absolute");
  });

  it("draws no standing slot at all when there is no reading", () => {
    // An empty pinned box at the foot of every console is a slot showing
    // through, which is what a conditional slot is for.
    const { container } = render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    expect(container.querySelector("[data-console-standing]")).toBeNull();
  });

  it("puts the queue and the standing reading above the composer, in that order", () => {
    /*
     * Two slots rather than one `footer` node, so the frame can see whether
     * there is a composer to place the reading against instead of taking the
     * caller's word for it.
     *
     * The reading comes BEFORE the composer, which is where it is now drawn: on
     * the top border rather than the bottom, "above the composer, not below".
     * The straddle is out of flow and does not care, but the falsy-composer
     * state puts the same node in flow at this exact spot, and a screen reader
     * that hears the delay after the control it sits above hears it out of
     * order.
     */
    const { container } = render(
      <ConsoleFrame
        queue={<span>queue</span>}
        composer={<button type="button">Send</button>}
        standing={<span>chip</span>}
      >
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const foot = container.querySelector("[data-console-frame]")
      ?.lastElementChild as HTMLElement;
    expect(Array.from(foot.children).map((child) => child.textContent)).toEqual(
      ["queue", "chip", "Send"],
    );
  });

  it("straddles the composer's TOP border, never the bottom one", () => {
    /*
     * The operator's correction: "the trip time badge should sit above the
     * composer, not below". Read off the EMITTED RULE rather than
     * `getComputedStyle`, which resolves neither the `var()` offset nor an
     * `absolute` box it never laid out, and would report the initial value for
     * both edges whichever way the stylesheet ran.
     *
     * Both halves are asserted: a rule that grew a `top` while keeping its
     * `bottom` would pin the chip to a stretched box spanning the whole foot,
     * and the positive half alone reads green on it.
     */
    const { container } = render(
      <ConsoleFrame standing={<span>chip</span>} composer={<input />}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const rule = ruleFor(
      container.querySelector("[data-console-standing]") as HTMLElement,
    );
    expect(rule).toContain("top:var(--space-16)");
    expect(rule).toContain("translateY(-50%)");
    expect(rule).not.toContain("bottom:");
  });

  it("deepens the foot's TOP inset so the half-chip clears the scrollback", () => {
    /*
     * The base inset is a chip's padding shy of its half-height, so without the
     * deepening the part hanging above the border reaches back over the last
     * line of the log, which is the exact defect this reading was taken off the
     * prose to fix.
     */
    const { container } = render(
      <ConsoleFrame standing={<span>chip</span>} composer={<input />}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const foot = container.querySelector("[data-console-frame]")
      ?.lastElementChild as HTMLElement;
    expect(ruleFor(foot)).toContain("padding-top:var(--space-16)");
  });

  it("declares the tone for what is inside it, and wears none of it", () => {
    /*
     * The one difference between the app's two consoles, and a prop rather than
     * a stylesheet each: a terminal dispatching to a craft keeps the primary
     * accent, a message log carrying words takes the informational one.
     *
     * Read off the custom property rather than the frame's own border, because
     * the frame paints NOTHING with it: the accent belongs to the input, and
     * this is the declaration its border, prompt and focus ring all resolve, so
     * they cannot come out in different colours.
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
  });

  it("keeps its own border subtle, whatever the tone", () => {
    /*
     * The operator's correction, and the reason `tone` paints nothing here:
     * "I don't want that border to go round the entire widget, it can stay just
     * around the input". A toned outline here would seal the scrollback and the
     * composer into one console with a bottom section, instead of a widget with
     * a bordered control in it.
     *
     * Read off the EMITTED RULE rather than `getComputedStyle`, which is blind
     * to this: jsdom does not resolve a `border` shorthand carrying a `var()`
     * and answers "medium none rgb(0, 0, 0)" whatever the stylesheet says, so a
     * computed-style assertion here would pass just as happily with the tone
     * back on the frame. `ruleFor` throws when it finds no rule, because an
     * instrument that cannot see its own subject reports success.
     */
    for (const tone of ["accent", "info"] as const) {
      const { container } = render(<ConsoleFrame tone={tone}>a</ConsoleFrame>);
      const rule = ruleFor(
        container.querySelector("[data-console-frame]") as HTMLElement,
      );
      expect(rule).toContain("border:1px solid var(--color-border-subtle)");
      expect(rule).not.toContain("border:1px solid var(--console-tone-fg)");
    }
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
