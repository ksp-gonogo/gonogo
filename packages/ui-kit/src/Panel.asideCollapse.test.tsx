import { fireEvent, render, screen, within } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Panel, PanelHeader } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import { axe } from "./test/axe";
import { usePanelAsideSize } from "./usePanelAsideSize";

/**
 * Task 9 (operator-review rework, see usePanelAsideSize.ts): the header aside
 * collapses via `useHeaderAsideFit`'s measured-fit + hysteresis, not a fixed
 * `@container` width threshold. jsdom never completes a real ResizeObserver
 * cycle and gives `<canvas>` no 2D backend, so it always renders the WIDE
 * default (the full aside inline inside the box), exactly as the old
 * `@container`-based version did (jsdom could not evaluate that either).
 * These assert the JS-observable structure; the measured collapse itself is
 * left to the visual gate.
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
 * reports 0 for everything: a 0 is the hook's "unmeasured" signal and HOLDS the
 * current state, which is why every other test here sees the wide default and
 * why a test that wants to widen again has to feed a fit rather than simply
 * un-stub.
 *
 * `row` is the header row's own width (the room available); `part` is what the
 * title and the aside each report, and the hook sums them. So `part * 2 > row`
 * collapses, and re-expanding additionally needs the hook's hysteresis margin.
 */
const pristineRect = Element.prototype.getBoundingClientRect;
afterEach(() => {
  Element.prototype.getBoundingClientRect = pristineRect;
});

function withHeaderMeasurements(row: number, part: number): void {
  Element.prototype.getBoundingClientRect = function measured(this: Element) {
    const isRow =
      this instanceof HTMLElement && this.hasAttribute("data-panel-header");
    return { ...pristineRect.call(this), width: isRow ? row : part } as DOMRect;
  };
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
    // Both a badge-like readout and a real control live in the box's full slot,
    // so a collapsed panel reaches the control by expanding it (Task 9's point).
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

  it("renders no dots when the panel has no active status, but keeps the chevron affordance", () => {
    render(
      <Panel panelTitle="MAP" panelAside={<span>WIDE</span>}>
        body
      </Panel>,
    );
    // No store / healthy panel: empty breakdown, so no dots.
    expect(statusDots()).toHaveLength(0);
    // The chevron is always present so a control-only collapsed box is still
    // discoverable (the deferred affordance decision: chevron, not a bare dot).
    expect(header().querySelector("[data-panel-aside-chevron]")).not.toBeNull();
  });

  it("is an OPEN details while the aside is inline, so nothing claims on-screen content is collapsed", () => {
    render(
      <Panel panelTitle="MAP" panelAside={<span>WIDE</span>}>
        body
      </Panel>,
    );
    // The inline state has no summary to click (it is display: none) and the
    // full aside renders regardless of [open], so a CLOSED details would tell
    // the accessibility tree that visible badges are behind a disclosure with
    // no trigger. Playwright's webkit visibility check reads exactly that
    // structural claim rather than the CSS, which is how a green chromium run
    // and a red webkit run described the same rendered pixels.
    expect(expandBox().open).toBe(true);
  });

  it("toggles the expand box open and closed once the aside is collapsed", () => {
    withHeaderMeasurements(...TOO_NARROW);
    render(
      <Panel panelTitle="MAP" panelAside={<button type="button">Ctl</button>}>
        body
      </Panel>,
    );
    const box = expandBox();
    const summary = box.querySelector("summary") as HTMLElement;
    // Collapsed is the one state where the details is a real disclosure: the
    // content genuinely sits behind the summary, so it starts closed.
    expect(box.open).toBe(false);
    fireEvent.click(summary);
    expect(box.open).toBe(true);
    fireEvent.click(summary);
    expect(box.open).toBe(false);
  });

  it("drops an operator-opened collapsed box when the aside goes back inline", () => {
    const panel = (body: string) => (
      <Panel panelTitle="MAP" panelAside={<button type="button">Ctl</button>}>
        {body}
      </Panel>
    );
    withHeaderMeasurements(...TOO_NARROW);
    const { rerender } = render(panel("body"));
    fireEvent.click(expandBox().querySelector("summary") as HTMLElement);
    expect(expandBox().open).toBe(true);

    // Widening to a fit forces open (the inline state), and must not keep the
    // operator's choice around to re-open the box the next time it narrows.
    withHeaderMeasurements(...ROOMY);
    rerender(panel("body wider"));
    expect(expandBox().open).toBe(true);

    withHeaderMeasurements(...TOO_NARROW);
    rerender(panel("body narrow again"));
    expect(expandBox().open).toBe(false);
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
    // jsdom never completes a measurement, so this is the wide default same as
    // an un-provided call would report; the point of the test is that it comes
    // from PanelHeader's PanelAsideSizeProvider around `aside`, so a widget
    // reading it from inside its own panelAside content is wired up at all.
    expect(screen.getByText("bucket: full")).toBeInTheDocument();
  });

  it("stays inline (the wide default) in jsdom, where @container cannot fire", () => {
    // Every existing widget test that renders a Panel sees the aside content
    // inline, unchanged: jsdom never evaluates the collapse query.
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
        <Panel.Status status="held-stale">
          <Panel
            panelTitle="LANDING"
            panelAside={<button type="button">Recenter</button>}
          >
            <p>content</p>
          </Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
