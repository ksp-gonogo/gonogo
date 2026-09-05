/**
 * What a button does with an icon standing next to a word.
 *
 * An `<svg>` is inline content, so a button that lays its children out as text
 * puts the glyph on the BASELINE: it hangs below the middle of the word and
 * touches it. That is invisible to a role query and to every render assertion
 * in this suite, which is why it survived long enough to be spotted in a video
 * of the app rather than in CI.
 */
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Button, GhostButton, PrimaryButton } from "./Button";
import { PlusIcon } from "./Icons";

describe("a kit button carrying an icon and a word", () => {
  it("centres its children rather than sitting them on the text baseline", () => {
    render(
      <Button data-testid="compose">
        <PlusIcon size={14} />
        New message
      </Button>,
    );
    const style = getComputedStyle(screen.getByTestId("compose"));
    expect(style.display).toBe("inline-flex");
    expect(style.alignItems).toBe("center");
    // And a gap, so the glyph is not touching the first letter.
    expect(style.gap).not.toBe("");
    expect(style.gap).not.toBe("normal");
  });

  it("hands the same layout to the variants built on it", () => {
    // The variants restyle colour and nothing else, and an operator meets them
    // in the same bar as the base: a Ghost "Inbox" beside a plain "New message"
    // is exactly where the two answers were visibly different.
    render(
      <>
        <GhostButton data-testid="ghost">
          <PlusIcon size={14} />
          Ghost
        </GhostButton>
        <PrimaryButton data-testid="primary">
          <PlusIcon size={14} />
          Primary
        </PrimaryButton>
      </>,
    );
    for (const id of ["ghost", "primary"]) {
      const style = getComputedStyle(screen.getByTestId(id));
      expect(style.display, id).toBe("inline-flex");
      expect(style.alignItems, id).toBe("center");
    }
  });
});
