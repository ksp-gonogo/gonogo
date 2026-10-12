import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ComposerBar } from "./ComposerBar";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { emittedRuleFor } from "./test/emittedRule";

describe("ComposerBar", () => {
  it("renders its children", () => {
    render(
      <ComposerBar>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
  });

  it("shows the send tooltip as a kit tip, describes the button with it, and never disables the send", () => {
    render(
      <ComposerBar onSend={() => {}} sendTooltip={"No contact\nLikely lost"}>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    expect(send).not.toHaveAttribute("title");
    expect(send).toHaveAccessibleDescription("No contact. Likely lost");
    fireEvent.focus(send);
    expect(document.querySelector("[data-tooltip-tip]")).toHaveTextContent(
      "No contact Likely lost",
    );
  });

  it("renders no flag when none is given", () => {
    render(
      <ComposerBar blocked>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces the flag politely rather than as an alert", () => {
    // A lost path is ambient and persists for minutes, so `alert` would be wrong.
    render(
      <ComposerBar blocked flag="NO PATH">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    const flag = screen.getByRole("status");
    expect(flag.textContent).toBe("NO PATH");
  });

  it("keeps the flag out of the bar's own layout", () => {
    // A composer at its tile's minSize has no spare height, so the flag must cost none.
    render(
      <ComposerBar blocked flag="NO PATH">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(getComputedStyle(screen.getByRole("status")).position).toBe(
      "absolute",
    );
  });

  it("takes the LEFT end of the top border, leaving the right for the console", () => {
    /*
     * The console's delay reading takes the right end of this border and both
     * can show at once, so the flag takes the left. Read off the emitted rule,
     * since jsdom resolves no `var()` inset; both halves are asserted, because
     * a flag with both `left` and `right` would stretch across the row.
     */
    render(
      <ComposerBar blocked flag="NO PATH">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    const rule = emittedRuleFor(screen.getByRole("status"));
    expect(rule).toContain("left:var(--inset-console-foot)");
    expect(rule).not.toContain("right:");
  });

  it("draws the prompt glyph the caller asks for, and hides it from readers", () => {
    // Decorative: the glyph announced as a character would be noise.
    const { container } = render(
      <ComposerBar prompt="❯">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(container.querySelector("[aria-hidden='true']")?.textContent).toBe(
      "❯",
    );
  });

  it("draws no prompt for a composer that chooses rather than types", () => {
    // The recipient picker sends on the same bar and has nothing to prompt for.
    const { container } = render(
      <ComposerBar>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("draws no send button unless one is asked for", () => {
    // A composer whose only send is a key binding must not grow a control it never wired.
    render(
      <ComposerBar>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("commits through the caller's own send path", () => {
    let sent = 0;
    render(
      <ComposerBar onSend={() => sent++}>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(sent).toBe(1);
  });

  it("refuses the press without blocking the bar", () => {
    // Nothing typed still accepts input, so the outline must not turn.
    render(
      <ComposerBar onSend={() => {}} sendDisabled>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("takes the caller's verb", () => {
    render(
      <ComposerBar onSend={() => {}} sendLabel="Run" sendVariant="text">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });

  it("sends on a glyph rather than on the word, and still names itself", () => {
    // The verb moves from the button's text to its accessible name, so it is still announced as "Send".
    render(
      <ComposerBar onSend={() => {}}>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.textContent).toBe("");
    expect(send.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the word for a composer whose verb has no glyph", () => {
    // A send arrow on "Open" would claim the row transmits something.
    render(
      <ComposerBar onSend={() => {}} sendLabel="Open" sendVariant="text">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    const send = screen.getByRole("button", { name: "Open" });
    expect(send.textContent).toBe("Open");
    expect(send.querySelector("svg")).toBeNull();
  });

  it("has no a11y violations with an icon-only send", async () => {
    // An icon-only control with no accessible name is what this guards.
    const { container } = render(
      <ComposerBar onSend={() => {}}>
        <label htmlFor="msg-icon">Message</label>
        <input id="msg-icon" />
      </ComposerBar>,
    );
    await expectNoA11yViolations(container);
  });

  it("pushes the button to the far end without a spacer from the caller", () => {
    // A terminal's composed line does not flex, so without its own auto margin the button would move with every keystroke.
    render(
      <ComposerBar onSend={() => {}}>
        <span>&gt; run boot.</span>
      </ComposerBar>,
    );
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Send" })).marginLeft,
    ).toBe("auto");
  });

  it("has no a11y violations with a send button and a flag", async () => {
    const { container } = render(
      <ComposerBar blocked flag="NO PATH" onSend={() => {}} sendDisabled>
        <label htmlFor="msg-send">Message</label>
        <input id="msg-send" />
      </ComposerBar>,
    );
    await expectNoA11yViolations(container);
  });

  it("has no a11y violations while blocked and flagged", async () => {
    const { container } = render(
      <ComposerBar blocked flag="NO PATH">
        <label htmlFor="msg">Message</label>
        <input id="msg" />
      </ComposerBar>,
    );
    await expectNoA11yViolations(container);
  });
});
