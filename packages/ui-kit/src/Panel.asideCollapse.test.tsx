import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Panel, PanelHeader } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import { axe } from "./test/axe";

/**
 * Below a measured width, the header's `aside` slot collapses to the panel's
 * compact status summary instead of overflowing the row. Generic `PanelHeader`
 * behaviour (not LandingStatus-specific): the motivating case is a fixed-width
 * `Readout` in the aside that doesn't wrap, but this drives it with plain
 * content so the test doesn't depend on any particular widget's markup.
 *
 * jsdom lays nothing out, so the header row's width has to be supplied, the
 * same problem `Panel.sidebar.test.tsx`'s `PanelSplit` measurement solves: a
 * drivable `ResizeObserver` stands in for the package's global no-op stub.
 */

type Entry = {
  target: Element;
  contentRect: { width: number; height: number };
};

class DrivableResizeObserver {
  static instances: DrivableResizeObserver[] = [];
  readonly observed = new Set<Element>();
  readonly callback: (entries: Entry[]) => void;
  constructor(callback: (entries: Entry[]) => void) {
    this.callback = callback;
    DrivableResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
}

function resizeHeaderTo(el: Element, width: number) {
  act(() => {
    for (const ro of DrivableResizeObserver.instances) {
      if (!ro.observed.has(el)) continue;
      ro.callback([{ target: el, contentRect: { width, height: 40 } }]);
    }
  });
}

const realResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  DrivableResizeObserver.instances = [];
  globalThis.ResizeObserver =
    DrivableResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = realResizeObserver;
});

function header(): HTMLElement {
  return document.querySelector("[data-panel-header]") as HTMLElement;
}

describe("Panel header aside-collapse, wide", () => {
  it("renders the full aside when there is room for it", () => {
    render(
      <Panel panelTitle="LANDING" panelAside={<span>NO LANDING VECTOR</span>}>
        body
      </Panel>,
    );
    resizeHeaderTo(header(), 500);
    expect(screen.getByText("NO LANDING VECTOR")).toBeInTheDocument();
  });

  it("stays uncollapsed before any measurement lands (first paint, and jsdom forever unless driven)", () => {
    // No resizeHeaderTo call at all: this is every existing widget test today.
    render(
      <Panel panelTitle="LANDING" panelAside={<span>NO LANDING VECTOR</span>}>
        body
      </Panel>,
    );
    expect(screen.getByText("NO LANDING VECTOR")).toBeInTheDocument();
  });
});

describe("Panel header aside-collapse, narrow, with a status summary", () => {
  it("swaps the arbitrary aside for the compact status badge", () => {
    render(
      <PanelStatusStoreProvider>
        <Panel.Status status="held-stale">
          <Panel
            panelTitle="LANDING"
            panelAside={<span>NO LANDING VECTOR</span>}
          >
            body
          </Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    resizeHeaderTo(header(), 150);
    expect(screen.queryByText("NO LANDING VECTOR")).toBeNull();
    expect(within(header()).getByText("STALE")).toBeInTheDocument();
  });

  it("restores the full aside once the row is wide again (no oscillation lock-in)", () => {
    render(
      <PanelStatusStoreProvider>
        <Panel.Status status="held-stale">
          <Panel
            panelTitle="LANDING"
            panelAside={<span>NO LANDING VECTOR</span>}
          >
            body
          </Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    resizeHeaderTo(header(), 150);
    expect(screen.queryByText("NO LANDING VECTOR")).toBeNull();

    resizeHeaderTo(header(), 500);
    // The full aside is back, its own stream badge riding beside it exactly
    // as `Panel.status.test.tsx` pins ("beside it, not instead of it"); this
    // feature only replaces that pairing when collapsed, not the pairing
    // itself.
    expect(screen.getByText("NO LANDING VECTOR")).toBeInTheDocument();
    expect(screen.getByText("STALE")).toBeInTheDocument();
  });

  it("marks the header with the resolved decision for inspection", () => {
    render(
      <PanelStatusStoreProvider>
        <Panel.Status status="held-stale">
          <Panel
            panelTitle="LANDING"
            panelAside={<span>NO LANDING VECTOR</span>}
          >
            body
          </Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    resizeHeaderTo(header(), 500);
    expect(header()).not.toHaveAttribute("data-panel-aside-collapsed");
    resizeHeaderTo(header(), 150);
    expect(header()).toHaveAttribute("data-panel-aside-collapsed");
  });
});

describe("Panel header aside-collapse, narrow, no status summary", () => {
  it("renders nothing for the slot rather than the overflowing raw aside (healthy panel)", () => {
    render(
      <PanelStatusStoreProvider>
        <Panel.Status status="live">
          <Panel
            panelTitle="LANDING"
            panelAside={<span>NO LANDING VECTOR</span>}
          >
            body
          </Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    resizeHeaderTo(header(), 150);
    expect(screen.queryByText("NO LANDING VECTOR")).toBeNull();
    // No compact badge either: a healthy panel's summary is null.
    expect(within(header()).queryByRole("status")).toBeNull();
  });

  it("renders nothing for the slot when there is no status store in the tree at all", () => {
    render(
      <Panel panelTitle="LANDING" panelAside={<span>NO LANDING VECTOR</span>}>
        body
      </Panel>,
    );
    resizeHeaderTo(header(), 150);
    expect(screen.queryByText("NO LANDING VECTOR")).toBeNull();
    expect(within(header()).queryByRole("status")).toBeNull();
  });
});

describe("Panel header aside-collapse, no aside at all", () => {
  it("is unaffected by width when there is nothing to collapse", () => {
    render(<Panel panelTitle="LANDING">body</Panel>);
    resizeHeaderTo(header(), 150);
    expect(header().querySelector("[data-panel-aside-collapsed]")).toBeNull();
    expect(screen.getByText("LANDING")).toBeInTheDocument();
  });
});

describe("Panel header aside-collapse, hand-composed Panel.Header", () => {
  it("collapses the same way outside the Panel compound, since this is generic PanelHeader behaviour", () => {
    // PanelHeader alone (no PanelRoot) does not fold a host stream status into
    // the store itself; a hand-composed panel that wants a summary seeds it
    // the same way any widget does, a reporting Badge elsewhere in the tree.
    render(
      <PanelStatusStoreProvider>
        <Badge report={{ id: "stream" }} severity="offline">
          OFFLINE
        </Badge>
        <PanelHeader title="MANUAL" aside={<span>WIDE CONTROL</span>} />
      </PanelStatusStoreProvider>,
    );
    resizeHeaderTo(header(), 150);
    expect(screen.queryByText("WIDE CONTROL")).toBeNull();
    expect(within(header()).getByText("OFFLINE")).toBeInTheDocument();
  });
});

describe("Panel header aside-collapse, accessibility", () => {
  it("has no axe violations while collapsed", async () => {
    const { container } = render(
      <PanelStatusStoreProvider>
        <Panel.Status status="held-stale">
          <Panel
            panelTitle="LANDING"
            panelAside={<span>NO LANDING VECTOR</span>}
          >
            <p>content</p>
          </Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    resizeHeaderTo(header(), 150);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
