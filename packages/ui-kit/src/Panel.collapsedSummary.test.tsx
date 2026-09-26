import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { PanelHeader } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import { emittedStateRuleFor } from "./test/emittedRule";

const pristineRect = Element.prototype.getBoundingClientRect;
afterEach(() => {
  Element.prototype.getBoundingClientRect = pristineRect;
});

/** Header row narrower than the title and aside together, so the aside collapses. */
function collapseTheAside(): void {
  Element.prototype.getBoundingClientRect = function measured(this: Element) {
    const isRow =
      this instanceof HTMLElement && this.hasAttribute("data-panel-header");
    return { ...pristineRect.call(this), width: isRow ? 200 : 200 } as DOMRect;
  };
}

function summary(): HTMLElement {
  return document.querySelector(
    "[data-panel-aside-expand] > summary",
  ) as HTMLElement;
}

function StatusHeader() {
  return (
    <PanelStatusStoreProvider>
      <Badge report={{ id: "a" }} severity="caution">
        A
      </Badge>
      <Badge report={{ id: "b" }} severity="caution">
        B
      </Badge>
      <Badge report={{ id: "c" }} severity="critical">
        C
      </Badge>
      <PanelHeader title="MULTI" aside={<button type="button">Ctl</button>} />
    </PanelStatusStoreProvider>
  );
}

describe("a collapsed panel header's summary", () => {
  it("says the status its dots show, since it is the only status display left", () => {
    collapseTheAside();
    render(<StatusHeader />);
    const name = summary().getAttribute("aria-label") ?? "";
    expect(name).toMatch(/1 critical/);
    expect(name).toMatch(/2 caution/);
  });

  it("draws the kit focus ring when reached by keyboard", () => {
    collapseTheAside();
    render(<StatusHeader />);
    const box = summary().parentElement as HTMLElement;
    expect(emittedStateRuleFor(box, ">summary:focus-visible")).toContain(
      "outline:2px solid var(--color-focus)",
    );
  });

  it("has no axe violations collapsed", async () => {
    collapseTheAside();
    const { container } = render(<StatusHeader />);
    await expectNoA11yViolations(container);
  });
});
