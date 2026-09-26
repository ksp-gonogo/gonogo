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
    // A badge stacked above the pane would add a row and push the composer out of a tile at its minSize.
    render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const frame = screen.getByText("scrollback").parentElement;
    expect(frame && getComputedStyle(frame).position).toBe("relative");
  });

  it("holds the footer inside itself, with the scrollback", () => {
    // The composer sits inside the frame, a control in the widget rather than a box strapped below it.
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
    // An inbox has no composer, and an empty inset row would read as a missing control.
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
    // At the foot, on a border and in the queue's column, never over the prose.
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
    // Out of flow over the composer's top border, so it adds no height.
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
    // With no border to straddle, the chip takes a line of its own at a foot grown for it.
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
    // Character mode keeps the foot so the surface height is stable, but has no border to straddle.
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
    // No empty pinned box at the foot when there is no reading.
    const { container } = render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    expect(container.querySelector("[data-console-standing]")).toBeNull();
  });

  it("puts the queue and the standing reading above the composer, in that order", () => {
    // The reading comes BEFORE the composer in DOM order, so a screen reader hears it in the order it is drawn.
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
     * Above the composer, not below. Read off the emitted rule, since jsdom
     * resolves no `var()` offset; both halves are asserted, because `top` plus
     * `bottom` would stretch the chip across the foot.
     */
    const { container } = render(
      <ConsoleFrame standing={<span>chip</span>} composer={<input />}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const rule = ruleFor(
      container.querySelector("[data-console-standing]") as HTMLElement,
    );
    expect(rule).toContain("top:var(--inset-console-foot-straddled)");
    expect(rule).toContain("translateY(-50%)");
    expect(rule).not.toContain("bottom:");
  });

  it("deepens the foot's TOP inset so the half-chip clears the scrollback", () => {
    // Without the deeper inset, the half-chip above the border would reach over the log's last line.
    const { container } = render(
      <ConsoleFrame standing={<span>chip</span>} composer={<input />}>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    const foot = container.querySelector("[data-console-frame]")
      ?.lastElementChild as HTMLElement;
    expect(ruleFor(foot)).toContain(
      "padding-top:var(--inset-console-foot-straddled)",
    );
  });

  it("declares the tone for what is inside it, and wears none of it", () => {
    // Read off the custom property: the frame paints nothing with the tone, the input's border, prompt and focus ring resolve it.
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
     * The accent belongs to the input, not the frame. Read off the emitted
     * rule, since jsdom does not resolve a `border` shorthand holding a
     * `var()`; `ruleFor` throws when it finds no rule, so a blind check fails.
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
