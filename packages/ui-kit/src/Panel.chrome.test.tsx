import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";
import { PanelBadgesProvider } from "./PanelBadges";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";

/**
 * The two header shapes that exist for widgets whose chrome does not fit one
 * title row: a pinned toolbar of controls, and a header that floats over
 * content which fills the tile. Asserted as structure and computed style,
 * since the relationships between the parts are what matter.
 */
describe("Panel toolbar", () => {
  it("puts the toolbar in the header, outside the scrolling body", () => {
    // Controls must not scroll away from what they steer.
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
    // A controls row without a title still gets the padded body.
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
    // A full basis wraps it below the title and aside in the header's wrapping row.
    expect(getComputedStyle(toolbar).flexBasis).toBe("100%");
  });
});

describe("Panel floatingHeader", () => {
  it("floats the header and lets content run beneath it", () => {
    render(
      <Panel panelTitle="ORBIT" floatingHeader>
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
    // The invisible full-width row gives up pointer events so drags reach the map; the boxes take them back.
    render(
      <Panel panelTitle="ORBIT" floatingHeader>
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
      <Panel panelTitle="ORBIT" floatingHeader>
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
      <Panel panelTitle="ORBIT" floatingHeader>
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

describe("Panel panelBadges", () => {
  it("renders an explicit panelBadges list as standard Badge pills in the header", () => {
    render(
      <Panel
        panelTitle="Fixture"
        panelBadges={[{ id: "b1", label: "CRITICAL", tone: "nogo" }]}
      />,
    );
    expect(screen.getByText("CRITICAL")).toBeTruthy();
  });

  it("falls back to the ambient PanelBadgesProvider context when panelBadges is not set", () => {
    render(
      <PanelBadgesProvider
        badges={[{ id: "b2", label: "NOMINAL", tone: "go" }]}
      >
        <Panel panelTitle="Fixture" />
      </PanelBadgesProvider>,
    );
    expect(screen.getByText("NOMINAL")).toBeTruthy();
  });

  it("an explicit panelBadges prop overrides the ambient context rather than merging with it", () => {
    render(
      <PanelBadgesProvider badges={[{ id: "ctx", label: "FROM-CONTEXT" }]}>
        <Panel
          panelTitle="Fixture"
          panelBadges={[{ id: "prop", label: "FROM-PROP" }]}
        />
      </PanelBadgesProvider>,
    );
    expect(screen.getByText("FROM-PROP")).toBeTruthy();
    expect(screen.queryByText("FROM-CONTEXT")).toBeNull();
  });

  it("still renders custom panelAside content alongside badges (the escape hatch stays open)", () => {
    render(
      <Panel
        panelTitle="Fixture"
        panelBadges={[{ id: "b1", label: "CRITICAL" }]}
        panelAside={<button type="button">Custom control</button>}
      />,
    );
    expect(screen.getByText("CRITICAL")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Custom control" })).toBeTruthy();
  });

  it("a lone severity-bearing badge is not ALSO drawn as the merged summary badge", () => {
    /* A badge that wins its own summary renders exactly once. */
    render(
      <PanelStatusStoreProvider>
        <Panel
          panelTitle="Fixture"
          panelBadges={[{ id: "no-signal", label: "NO SIGNAL", tone: "warn" }]}
        />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getAllByText("NO SIGNAL")).toHaveLength(1);
  });

  it("a worse OTHER contributor still shows its own summary beside an unrelated badge", () => {
    /* The stream contribution is worse and wins, so the badge and the stream summary are two signals and both show. */
    render(
      <PanelStatusStoreProvider>
        <Panel
          panelTitle="Fixture"
          panelBadges={[{ id: "aboard", label: "3/4 ABOARD", tone: "info" }]}
          panelStatus="disconnected"
        />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getByText("3/4 ABOARD")).toBeTruthy();
    expect(screen.getByText("OFFLINE")).toBeTruthy();
  });
});

/**
 * The toolbar's full flex-basis only starts a new line in a wrapping row, and
 * the two rules live in different styled components. jsdom does no layout, so
 * this asserts both declarations.
 */
describe("Panel toolbar occupies its own header line", () => {
  it("wraps the header row, so a full-basis toolbar starts a new line instead of competing with the title", () => {
    render(
      <Panel
        panelTitle="MAP VIEW"
        panelToolbar={<button type="button">Follow</button>}
      >
        <p>content</p>
      </Panel>,
    );
    const header = document.querySelector("[data-panel-header]");
    expect(header).not.toBeNull();
    expect(getComputedStyle(header as Element).flexWrap).toBe("wrap");
  });

  it("gives the toolbar a full basis, so it takes the new line rather than sharing the title's", () => {
    render(
      <Panel
        panelTitle="MAP VIEW"
        panelToolbar={<button type="button">Follow</button>}
      >
        <p>content</p>
      </Panel>,
    );
    const toolbar = screen
      .getByRole("button", { name: "Follow" })
      .closest("div");
    expect(toolbar).not.toBeNull();
    expect(getComputedStyle(toolbar as Element).flexBasis).toBe("100%");
  });
});
