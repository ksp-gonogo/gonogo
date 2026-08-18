import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";
import { render, screen } from "./testing-react";

/**
 * The sticky header (Task 6): the standard header is the first in-flow child
 * INSIDE the body scroller and sticks at `top: var(--panel-rail-height)` while
 * the body scrolls under it, so title + aside stay in view without a scroll-away
 * ghost. A `panelToolbar` header uses the SAME sticky mechanism (reconciled from
 * the old pinned-sibling branch); only a `floatingHeader` is an overlay outside
 * the scroller. These assert the relationships (and `position`), not pixels.
 */
describe("Panel sticky header (standard)", () => {
  it("puts the heading INSIDE the scrolling body as the first in-flow child", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    const heading = screen.getByRole("heading", { name: "ALTITUDE" });
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.contains(heading)).toBe(true);
    // First in-flow child (the delay rail renders null with no command in flight).
    const header = scroller.querySelector("[data-panel-header]") as HTMLElement;
    expect(scroller.firstElementChild).toBe(header);
  });

  it("sticks the header (position: sticky) so the title stays in view", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    expect(getComputedStyle(header).position).toBe("sticky");
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
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    expect(getComputedStyle(header).position).toBe("sticky");
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
