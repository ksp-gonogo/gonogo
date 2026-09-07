import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/**
 * The sticky header (Task 6): the standard header rides INSIDE the body
 * scroller, in the sticky unit that is the scroller's first in-flow child, and
 * sticks at the scroller's top while the body scrolls under it, so title +
 * aside stay in view without a scroll-away ghost. The delay rail is the unit's
 * other half (see `Panel.delay.test.tsx`), which is what makes the two travel
 * together rather than merely both being pinned. A `panelToolbar` header uses
 * the SAME sticky mechanism (reconciled from the old pinned-sibling branch);
 * only a `floatingHeader` is an overlay outside the scroller. These assert the
 * relationships (and `position`), not pixels.
 */
describe("Panel sticky header (standard)", () => {
  it("puts the heading INSIDE the scrolling body as the first in-flow child", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    const heading = screen.getByRole("heading", { name: "ALTITUDE" });
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.contains(heading)).toBe(true);
    // First in-flow child is the sticky unit, and the header is inside it,
    // under the delay rail's band.
    const unit = scroller.querySelector(
      "[data-panel-sticky-top]",
    ) as HTMLElement;
    expect(scroller.firstElementChild).toBe(unit);
    expect(unit.contains(heading)).toBe(true);
  });

  it("sticks the header (position: sticky) so the title stays in view", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    // The stickiness lives on the unit the header shares with the rail, so
    // whatever holds the title in view holds the rail there too.
    const unit = document.querySelector(
      "[data-panel-sticky-top]",
    ) as HTMLElement;
    expect(getComputedStyle(unit).position).toBe("sticky");
  });

  it("renders exactly one heading and no scroll-away ghost", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("ALTITUDE");
    // The condensing ghost is deleted: the real heading is always in view.
    expect(document.querySelector("[data-panel-ghost]")).toBeNull();
  });

  it("keeps the header first in the DOM, before the body content", () => {
    render(
      <Panel panelTitle="ALTITUDE">
        <p>content</p>
      </Panel>,
    );
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    const content = screen.getByText("content");
    expect(
      header.compareDocumentPosition(content) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Panel sticky header, one mechanism for the toolbar case", () => {
  it("toolbar header rides the scroller as a sticky child (not a pinned sibling), no ghost", () => {
    render(
      <Panel
        panelTitle="MAP"
        panelToolbar={<button type="button">Layers</button>}
      >
        body
      </Panel>,
    );
    const heading = screen.getByRole("heading", { name: "MAP" });
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    // Reconciled into the sticky model: the heading now rides inside the scroller.
    expect(scroller.contains(heading)).toBe(true);
    const unit = document.querySelector(
      "[data-panel-sticky-top]",
    ) as HTMLElement;
    expect(unit.contains(heading)).toBe(true);
    expect(getComputedStyle(unit).position).toBe("sticky");
    expect(document.querySelector("[data-panel-ghost]")).toBeNull();
    // The toolbar's controls ride along in the sticky header.
    expect(
      scroller.contains(screen.getByRole("button", { name: "Layers" })),
    ).toBe(true);
  });

  it("floatingHeader keeps its overlay row outside the scroller, no ghost", () => {
    render(
      <Panel panelTitle="ORBIT" floatingHeader>
        <p>globe</p>
      </Panel>,
    );
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    expect(getComputedStyle(header).position).toBe("absolute");
    // The overlay title floats over a non-scrolling bleed body; no ghost.
    expect(document.querySelector("[data-panel-ghost]")).toBeNull();
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    expect(scroller.contains(header)).toBe(false);
    /* No sticky unit here, because nothing scrolls: the bleed body is fixed to
       the tile, so the rail keeps the container's band beside this overlay
       rather than joining a unit with nothing to stick to. */
    expect(document.querySelector("[data-panel-sticky-top]")).toBeNull();
  });
});

describe("Panel sticky header, sidebar", () => {
  it("moves the header inside the body scroller, no ghost", () => {
    render(
      <Panel panelTitle="SYSTEM" panelSidebar={<p>almanac</p>}>
        <p>diagram</p>
      </Panel>,
    );
    const heading = screen.getByRole("heading", { name: "SYSTEM" });
    const body = document.querySelector("[data-panel-body]") as HTMLElement;
    // Header rides the body scroller exactly as the standard case.
    expect(body.contains(heading)).toBe(true);
    expect(document.querySelector("[data-panel-ghost]")).toBeNull();
    // The sidebar keeps its own independent scroller, untouched.
    const almanac = screen.getByText("almanac");
    expect(body.contains(almanac)).toBe(false);
  });
});
