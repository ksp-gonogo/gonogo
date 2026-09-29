import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";
import { PanelBadgesProvider } from "./PanelBadges";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";

const AT = value("ut", 12_000);

/** A reading held for the given grade, with a value of its own the badge is not meant to show once held. */
function heldReading(grade: Reading<unknown>["grade"]): Reading<unknown> {
  return {
    state: "held",
    value: { verdict: "No control" },
    asOfUt: AT,
    grade,
    reckoning: { status: "none" },
  };
}

/** A reading still current: `grade` is unset, the same as any observed reading. */
function liveReading(): Reading<unknown> {
  return {
    state: "observed",
    value: { verdict: "No control" },
    atUt: AT,
    reckoning: { status: "none" },
  };
}

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

describe("Panel header row", () => {
  it("keeps the header in flow, above the content", () => {
    render(<Panel panelTitle="ORBIT" sections={<p>globe</p>} />);
    const header = document.querySelector("[data-panel-header]") as HTMLElement;
    expect(getComputedStyle(header).position).not.toBe("absolute");
    expect(
      header.compareDocumentPosition(screen.getByText("globe")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stands a header row up on an untitled panel with nothing contributed", () => {
    render(<Panel sections={<p>feed</p>} />);
    expect(document.querySelector("[data-panel-header]")).not.toBeNull();
  });

  it("holds a badge-height strut beside the title, hidden from assistive tech", () => {
    render(<Panel panelTitle="ORBIT" sections={<p>globe</p>} />);
    const titles = screen.getByText("ORBIT").parentElement as HTMLElement;
    const strut = titles.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(strut).not.toBeNull();
    expect(getComputedStyle(strut).visibility).toBe("hidden");
    expect(getComputedStyle(strut).width).toBe("0px");
    expect(strut.firstElementChild).not.toBeNull();
    // Generated content, so the strut adds nothing to the panel's text.
    expect(strut.textContent).toBe("");
  });

  it("keeps the same header element when a badge arrives", () => {
    const { rerender } = render(
      <Panel panelTitle="ORBIT" sections={<p>globe</p>} />,
    );
    const before = document.querySelector("[data-panel-header]");
    rerender(
      <Panel
        panelTitle="ORBIT"
        panelBadges={[{ id: "b", label: "SIGNAL", tone: "warn" }]}
        sections={<p>globe</p>}
      />,
    );
    expect(document.querySelector("[data-panel-header]")).toBe(before);
    expect(screen.getByText("SIGNAL")).toBeInTheDocument();
  });

  it("gives the title column a zero basis, so a long title never wraps the aside", () => {
    render(<Panel panelTitle="ORBIT" sections={<p>globe</p>} />);
    const titles = screen.getByText("ORBIT").parentElement as HTMLElement;
    expect(getComputedStyle(titles).flexBasis).toMatch(/^0(px|%)?$/);
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

  it("draws the widget's own badges ahead of the contributed ones", () => {
    render(
      <PanelBadgesProvider badges={[{ id: "ctx", label: "FROM-CONTEXT" }]}>
        <Panel
          panelTitle="Fixture"
          panelBadges={[{ id: "prop", label: "FROM-PROP" }]}
        />
      </PanelBadgesProvider>,
    );
    const own = screen.getByText("FROM-PROP");
    const contributed = screen.getByText("FROM-CONTEXT");
    expect(
      own.compareDocumentPosition(contributed) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("drops a contributed badge whose id the widget's own badge already uses", () => {
    render(
      <PanelBadgesProvider badges={[{ id: "paused", label: "CONTRIBUTED" }]}>
        <Panel
          panelTitle="Fixture"
          panelBadges={[{ id: "paused", label: "OWN" }]}
        />
      </PanelBadgesProvider>,
    );
    expect(screen.getByText("OWN")).toBeTruthy();
    expect(screen.queryByText("CONTRIBUTED")).toBeNull();
  });

  it("carries a widget badge's title onto its pill", () => {
    render(
      <Panel
        panelTitle="Fixture"
        panelBadges={[{ id: "b1", label: "PAUSED", title: "Game is paused" }]}
      />,
    );
    expect(
      screen.getByText("PAUSED").closest("[title]")?.getAttribute("title"),
    ).toBe("Game is paused");
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

  it("draws a contributed badge fed a bare held grade as the grade's own word, not the verdict it was derived from", () => {
    render(
      <Panel
        panelTitle="Fixture"
        panelBadges={[
          {
            id: "lock-verdict",
            label: "No control",
            tone: "nogo",
            held: "held",
          },
        ]}
      />,
    );
    expect(screen.getByText("HELD")).toBeTruthy();
    expect(screen.queryByText("No control")).toBeNull();
  });

  it("draws a contributed badge fed a held Reading, taking its grade off it", () => {
    render(
      <Panel
        panelTitle="Fixture"
        panelBadges={[
          {
            id: "lock-verdict",
            label: "No control",
            tone: "nogo",
            held: heldReading("recorded"),
          },
        ]}
      />,
    );
    expect(screen.getByText("RECORDED")).toBeTruthy();
    expect(screen.queryByText("No control")).toBeNull();
  });

  it("leaves a contributed badge alone when the Reading it carries is not held", () => {
    render(
      <Panel
        panelTitle="Fixture"
        panelBadges={[
          {
            id: "lock-verdict",
            label: "No control",
            tone: "nogo",
            held: liveReading(),
          },
        ]}
      />,
    );
    expect(screen.getByText("No control")).toBeTruthy();
    expect(screen.queryByText("HELD")).toBeNull();
  });

  it("sets a held badge's hover text to the verdict it replaced, unless one is already given", () => {
    render(
      <Panel
        panelTitle="Fixture"
        panelBadges={[
          {
            id: "lock-verdict",
            label: "No control",
            tone: "nogo",
            held: "held",
          },
        ]}
      />,
    );
    expect(
      screen.getByText("HELD").closest("[title]")?.getAttribute("title"),
    ).toBe("No control: HELD");
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

describe("Panel panelTrend", () => {
  it("draws the trend strip outside the scrolling body, after it", () => {
    render(
      <Panel
        panelTitle="SMA"
        panelTrend={() => <span>trend</span>}
        sections={<span>680 km</span>}
      />,
    );
    const strip = document.querySelector("[data-panel-trend]");
    const body = document.querySelector("[data-panel-body]");
    expect(strip).not.toBeNull();
    expect(body?.contains(strip)).toBe(false);
    expect(
      (body as Node).compareDocumentPosition(strip as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
