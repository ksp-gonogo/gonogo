import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
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
