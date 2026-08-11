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

  it("colours a short centred top tab from categoryColor, distinct from the left status strip", () => {
    // Not a full-width border: operator feedback called the earlier
    // full-edge strip too busy (it read as a second meter). categoryColor
    // now draws a short, centred `::before` tab instead of a `border-top`,
    // so `toHaveStyle` (which only sees the real element's own computed
    // style) can't reach it; assert on the injected <style> text instead,
    // matching the pattern the `tone` accent test already uses for the same
    // jsdom limitation.
    render(
      <Card categoryColor="#654321" data-testid="card">
        Contents
      </Card>,
    );
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(styleText).toContain("::before{");
    expect(styleText).toContain("width:var(--space-24, 24px);");
    expect(styleText).toContain("left:50%;");
    expect(styleText).toContain("transform:translateX(-50%);");
    expect(styleText).toContain("background:#654321;");
    // No leftover full-width border-top rule from the old strip.
    expect(styleText).not.toContain("border-top: 3px solid #654321");
  });

  it("shows a status accent on the left AND a category tab on top at once", () => {
    render(
      <Card tone="alert" categoryColor="#654321" data-testid="card">
        Contents
      </Card>,
    );
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    // Left edge still carries the STATUS accent (tone), unaffected by
    // categoryColor: the two strips answer different questions and neither
    // should have to win over the other.
    expect(styleText).toContain(
      "border-left:2px solid var(--color-status-nogo-bg);",
    );
    expect(styleText).toContain("::before{");
    expect(styleText).toContain("background:#654321;");
  });

  it("composes categoryColor with accentColor too (left identity, top category tab)", () => {
    render(
      <Card accentColor="#123456" categoryColor="#654321" data-testid="card">
        Contents
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveStyle(
      "border-left: 3px solid #123456",
    );
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(styleText).toContain("::before{");
    expect(styleText).toContain("background:#654321;");
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
