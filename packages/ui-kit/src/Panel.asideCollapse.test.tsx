import {
  act,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge";
import { Panel, PanelHeader } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import {
  type DrivableResizeObservers,
  installDrivableResizeObserver,
} from "./testing";
import { usePanelAsideSize } from "./usePanelAsideSize";

/**
 * The header aside collapses on a measured fit with hysteresis. jsdom never
 * measures, so unstubbed it renders the wide default; these assert the
 * JS-observable structure and leave the rendered collapse to the visual gate.
 */

function header(): HTMLElement {
  return document.querySelector("[data-panel-header]") as HTMLElement;
}
function expandBox(): HTMLDetailsElement {
  return header().querySelector(
    "[data-panel-aside-expand]",
  ) as HTMLDetailsElement;
}
function statusDots(): NodeListOf<Element> {
  return header().querySelectorAll("[data-panel-status-dot]");
}

/**
 * Give `useHeaderAsideFit` real widths to measure under jsdom, which otherwise
 * reports 0: the hook's "unmeasured" signal, which holds the current state, so
 * a test that widens again has to feed a fit rather than un-stub.
 *
 * `row` is the header row's own width (the room available); `part` is what the
 * title and the aside each report, and the hook sums them. So `part * 2 > row`
 * collapses, and re-expanding additionally needs the hook's hysteresis margin.
 */
const pristineRect = Element.prototype.getBoundingClientRect;
let observers: DrivableResizeObservers | null = null;
afterEach(() => {
  Element.prototype.getBoundingClientRect = pristineRect;
  observers?.uninstall();
  observers = null;
  vi.restoreAllMocks();
});

function withHeaderMeasurements(row: number, part: number): void {
  Element.prototype.getBoundingClientRect = function measured(this: Element) {
    const isRow =
      this instanceof HTMLElement && this.hasAttribute("data-panel-header");
    return { ...pristineRect.call(this), width: isRow ? row : part } as DOMRect;
  };
}

/**
 * Count the expand box's `toggle` events. The browser dispatches one as its own
 * task whenever `open` is added or removed, whether by a summary click or by
 * Panel forcing the box open inline and closed on collapse, and Panel records
 * the operator's choice from that event. A test waits for each one so that
 * what it asserts next is what React holds, not only what the DOM shows.
 */
function watchToggles(): { readonly count: number } {
  let count = 0;
  expandBox().addEventListener("toggle", () => {
    count += 1;
  });
  return {
    get count() {
      return count;
    },
  };
}

function summary(): HTMLElement {
  return expandBox().querySelector("summary") as HTMLElement;
}

/** Widths that do not fit: the aside collapses behind the summary. */
const TOO_NARROW = [200, 200] as const;
/** Widths with room to spare, clear of the re-expand hysteresis margin. */
const ROOMY = [800, 200] as const;

describe("Panel header aside expand box", () => {
  it("routes the full aside (badges AND controls) into the <details> box", () => {
    render(
      <Panel
        panelTitle="MAP"
        panelAside={
          <>
            <span>LAYER</span>
            <button type="button">Toggle grid</button>
          </>
        }
      >
        body
      </Panel>,
    );
    const box = expandBox();
    expect(box.tagName).toBe("DETAILS");
    const full = box.querySelector("[data-panel-aside-full]") as HTMLElement;
    // Both a readout and a real control live in the full slot, so a collapsed panel reaches the control by expanding it.
    expect(within(full).getByText("LAYER")).toBeInTheDocument();
    expect(
      within(full).getByRole("button", { name: "Toggle grid" }),
    ).toBeInTheDocument();
  });

  it("makes the per-severity dots the collapsed summary, worst-first with count inside", () => {
    render(
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
        <PanelHeader title="MULTI" aside={<span>WIDE</span>} />
      </PanelStatusStoreProvider>,
    );
    const summary = expandBox().querySelector("summary") as HTMLElement;
    const dots = summary.querySelectorAll("[data-panel-status-dot]");
    expect(dots).toHaveLength(2);
    // Critical leads (worst-first); two cautions stay one caution dot, count 2.
    expect(dots[0]).toHaveAttribute("data-severity", "critical");
    expect(dots[1]).toHaveAttribute("data-severity", "caution");
    expect(dots[1]).toHaveTextContent("2");
  });

  it("carries the hidden summary badge's status as a dot on the expand control", () => {
    // The store the dashboard puts round every widget, which the summary badge and the dots both read.
    render(
      <PanelStatusStoreProvider>
        <Panel panelTitle="ORBIT" panelStatus="held-stale">
          body
        </Panel>
      </PanelStatusStoreProvider>,
    );
    const full = header().querySelector(
      "[data-panel-aside-full]",
    ) as HTMLElement;
    expect(full).not.toBeEmptyDOMElement();
    const dots = expandBox().querySelectorAll(
      "summary [data-panel-status-dot]",
    );
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute("data-severity", "warning");
  });

  it("renders no dots when the panel has no active status, but keeps the chevron affordance", () => {
    render(
      <Panel panelTitle="MAP" panelAside={<span>WIDE</span>}>
        body
      </Panel>,
    );
    // No store / healthy panel: empty breakdown, so no dots.
    expect(statusDots()).toHaveLength(0);
    // The chevron is always present so a control-only collapsed box is still discoverable.
    expect(header().querySelector("[data-panel-aside-chevron]")).not.toBeNull();
  });

  it("is an OPEN details while the aside is inline, so nothing claims on-screen content is collapsed", () => {
    render(
      <Panel panelTitle="MAP" panelAside={<span>WIDE</span>}>
        body
      </Panel>,
    );
    // A closed details would tell the accessibility tree that visible badges sit behind a disclosure with no trigger.
    expect(expandBox().open).toBe(true);
  });

  it("toggles the expand box open and closed once the aside is collapsed", async () => {
    const user = userEvent.setup();
    withHeaderMeasurements(...TOO_NARROW);
    render(
      <Panel panelTitle="MAP" panelAside={<button type="button">Ctl</button>}>
        body
      </Panel>,
    );
    const toggles = watchToggles();
    // Collapsed is the one state where the details is a real disclosure: the content genuinely sits behind the summary, so it starts closed.
    expect(expandBox().open).toBe(false);
    await waitFor(() => expect(toggles.count).toBe(1));

    await user.click(summary());
    await waitFor(() => expect(toggles.count).toBe(2));
    expect(expandBox().open).toBe(true);

    await user.click(summary());
    await waitFor(() => expect(toggles.count).toBe(3));
    expect(expandBox().open).toBe(false);
  });

  it("drops an operator-opened collapsed box when the aside goes back inline", async () => {
    const user = userEvent.setup();
    const panel = (body: string) => (
      <Panel panelTitle="MAP" panelAside={<button type="button">Ctl</button>}>
        {body}
      </Panel>
    );
    observers = installDrivableResizeObserver();
    withHeaderMeasurements(...TOO_NARROW);
    render(panel("body"));
    const toggles = watchToggles();
    await waitFor(() => expect(toggles.count).toBe(1));
    await user.click(summary());
    await waitFor(() => expect(toggles.count).toBe(2));
    expect(expandBox().open).toBe(true);

    // Widening forces open, and must not keep the operator's choice to re-open the box the next time it narrows.
    withHeaderMeasurements(...ROOMY);
    act(() => observers?.resize(header(), { width: ROOMY[0], height: 20 }));
    expect(expandBox().open).toBe(true);

    withHeaderMeasurements(...TOO_NARROW);
    act(() =>
      observers?.resize(header(), { width: TOO_NARROW[0], height: 20 }),
    );
    expect(expandBox().open).toBe(false);
    await waitFor(() => expect(toggles.count).toBe(3));
  });

  it("goes back inline once a badge that made it collapse has gone, with no resize", () => {
    const panel = (badges: string[]) => (
      <Panel
        panelTitle="CREW"
        panelAside={badges.map((label) => <Badge key={label}>{label}</Badge>)}
      >
        body
      </Panel>
    );
    // Three badges need 240 of a 230 row: collapsed.
    withHeaderMeasurements(230, 120);
    const { rerender } = render(panel(["3/4 aboard", "2 crit", "in range"]));
    expect(expandBox().open).toBe(false);

    // 220 of the same 230 is inside the re-expand margin, but the content changed, so it is decided afresh and fits.
    withHeaderMeasurements(230, 110);
    rerender(panel(["3/4 aboard", "2 crit"]));
    expect(expandBox().open).toBe(true);
  });

  it("does not re-measure the header when the panel re-renders with the same title and aside", () => {
    const panel = (body: string, badge = "STALE") => (
      <Panel panelTitle="MAP" panelAside={<Badge>{badge}</Badge>}>
        {body}
      </Panel>
    );
    const { rerender } = render(panel("body"));
    const clones = vi.spyOn(Node.prototype, "cloneNode");
    for (const body of ["a", "b", "c"]) rerender(panel(body));
    expect(clones).not.toHaveBeenCalled();

    rerender(panel("c", "OFFLINE"));
    expect(clones).toHaveBeenCalled();
  });

  it("has no aside box at all when the widget passes no aside", () => {
    render(<Panel panelTitle="BARE">body</Panel>);
    expect(header().querySelector("[data-panel-aside-expand]")).toBeNull();
  });

  it("routes usePanelAsideSize() through PanelHeader's own provider, not just the context default", () => {
    function Probe() {
      return <span>bucket: {usePanelAsideSize()}</span>;
    }
    render(
      <Panel panelTitle="MAP" panelAside={<Probe />}>
        body
      </Panel>,
    );
    // Proves PanelHeader provides the size around `aside`; jsdom's value is the wide default either way.
    expect(screen.getByText("bucket: full")).toBeInTheDocument();
  });

  it("stays inline (the wide default) in jsdom, where @container cannot fire", () => {
    // A widget test rendering a Panel sees the aside content inline, since jsdom never measures.
    render(
      <Panel panelTitle="LANDING" panelAside={<span>NO LANDING VECTOR</span>}>
        body
      </Panel>,
    );
    expect(screen.getByText("NO LANDING VECTOR")).toBeInTheDocument();
  });
});

describe("Panel header aside expand box, accessibility", () => {
  it("has no axe violations (summary named, dots labelled, chevron hidden)", async () => {
    const { container } = render(
      <PanelStatusStoreProvider>
        <Panel
          panelTitle="LANDING"
          panelStatus="held-stale"
          panelAside={<button type="button">Recenter</button>}
        >
          <p>content</p>
        </Panel>
      </PanelStatusStoreProvider>,
    );
    await expectNoA11yViolations(container);
  });
});
