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

  it("holds the footer inside itself, with the scrollback", () => {
    /*
     * The property this whole primitive gained a slot for. Both consoles used
     * to stack their composer BELOW the frame, where it read as a box strapped
     * to the console rather than a control in the widget.
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

  it("pins the corner over the scrollback, not over the composer", () => {
    /*
     * The corner is the console's standing-reading slot, and the operator's
     * ruling on where it goes: "I like it in the top right corner, please can
     * we just align to that". A reading pinned there is over what has already
     * been said; the same reading in the composer row sits on the line being
     * typed, which is what the two consoles had drifted to doing differently.
     */
    const { container } = render(
      <ConsoleFrame
        corner={<span>one-way ~0.4 s</span>}
        footer={<button type="button">Send</button>}
      >
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const corner = container.querySelector("[data-console-corner]");
    expect(corner).not.toBeNull();
    expect(corner?.contains(screen.getByText("one-way ~0.4 s"))).toBe(true);
    // Over the scrollback: the corner's parent is the surface that holds it,
    // never the foot that holds the input.
    expect(
      corner?.parentElement?.contains(screen.getByText("scrollback")),
    ).toBe(true);
    expect(
      corner?.parentElement?.contains(
        screen.getByRole("button", { name: "Send" }),
      ),
    ).toBe(false);
  });

  it("costs the body no height for what it pins in the corner", () => {
    /*
     * The reason the slot is here rather than in each console: a badge as a
     * flex sibling adds its own row, and at a widget's declared minSize that
     * row pushes the composer out of the tile. Absolute, so it is out of flow.
     */
    const { container } = render(
      <ConsoleFrame corner={<span>chip</span>}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const corner = container.querySelector(
      "[data-console-corner]",
    ) as HTMLElement;
    expect(getComputedStyle(corner).position).toBe("absolute");
  });

  it("draws no corner at all when there is no standing reading", () => {
    // An empty pinned box in the corner of every console is a slot showing
    // through, which is what a conditional slot is for.
    const { container } = render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    expect(container.querySelector("[data-console-corner]")).toBeNull();
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

/**
 * The CSS styled-components actually emitted for `element`'s own generated
 * class, as text.
 *
 * Needed because jsdom's computed style cannot resolve a shorthand containing a
 * `var()` and returns the initial value instead, which makes every
 * `getComputedStyle(...).border` assertion in this file's subject area vacuous.
 * Throws rather than returning empty when no rule matches: a lookup that
 * silently finds nothing turns "the border is subtle" into "no border was
 * examined", and both read green.
 */
function ruleFor(element: HTMLElement): string {
  const generated = Array.from(element.classList).filter(
    (name) => !name.startsWith("sc-"),
  );
  const sheet = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("");
  for (const name of generated) {
    const at = sheet.indexOf(`.${name}{`);
    if (at !== -1) {
      return sheet.slice(at, sheet.indexOf("}", at) + 1);
    }
  }
  throw new Error(
    `no emitted rule for any of [${generated.join(", ")}]; the stylesheet lookup is broken, not the border`,
  );
}
