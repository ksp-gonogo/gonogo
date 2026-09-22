import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Block } from "./Block";
import { Card } from "./Card";
import { resourceColor } from "./resourceColor";

/** Every styled-components rule the render injected, as one string.
 *
 *  jsdom's CSS parser drops a `border-left` shorthand entirely once it holds an
 *  unresolved `var()`, and it never evaluates a `::before`, so neither the tone
 *  accent nor the identity tab is reachable through `toHaveStyle`. */
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
    expect(injectedCss()).toContain("font-size:var(--font-size-sm);");
    // The name comes before the figures under it, in the DOM a screen reader
    // walks as well as on screen.
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
    // The collapse rule is that nothing is ever dropped, only rearranged. That
    // is a statement about what is IN THE TREE, which is exactly what jsdom can
    // answer; where each one lands at a given width is a render question.
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
    // The container answers, the content asks. A FramedDisplay handed to `left`
    // writes --radius-display-frame and gets the aside's smaller value.
    render(<Card left={<span>avatar</span>}>body</Card>);
    expect(injectedCss()).toContain(
      "--radius-display-frame:var(--space-4, 4px);",
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
    // Not a full-width border: operator feedback called the earlier full-edge
    // strip too busy, it read as a second meter stacked on the card.
    render(
      <Card identityColor="#654321" data-testid="card">
        Contents
      </Card>,
    );
    const css = injectedCss();
    expect(css).toContain("::before{");
    expect(css).toContain("width:var(--space-24, 24px);");
    expect(css).toContain("left:50%;");
    expect(css).toContain("transform:translateX(-50%);");
    expect(css).toContain("background:#654321;");
  });

  it("accepts a colour the caller already resolved via resourceColor", () => {
    // Card takes only a plain colour: it never imports resourceColor itself. A
    // caller wanting the resource-identity look resolves the name first, the
    // same way Meter's own fillColor doc asks for.
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
    // The whole point of the split. ResourceOps needs both: which resource the
    // converter makes, and whether it is running.
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
    // By construction, not by discipline: Card is assembled from BLOCK_PARTS
    // rather than declaring parts of its own, so there is no second object to
    // drift. This is the reason the Panel-parts guard has no twin here.
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
    // ContractManager opted out of the kit to escape the sunken box and drew
    // its records the same colour as the panel behind them. Block is the
    // grouping without the box.
    render(<Block data-testid="block">Contents</Block>);
    expect(screen.getByTestId("block")).not.toHaveStyle(
      "background: var(--color-surface-sunken)",
    );
  });
});
