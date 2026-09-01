import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/**
 * `panelSidebar`: a second region beside or below the body, with its own
 * scroller.
 *
 * Structure and computed style rather than snapshots, following
 * `Panel.chrome.test.tsx`. What matters here is a set of relationships a
 * snapshot cannot record: that the sidebar is outside the body's scroller,
 * that its visual edge never moves the DOM, that every grid track can shrink
 * below its content, and that a panel with no sidebar gets no grid at all.
 *
 * Each computed-style assertion below is on a value that differs from the CSS
 * default, so none of them can pass on an unstyled element: `display` defaults
 * to `block` and is asserted `grid`/`flex`, `order` defaults to `0` and is
 * asserted `-1`, `overflow` defaults to `visible` and is asserted `auto`, and
 * `grid-template-*` defaults to `none`.
 */

/** The observed element's most recent size, as `useElementSize` sees it. */
type Entry = {
  target: Element;
  contentRect: { width: number; height: number };
};

/**
 * jsdom lays nothing out, so the panel's aspect ratio has to be supplied. The
 * package's global stub is a no-op that never fires; this one records what it
 * observes so a test can hand a specific size to the split box and watch the
 * axis follow.
 */
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

function resizeTo(el: Element, width: number, height: number) {
  act(() => {
    for (const ro of DrivableResizeObserver.instances) {
      if (!ro.observed.has(el)) continue;
      ro.callback([{ target: el, contentRect: { width, height } }]);
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

function split(): HTMLElement | null {
  return document.querySelector("[data-panel-split]");
}

function sidebar(): HTMLElement {
  return document.querySelector("[data-panel-sidebar]") as HTMLElement;
}

function body(): HTMLElement {
  return document.querySelector("[data-panel-body]") as HTMLElement;
}

describe("Panel sidebar, absent", () => {
  it("renders no grid, so the body is the element it has always been", () => {
    // The whole compatibility claim: forty widgets that never asked for a
    // sidebar must not be re-laid-out because one widget did.
    render(<Panel panelTitle="SYSTEM">diagram</Panel>);
    expect(split()).toBeNull();
    expect(document.querySelector("[data-panel-sidebar]")).toBeNull();
    const parent = body().parentElement as HTMLElement;
    // Panel.Glow's own flex column, not a grid wrapper interposed above it.
    expect(getComputedStyle(parent).display).toBe("flex");
  });
});

describe("Panel sidebar, DOM order", () => {
  // `undefined` is the unset case, which is the third arrangement the prop has:
  // there is no "auto" side, and asking for one only ever got the default.
  for (const side of [undefined, "start", "end"] as const) {
    it(`keeps the sidebar after the body in the DOM for side="${side ?? "unset"}"`, () => {
      // Reading and tab order must not depend on which edge the sidebar is
      // drawn against. Same principle as the floating header: a visual
      // arrangement is a paint change, never a structural one.
      render(
        <Panel panelTitle="SYSTEM" panelSidebar="almanac" sidebarSide={side}>
          diagram
        </Panel>,
      );
      expect(
        body().compareDocumentPosition(sidebar()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  }

  it('moves the sidebar visually for side="start" without moving it in the DOM', () => {
    // The other half of the pair above: if the DOM order were the ONLY thing
    // asserted, doing nothing at all would satisfy it.
    render(
      <Panel panelTitle="SYSTEM" panelSidebar="almanac" sidebarSide="start">
        diagram
      </Panel>,
    );
    expect(getComputedStyle(sidebar()).order).toBe("-1");
    // …and the sized track leads, so the body lands in the flexible one.
    expect(getComputedStyle(split() as HTMLElement).gridTemplateColumns).toBe(
      "minmax(0, 14rem) minmax(0, 1fr)",
    );
  });

  it('leaves the sidebar last for side="end", which is what "auto" resolves to', () => {
    render(
      <Panel panelTitle="SYSTEM" panelSidebar="almanac">
        diagram
      </Panel>,
    );
    expect(getComputedStyle(split() as HTMLElement).gridTemplateColumns).toBe(
      "minmax(0, 1fr) minmax(0, 14rem)",
    );
  });
});

describe("Panel sidebar, scrolling", () => {
  it("scrolls the sidebar independently of the body", () => {
    // Scrolling an almanac must not scroll the diagram it annotates away.
    render(
      <Panel panelTitle="SYSTEM" panelSidebar={<p>almanac</p>}>
        <p>diagram</p>
      </Panel>,
    );
    const almanac = screen.getByText("almanac");
    expect(body().contains(almanac)).toBe(false);

    const sidebarScroller = sidebar().querySelector(
      "[data-scroll-area-inner]",
    ) as HTMLElement;
    expect(sidebarScroller).not.toBeNull();
    expect(sidebarScroller.contains(almanac)).toBe(true);
    expect(getComputedStyle(sidebarScroller).overflow).toBe("auto");
    // Two scrollers, not one shared one.
    expect(getComputedStyle(body()).overflow).toBe("auto");
    expect(body().contains(sidebarScroller)).toBe(false);
  });
});

describe("Panel sidebar, auto axis", () => {
  it("puts the sidebar beside the body on a tile wider than it is tall", () => {
    render(
      <Panel panelTitle="SYSTEM" panelSidebar="almanac">
        diagram
      </Panel>,
    );
    const box = split() as HTMLElement;
    resizeTo(box, 600, 300);
    expect(box.dataset.panelSplit).toBe("inline");
    expect(getComputedStyle(box).gridTemplateColumns).toBe(
      "minmax(0, 1fr) minmax(0, 14rem)",
    );
    expect(getComputedStyle(box).gridTemplateRows).toBe("minmax(0, 1fr)");
  });

  it("puts the sidebar under the body on a tile taller than it is wide", () => {
    render(
      <Panel panelTitle="SYSTEM" panelSidebar="almanac">
        diagram
      </Panel>,
    );
    const box = split() as HTMLElement;
    resizeTo(box, 300, 600);
    expect(box.dataset.panelSplit).toBe("block");
    expect(getComputedStyle(box).gridTemplateColumns).toBe("minmax(0, 1fr)");
    // The block default is a share of the height, not an absolute: the strip
    // is competing with the body for the tile rather than sitting next to it.
    expect(getComputedStyle(box).gridTemplateRows).toBe(
      "minmax(0, 1fr) minmax(0, 40%)",
    );
  });

  it("keeps the measured axis but takes an explicit size on either", () => {
    render(
      <Panel panelTitle="SYSTEM" panelSidebar="almanac" sidebarSize="10rem">
        diagram
      </Panel>,
    );
    const box = split() as HTMLElement;
    resizeTo(box, 300, 600);
    expect(getComputedStyle(box).gridTemplateRows).toBe(
      "minmax(0, 1fr) minmax(0, 10rem)",
    );
  });

  it("does not flip the axis when the sidebar takes room from the body", () => {
    // The measured box is the split, whose border box is fixed by flex:1, and
    // NOT the body: measuring the body would shrink it the moment the sidebar
    // mounted, read as portrait, and oscillate.
    render(
      <Panel panelTitle="SYSTEM" panelSidebar="almanac">
        diagram
      </Panel>,
    );
    const box = split() as HTMLElement;
    resizeTo(box, 600, 300);
    resizeTo(body(), 100, 300);
    expect(box.dataset.panelSplit).toBe("inline");
  });
});

describe("Panel sidebar, track sizing", () => {
  for (const [label, w, h] of [
    ["beside", 600, 300],
    ["under", 300, 600],
  ] as const) {
    it(`floors every track at zero when the sidebar sits ${label}`, () => {
      // Without the min-0 a track floors at its content's min-content size, so
      // the sidebar's own ScrollArea sizes to the un-scrolled content, pushes
      // past the panel, and is hard-clipped by the container's overflow:hidden
      // rather than scrolling.
      render(
        <Panel panelTitle="SYSTEM" panelSidebar="almanac">
          diagram
        </Panel>,
      );
      const box = split() as HTMLElement;
      resizeTo(box, w, h);
      const style = getComputedStyle(box);
      const tracks = `${style.gridTemplateColumns} ${style.gridTemplateRows}`;
      // Three tracks on either axis pairing, and every one of them a minmax
      // whose floor is zero. The negative lookahead is the real assertion: a
      // single bare `1fr` or `14rem` slipping in fails it.
      expect(tracks.match(/minmax\(/g)).toHaveLength(3);
      expect(tracks).not.toMatch(/minmax\((?!0, )/);
    });
  }
});

describe("panelSidebar with floatingHeader", () => {
  /**
   * A drawing widget wants both: the title floating over the drawing so it
   * costs the drawing no height, and a chrome column beside it. Those did not
   * compose. The overlay header is `position: absolute; top/left/right: 0`
   * against its nearest positioned ancestor, which was the whole panel, so it
   * painted across the sidebar and hid the sidebar's first item behind the
   * title box. OrbitView had to give up the floating header (and a band of its
   * diagram) to keep the column.
   */
  it("hosts the floating header inside the body track, not over the sidebar", () => {
    render(
      <Panel
        panelTitle="ORBIT VIEW"
        panelSidebar={<span>Kerbin</span>}
        floatingHeader
      >
        <span>diagram</span>
      </Panel>,
    );
    const title = screen.getByText("ORBIT VIEW");
    const sidebarItem = screen.getByText("Kerbin");
    const body = screen.getByText("diagram");

    // The floating header's positioned ancestor must be the body track, so the
    // sidebar is outside whatever the header paints over.
    const host = title.closest("[style], div");
    expect(host).not.toBeNull();
    // The decisive relationship: the header shares an ancestor with the body
    // that does NOT contain the sidebar.
    const bodyTrack = body.parentElement?.parentElement ?? null;
    expect(bodyTrack?.contains(title)).toBe(true);
    expect(bodyTrack?.contains(sidebarItem)).toBe(false);
  });

  it("still floats over the whole panel when there is no sidebar", () => {
    // The no-sidebar case is what every drawing widget already relies on, and
    // re-hosting must not change it.
    render(
      <Panel panelTitle="MAP VIEW" floatingHeader>
        <span>map</span>
      </Panel>,
    );
    expect(screen.getByText("MAP VIEW")).toBeInTheDocument();
    expect(screen.getByText("map")).toBeInTheDocument();
  });
});
