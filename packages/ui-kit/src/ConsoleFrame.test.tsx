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

  it("has no a11y violations", async () => {
    const { container } = render(
      <ConsoleFrame>
        <p>scrollback</p>
      </ConsoleFrame>,
    );
    await expectNoA11yViolations(container);
  });
});
