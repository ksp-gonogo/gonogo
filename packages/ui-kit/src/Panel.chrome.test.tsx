import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/**
 * The two header shapes that exist for widgets whose chrome does not fit one
 * title row: a pinned toolbar of controls, and a header that floats over
 * content which fills the tile.
 *
 * These assert structure and computed style rather than snapshots, because
 * what matters is the relationship between the parts (the toolbar is outside
 * the scroller; the floating header does not steal the pointer) and a snapshot
 * records neither.
 */
describe("Panel toolbar", () => {
  it("puts the toolbar in the header, outside the scrolling body", () => {
    // The whole reason it is a prop and not body content: controls that scroll
    // away from what they steer are worse than no controls.
    render(
      <Panel
        panelTitle="MAP"
        panelToolbar={<button type="button">Layers</button>}
      >
        <p>content</p>
      </Panel>,
    );
    const header = document.querySelector("[data-panel-header]");
    const toolbarButton = screen.getByRole("button", { name: "Layers" });
    expect(header).not.toBeNull();
    expect(header?.contains(toolbarButton)).toBe(true);
    expect(toolbarButton.closest("[data-panel-header]")).toBe(header);
  });

  it("opts a toolbar-only panel into the composed model", () => {
    // A widget may want the controls row without a title. That must still get
    // the padded body, not the bare passthrough container.
    render(
      <Panel panelToolbar={<button type="button">Zoom</button>}>body</Panel>,
    );
    expect(document.querySelector("[data-panel-header]")).not.toBeNull();
  });

  it("gives the toolbar its own line rather than the title's", () => {
    render(
      <Panel
        panelTitle="MAP"
        panelAside={<span>aside</span>}
        panelToolbar={<button type="button">Layers</button>}
      >
        body
      </Panel>,
    );
    const toolbar = screen.getByRole("button", { name: "Layers" })
      .parentElement as HTMLElement;
    // A full basis is what wraps it below the title/aside pair in the header's
    // wrapping row; without it the controls compete for the first line.
    expect(getComputedStyle(toolbar).flexBasis).toBe("100%");
  });
});

describe("Panel headerOverlay", () => {
  it("floats the header and lets content run beneath it", () => {
    render(
      <Panel panelTitle="ORBIT" headerOverlay>
        <p>globe</p>
      </Panel>,
    );
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    expect(getComputedStyle(header).position).toBe("absolute");
  });

  it("reserves a row by default, so the overlay is opt-in", () => {
    render(<Panel panelTitle="ORBIT">body</Panel>);
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    expect(getComputedStyle(header).position).not.toBe("absolute");
  });

  it("keeps the floating row clear of the pointer but not its title box", () => {
    // The row spans the full width invisibly. If it kept pointer events it
    // would swallow drags across the top of every map it floats over, so it
    // gives them up and the boxes that hold real content take them back.
    render(
      <Panel panelTitle="ORBIT" headerOverlay>
        <p>globe</p>
      </Panel>,
    );
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    const titles = screen.getByText("ORBIT").parentElement as HTMLElement;
    expect(getComputedStyle(header).pointerEvents).toBe("none");
    expect(getComputedStyle(titles).pointerEvents).toBe("auto");
  });

  it("backs the title box so it stays legible over the content", () => {
    render(
      <Panel panelTitle="ORBIT" headerOverlay>
        <p>globe</p>
      </Panel>,
    );
    const titles = screen.getByText("ORBIT").parentElement as HTMLElement;
    expect(getComputedStyle(titles).background).toContain(
      "var(--color-surface-panel)",
    );
  });

  it("keeps the header first in the DOM, so overlay is a paint change only", () => {
    // Reading and tab order must not depend on whether the header floats.
    render(
      <Panel panelTitle="ORBIT" headerOverlay>
        <p>globe</p>
      </Panel>,
    );
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    const body = screen.getByText("globe").parentElement as HTMLElement;
    expect(
      header.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
