import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Block } from "./Block";
import { Card } from "./Card";
import { resourceColor } from "./resourceColor";

/**
 * Every styled-components rule the render injected, as one string. jsdom drops
 * a `border-left` shorthand holding an unresolved `var()` and never evaluates
 * `::before`, so `toHaveStyle` cannot reach the tone rule or the identity tab.
 */
function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent)
    .join("\n");
}

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Kerbin Explorer I</Card>);
    expect(screen.getByText("Kerbin Explorer I")).toBeInTheDocument();
  });

  it("forwards arbitrary div attributes", () => {
    render(<Card data-testid="vessel-card">Contents</Card>);
    expect(screen.getByTestId("vessel-card")).toHaveTextContent("Contents");
  });

  it("draws a heading for the title, above the body", () => {
    render(
      <Card title="Kerbin Explorer I" data-testid="card">
        <span>Apoapsis 84km</span>
      </Card>,
    );
    const card = screen.getByTestId("card");
    const title = screen.getByText("Kerbin Explorer I");
    expect(card).toContainElement(title);
    // The arrangement declares both sides of the size step: title and body.
    expect(injectedCss()).toContain("font-size:var(--font-size-value);");
    expect(injectedCss()).toContain("font-size:var(--font-size-compact);");
    // The name precedes the figures in DOM order too, which is what a screen reader walks.
    expect(
      title.compareDocumentPosition(screen.getByText("Apoapsis 84km")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("draws titleRight after the title, never before it", () => {
    render(<Card title="Kerbin Explorer I" titleRight={<span>DOCKED</span>} />);
    const title = screen.getByText("Kerbin Explorer I");
    expect(title.compareDocumentPosition(screen.getByText("DOCKED"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("renders every aside, the footer and the body together", () => {
    // A collapse rearranges and never drops, so every part stays in the tree.
    render(
      <Card
        title="Bill Kerman"
        titleLeft={<span>PILOT</span>}
        titleRight={<span>EVA</span>}
        left={<span>avatar</span>}
        right={<span>dose</span>}
        top={<span>banner</span>}
        bottom={<span>note</span>}
        footer={<span>Recall</span>}
      >
        <span>O2 4h12m</span>
      </Card>,
    );
    for (const text of [
      "Bill Kerman",
      "PILOT",
      "EVA",
      "avatar",
      "dose",
      "banner",
      "note",
      "Recall",
      "O2 4h12m",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("steps the frame radius down inside a side aside", () => {
    render(<Card left={<span>avatar</span>}>body</Card>);
    expect(injectedCss()).toContain(
      "--radius-display-frame:var(--radius-display-frame-aside);",
    );
  });

  it("takes the rendered tag from `as`", () => {
    render(
      <ul>
        <Card as="li" data-testid="card">
          Contents
        </Card>
      </ul>,
    );
    expect(screen.getByTestId("card").tagName).toBe("LI");
  });

  it("colours a short centred top tab from identityColor", () => {
    // A short tab, not a full-width border that would read as a second meter.
    render(
      <Card identityColor="#654321" data-testid="card">
        Contents
      </Card>,
    );
    const css = injectedCss();
    expect(css).toContain("::before{");
    expect(css).toContain("width:var(--size-mark);");
    expect(css).toContain("left:50%;");
    expect(css).toContain("transform:translateX(-50%);");
    expect(css).toContain("background:#654321;");
  });

  it("accepts a colour the caller already resolved via resourceColor", () => {
    // Card takes only a plain colour and never resolves a resource name itself.
    render(
      <Card identityColor={resourceColor("LiquidFuel")} data-testid="fuel-card">
        Contents
      </Card>,
    );
    expect(injectedCss()).toContain(
      `background:${resourceColor("LiquidFuel")};`,
    );
  });

  it("shows a status accent on the left AND an identity tab on top at once", () => {
    render(
      <Card tone="alert" identityColor="#654321" data-testid="card">
        Contents
      </Card>,
    );
    const css = injectedCss();
    expect(css).toContain("border-left:2px solid var(--color-status-nogo-bg);");
    expect(css).toContain("::before{");
    expect(css).toContain("background:#654321;");
  });

  it("draws the tone accent rule on the leading edge", () => {
    render(
      <Card tone="alert" data-testid="card">
        Contents
      </Card>,
    );
    expect(injectedCss()).toContain(
      "border-left:2px solid var(--color-status-nogo-bg);",
    );
  });
});

describe("Block and Card share one set of parts", () => {
  it("reaches the SAME objects through both doors", () => {
    expect(Card.Title).toBe(Block.Title);
    expect(Card.Body).toBe(Block.Body);
    expect(Card.Aside).toBe(Block.Aside);
    expect(Card.Footer).toBe(Block.Footer);
    expect(Card.TitleRow).toBe(Block.TitleRow);
  });

  it("gives a hand-composed title the same type as a passed one", () => {
    const { container: passed } = render(<Block title="Apollo" />);
    const passedClass = screen.getByText("Apollo").className;
    expect(passed).toBeTruthy();

    render(
      <Block>
        <Block.Title>Gemini</Block.Title>
      </Block>,
    );
    expect(screen.getByText("Gemini").className).toBe(passedClass);
  });

  it("puts no surface on Block", () => {
    render(<Block data-testid="block">Contents</Block>);
    expect(screen.getByTestId("block")).not.toHaveStyle(
      "background: var(--color-surface-sunken)",
    );
  });

  it("dims to the muted text tier rather than fading its text under 4.5:1", () => {
    render(
      <Card dimmed tone="go" data-testid="card">
        Jebediah Kerman
      </Card>,
    );
    // The card's own rules, not its `::before` tab's, which does go half-strength.
    const card = screen.getByTestId("card");
    const own = injectedCss()
      .split("}")
      .filter((rule) =>
        Array.from(card.classList).some((name) => rule.startsWith(`.${name}{`)),
      )
      .join("}");
    expect(own).toContain("--color-text-primary:var(--color-text-muted)");
    expect(own).not.toContain("opacity");
  });
});
