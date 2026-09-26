import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/**
 * The standard header rides inside the body scroller, in the sticky unit that
 * is its first in-flow child, so title and aside stay in view while the body
 * scrolls. A toolbar header uses the same mechanism; only a `floatingHeader`
 * overlays outside the scroller. Asserts relationships and `position`, not
 * pixels.
 */
describe("Panel sticky header (standard)", () => {
  it("puts the heading INSIDE the scrolling body as the first in-flow child", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    const heading = screen.getByRole("heading", { name: "ALTITUDE" });
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.contains(heading)).toBe(true);
    // First in-flow child is the sticky unit, and the header is inside it, under the delay rail's band.
    const unit = scroller.querySelector(
      "[data-panel-sticky-top]",
    ) as HTMLElement;
    expect(scroller.firstElementChild).toBe(unit);
    expect(unit.contains(heading)).toBe(true);
  });

  it("sticks the header (position: sticky) so the title stays in view", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    // The stickiness lives on the unit the header shares with the rail.
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
    expect(document.querySelector("[data-panel-ghost]")).toBeNull();
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    expect(scroller.contains(header)).toBe(false);
    // Nothing scrolls, so there is no sticky unit and the rail keeps the container's band.
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
    expect(body.contains(heading)).toBe(true);
    expect(document.querySelector("[data-panel-ghost]")).toBeNull();
    // The sidebar keeps its own independent scroller.
    const almanac = screen.getByText("almanac");
    expect(body.contains(almanac)).toBe(false);
  });
});
