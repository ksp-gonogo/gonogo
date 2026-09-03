import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ComposerBar } from "./ComposerBar";
import { expectNoA11yViolations } from "./expectNoA11yViolations";

describe("ComposerBar", () => {
  it("renders its children", () => {
    render(
      <ComposerBar>
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
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
    // A lost path is an ambient condition. `alert` would interrupt whatever a
    // screen reader was saying, on a condition that persists for minutes.
    render(
      <ComposerBar blocked flag="NO PATH">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    const flag = screen.getByRole("status");
    expect(flag.textContent).toBe("NO PATH");
  });

  it("keeps the flag out of the bar's own layout", () => {
    // The whole reason the flag is pinned: a composer in a tile at its
    // declared minSize has no spare height, so the flag must cost none.
    render(
      <ComposerBar blocked flag="NO PATH">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(getComputedStyle(screen.getByRole("status")).position).toBe(
      "absolute",
    );
  });

  it("draws no send button unless one is asked for", () => {
    // A composer whose only send is a key binding must not grow a control it
    // never wired.
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
    /*
     * The two states are different: a composer with nothing typed is perfectly
     * able to accept input and still has nothing to send, so the outline must
     * not turn on it.
     */
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
      <ComposerBar onSend={() => {}} sendLabel="Run">
        <input aria-label="Message" />
      </ComposerBar>,
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });

  it("pushes the button to the far end without a spacer from the caller", () => {
    /*
     * A terminal's composed line does not flex, so without the button's own
     * auto margin it sits against the last character typed and moves with
     * every keystroke.
     */
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
