import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/**
 * Option 5's structural fix: the standard header stops being a fixed band
 * ABOVE the scroller and becomes the first in-flow child INSIDE it, so title
 * and body scroll as one unit and a short widget reclaims the reserved chrome.
 *
 * These assert the relationship (where the heading sits relative to the
 * scroller) rather than pixels, because that relationship is the whole change.
 * The pinned toolbar and the floating header keep today's arrangement, so they
 * are asserted here too as the negative cases.
 */
describe("Panel scrolling header (standard)", () => {
  it("puts the heading INSIDE the scrolling body, not in a pinned band above it", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    const heading = screen.getByRole("heading", { name: "ALTITUDE" });
    const scroller = document.querySelector("[data-panel-body]") as HTMLElement;
    expect(scroller).not.toBeNull();
    // The header row moved inside the scroller: title + body scroll together.
    expect(scroller.contains(heading)).toBe(true);
    // …and it is the FIRST in-flow child, before the body content.
    const header = scroller.querySelector("[data-panel-header]") as HTMLElement;
    expect(scroller.firstElementChild).toBe(header);
  });

  it("renders exactly one heading, and the ghost never adds a second", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("ALTITUDE");
    // The ghost duplicate is aria-hidden and role-less, so it is not a heading.
    const ghost = document.querySelector("[data-panel-ghost]");
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute("aria-hidden", "true");
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

describe("Panel scrolling header, pinned cases keep today's tree", () => {
  it("toolbar header stays a pinned band ABOVE the scroller, with no ghost", () => {
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
    // Pinned: the heading is a sibling above the scroller, not inside it.
    expect(scroller.contains(heading)).toBe(false);
    // A pinned header wants no scroll-away ghost.
    expect(document.querySelector("[data-panel-ghost]")).toBeNull();
  });

  it("floatingHeader keeps its overlay row and renders no ghost", () => {
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

describe("Panel scrolling header, sidebar", () => {
  it("moves the header inside the body scroller and still renders a ghost", () => {
    render(
      <Panel panelTitle="SYSTEM" panelSidebar={<p>almanac</p>}>
        <p>diagram</p>
      </Panel>,
    );
    const heading = screen.getByRole("heading", { name: "SYSTEM" });
    const body = document.querySelector("[data-panel-body]") as HTMLElement;
    // Header rides the body scroller exactly as the standard case.
    expect(body.contains(heading)).toBe(true);
    expect(document.querySelector("[data-panel-ghost]")).not.toBeNull();
    // The sidebar keeps its own independent scroller, untouched.
    const almanac = screen.getByText("almanac");
    expect(body.contains(almanac)).toBe(false);
  });
});
