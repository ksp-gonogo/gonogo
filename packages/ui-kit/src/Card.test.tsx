import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";
import { resourceColor } from "./resourceColor";

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Kerbin Explorer I</Card>);
    expect(screen.getByText("Kerbin Explorer I")).toBeInTheDocument();
  });

  it("forwards arbitrary div attributes", () => {
    render(<Card data-testid="vessel-card">Contents</Card>);
    expect(screen.getByTestId("vessel-card")).toHaveTextContent("Contents");
  });

  it("colours the leading edge from an explicit accentColor", () => {
    render(
      <Card accentColor="#123456" data-testid="card">
        Contents
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveStyle(
      "border-left: 3px solid #123456",
    );
  });

  it("accepts a colour the caller already resolved via resourceColor", () => {
    // Card takes only a plain colour: it never imports resourceColor itself.
    // A caller wanting the resource-identity look resolves the name first
    // (the same way Meter's own fillColor doc asks for) and passes the
    // result in, proving the two compose without Card depending on the
    // resource-colour system.
    render(
      <Card accentColor={resourceColor("LiquidFuel")} data-testid="fuel-card">
        Contents
      </Card>,
    );
    expect(screen.getByTestId("fuel-card")).toHaveStyle(
      `border-left: 3px solid ${resourceColor("LiquidFuel")}`,
    );
  });

  it("prefers accentColor over a tone accent", () => {
    render(
      <Card tone="alert" accentColor="#123456" data-testid="card">
        Contents
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveStyle(
      "border-left: 3px solid #123456",
    );
  });

  it("falls back to the tone accent rule when no accentColor is given", () => {
    render(
      <Card tone="alert" data-testid="card">
        Contents
      </Card>,
    );
    // jsdom's CSS parser drops a `border-left` shorthand entirely once it
    // contains an unresolved `var()` (it can't validate the colour term), so
    // `toHaveStyle` can't see this rule (this is the pre-existing `tone`
    // behaviour, unchanged by this file's new accentColor prop); asserting on
    // the styled-components injected <style> text sidesteps the
    // shorthand-parsing gap instead of leaving the rule untested.
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(styleText).toContain(
      "border-left:2px solid var(--color-status-nogo-bg);",
    );
  });
});
