import {
  ContributionsProvider,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { DescentEnvelope } from "./DescentEnvelope";
// Side-effect import, and the whole subject of this file: the widget's own
// marks are a CONTRIBUTION now, so nothing reaches the plot unless the
// registration and the aggregation both work.
import "./descentLayers";

/**
 * The descent envelope end to end: the widget's own layers, registered at
 * module load exactly as an Uplink's would be, aggregated by the framework and
 * drawn by the shared chart.
 *
 * This is the file that would fail if the self-contribution were ceremony. The
 * component itself draws nothing at all, so a plot with a curve on it is proof
 * that the layer seam carries the host's own geometry, and a plot without one
 * is proof that it does not.
 *
 * `WidgetMetaContext` + `ContributionsProvider` mirror the app's real
 * `WidgetContributions` wrapper (`GridItemContent.tsx`). Without them
 * `useContributions` silently returns empty, the same as a bare widget with no
 * dashboard around it.
 */

const CARRIED = [
  "vessel.identity",
  "system.bodies",
  "vessel.flight",
  "vessel.surface",
  "vessel.landing",
];

const META = { componentId: "landing-status" };

/** A Kerbin entry at 28 km, well above terminal. */
const ENTRY = {
  currentSpeed: 2200,
  currentAltitude: 28_000,
  terminalVelocity: 300,
  projectedTouchdownSpeed: 95,
};

/**
 * A `ResizeObserver` that reports a real size. `GraphView` renders no chart at
 * all until one has, which in jsdom means the default no-op stub renders a
 * permanently empty plot and every assertion below passes vacuously.
 */
function installSizedResizeObserver(w: number, h: number): () => void {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: { width: w, height: h } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = previous;
  };
}

let restoreResizeObserver: () => void;

beforeEach(() => {
  restoreResizeObserver = installSizedResizeObserver(320, 320);
  // The contribution reads the parent body's gravity and its sky out of the
  // body registry, exactly as the widget used to. Without it there is no trace
  // at all, which is the absence rule working and a vacuous test.
  registerStockBodies();
});

afterEach(() => {
  restoreResizeObserver();
});

function mount(props: Partial<typeof ENTRY> = {}) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <DescentEnvelope {...ENTRY} {...props} />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, view };
}

function feed(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.emit("system.bodies", {
      bodies: [{ name: "Kerbin", index: 1, parentIndex: 0, radius: 600_000 }],
    });
    fixture.emit("vessel.identity", {
      vesselId: "entry",
      name: "Orbiter",
      vesselType: 0,
      situation: 6,
      parentBodyIndex: 1,
    });
    fixture.emit("vessel.flight", {
      surfaceSpeed: 2200,
      altitudeTerrain: 28_000,
      mach: 7,
    });
    fixture.emit("vessel.landing", {
      terminalVelocity: 300,
      projectedTouchdownSpeed: 95,
      dragToWeightRatio: 2.1,
    });
  });
}

const layers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-plot-layer]")).map((el) =>
    el.getAttribute("data-plot-layer"),
  );

describe("DescentEnvelope", () => {
  it("renders nothing at all when the terminal anchors are missing", () => {
    const { view } = mount({ terminalVelocity: null });
    expect(view.container.querySelector("svg")).toBeNull();
  });

  it("carries the widget's own marks through the contribution seam", async () => {
    const { fixture, view } = mount();
    feed(fixture);
    await waitFor(() => {
      expect(layers(view.container)).toContain("terminal-curve");
    });
    // Every mark, not only the curve: this is the whole claim of the rewrite.
    for (const id of [
      "atmosphere-bands",
      "decelerating",
      "terminal-curve",
      "trace-estimate",
      "vessel",
      "drag",
    ]) {
      expect(layers(view.container)).toContain(id);
    }
  });

  it("draws through the app's own chart, with its axes and its ticks", async () => {
    const { fixture, view } = mount();
    feed(fixture);
    await waitFor(() => {
      expect(layers(view.container)).toContain("terminal-curve");
    });
    // Speed on X: a tick label carrying the axis's own unit, which the
    // hand-rolled plot never had because it drew no axes at all.
    const ticks = Array.from(view.container.querySelectorAll("text")).map(
      (t) => t.textContent ?? "",
    );
    expect(ticks.some((t) => t.endsWith("m/s"))).toBe(true);
  });

  it("speaks every layer's reading, so shape is never the only channel", async () => {
    const { fixture, view } = mount();
    feed(fixture);
    await waitFor(() => {
      expect(layers(view.container)).toContain("vessel");
    });
    const label =
      view.container
        .querySelector("svg[role='img']")
        ?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Descent envelope");
    expect(label).toContain("terminal velocity");
    expect(label).toContain("decelerating");
    expect(label).toContain("drag 2.1× weight");
  });
});
