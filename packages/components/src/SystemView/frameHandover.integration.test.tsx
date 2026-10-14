import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;
const ANALYTIC = { kind: 1, trajectoryKind: 1 };

const SYSTEM = {
  bodies: [
    {
      index: 0,
      name: "Kerbol",
      parentIndex: null,
      radius: 261_600_000,
      gravParameter: 1.1723328e18,
      orbit: null,
    },
    {
      index: KERBIN_INDEX,
      name: "Kerbin",
      parentIndex: 0,
      radius: 600_000,
      gravParameter: KERBIN_MU,
      sphereOfInfluence: 84_159_286,
      isHome: true,
      orbit: {
        sma: 13_599_840_256,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 1,
        epoch: 0,
      },
    },
    {
      index: MUN_INDEX,
      name: "Mun",
      parentIndex: KERBIN_INDEX,
      radius: 200_000,
      gravParameter: MUN_MU,
      sphereOfInfluence: 2_429_559,
      orbit: {
        sma: 12_000_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 1.7,
        epoch: 0,
      },
    },
    {
      index: 3,
      name: "Minmus",
      parentIndex: KERBIN_INDEX,
      radius: 60_000,
      gravParameter: 1.7658e9,
      sphereOfInfluence: 2_247_428,
      orbit: {
        sma: 47_000_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0.4,
        epoch: 0,
      },
    },
  ],
};

function mount() {
  const fixture: StreamFixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  const tree = (frame: string) => (
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "system-view", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <SystemViewComponent config={{ frame } as never} id="sv" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>
  );
  const view = render(tree("auto"));
  act(() => {
    fixture.emit("system.bodies", SYSTEM);
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: KERBIN_INDEX,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: KERBIN_INDEX,
      sma: 6_350_000,
      ecc: 0.88976378,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 3,
      epoch: 0,
      mu: KERBIN_MU,
      horizon: ANALYTIC,
    });
  });
  return {
    fixture,
    view: {
      ...view,
      setFrame: (frame: string) => view.rerender(tree(frame)),
    },
  };
}

const MINMUS_INDEX = 3;
const MINMUS_MU = 1.7658e9;

/** The craft crosses into a moon's sphere of influence: its identity and its elements both name the moon. */
function enterTheMun(
  fixture: StreamFixture,
  moon: {
    index: number;
    mu: number;
    sma: number;
    ecc: number;
  } = { index: MUN_INDEX, mu: MUN_MU, sma: 1_400_000, ecc: 0.7 },
) {
  act(() => {
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: moon.index,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: moon.index,
      sma: moon.sma,
      ecc: moon.ecc,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 3.1,
      epoch: 0,
      mu: moon.mu,
      horizon: ANALYTIC,
    });
  });
}

/**
 * Takes the frame clock over for one test: nothing animates until `run` hands the waiting callbacks a time, so a test reads the view at an instant it chose and never at one the machine's load did.
 */
function holdFrames(): { run: (ms: number) => void } {
  let waiting: FrameRequestCallback[] = [];
  const spy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      waiting.push(callback);
      return waiting.length;
    });
  onTestFinished(() => spy.mockRestore());
  return {
    run(ms) {
      const due = waiting;
      waiting = [];
      act(() => {
        for (const callback of due) callback(ms);
      });
    },
  };
}

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg[viewBox]");
  if (svg === null) throw new Error("the diagram is not drawn");
  return svg as SVGSVGElement;
}

/** Where a circle sits on the picture, as a fraction of its width and height. */
function onScreen(container: HTMLElement, selector: string) {
  const svg = svgOf(container);
  const circle = svg.querySelector(selector);
  if (circle === null) throw new Error(`${selector} is not drawn`);
  const [x, y, w, h] = (svg.getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  return {
    x: (Number(circle.getAttribute("cx")) - x) / w,
    y: (Number(circle.getAttribute("cy")) - y) / h,
    scale: w,
  };
}

function zoomIn(container: HTMLElement, notches: number) {
  act(() => {
    for (let i = 0; i < notches; i++) {
      svgOf(container).dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
}

function zoomOut(container: HTMLElement, notches: number) {
  act(() => {
    for (let i = 0; i < notches; i++) {
      svgOf(container).dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 100,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
}

/** Whether the planet the frame body orbits is drawn as a dot inside the picture, as against pointed to from its edge. */
function planetIsOnThePicture(container: HTMLElement, name: string): boolean {
  const svg = svgOf(container);
  if (svg.querySelector(`[data-frame-parent-direction="${name}"]`) !== null) {
    return false;
  }
  const dot = svg.querySelector(`[data-frame-parent="${name}"] circle`);
  if (dot === null) return false;
  const [x, y, w, h] = (svg.getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  const cx = Number(dot.getAttribute("cx"));
  const cy = Number(dot.getAttribute("cy"));
  return cx > x && cx < x + w && cy > y && cy < y + h;
}

/** The points of a drawn path, in plot units. */
function pathPoints(path: Element): { x: number; y: number }[] {
  const matches = (path.getAttribute("d") ?? "").matchAll(
    /(-?[\d.]+(?:e-?\d+)?),(-?[\d.]+(?:e-?\d+)?)/g,
  );
  return [...matches].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

describe("SystemView when the craft changes the body it orbits", () => {
  it("starts from the picture as it was: the body entered and the body left are where they were", async () => {
    // The ease is held before its first frame, which leaves the carried view.
    holdFrames();
    const { fixture, view } = mount();
    await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
    const munBefore = onScreen(view.container, 'circle[data-body="Mun"]');
    const kerbinBefore = onScreen(view.container, 'circle[data-body="Kerbin"]');

    enterTheMun(fixture);
    await waitFor(() =>
      expect(svgOf(view.container).getAttribute("aria-label")).toContain("Mun"),
    );

    const munAfter = onScreen(view.container, 'circle[data-body="Mun"]');
    expect(munAfter.x).toBeCloseTo(munBefore.x, 6);
    expect(munAfter.y).toBeCloseTo(munBefore.y, 6);
    // Kerbin is no longer the frame body, and is still drawn, as the body the Mun orbits.
    const kerbinAfter = onScreen(
      view.container,
      '[data-frame-parent="Kerbin"] circle',
    );
    expect(kerbinAfter.x).toBeCloseTo(kerbinBefore.x, 6);
    expect(kerbinAfter.y).toBeCloseTo(kerbinBefore.y, 6);
    await act(async () => {});
  });

  it("leaves the view as it mounts when the craft's body first becomes known", async () => {
    // The frame is the star until the craft's body arrives: that change is not the craft crossing anything.
    const { view } = mount();
    await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
    expect(screen.queryByRole("button", { name: "Reset view" })).toBeNull();
    expect(view.container.textContent).not.toContain("was");
    // A planet's star is not marked: only a moon's planet is.
    expect(
      view.container.querySelector(
        "[data-frame-parent], [data-frame-parent-direction]",
      ),
    ).toBeNull();
    await act(async () => {});
  });

  it("names the body the frame left in the caption", async () => {
    // The ease would otherwise tick on the real frame clock, outside `act`.
    holdFrames();
    const { fixture, view } = mount();
    await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
    expect(view.container.textContent).toContain("Frame: Kerbin");
    expect(view.container.textContent).not.toContain("was");

    enterTheMun(fixture);
    await waitFor(() =>
      expect(view.container.textContent).toContain("Frame: Mun, was Kerbin"),
    );
    await act(async () => {});
  });

  it("points to the body left once it is outside the picture", async () => {
    // The ease would otherwise tick on the real frame clock, outside `act`.
    holdFrames();
    const { fixture, view } = mount();
    await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
    enterTheMun(fixture);
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-frame-parent="Kerbin"]'),
      ).not.toBeNull(),
    );

    // Fitted to the Mun's own neighbourhood, Kerbin, 12 Mm away, is off the picture.
    fireEvent.click(await screen.findByRole("button", { name: "Reset view" }));
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-frame-parent-direction="Kerbin"]'),
      ).not.toBeNull(),
    );
    expect(
      view.container.querySelector('[data-frame-parent="Kerbin"]'),
    ).toBeNull();
    const pointer = view.container.querySelector(
      '[data-frame-parent-direction="Kerbin"]',
    );
    expect(pointer?.textContent).toContain("Kerbin");
    await act(async () => {});
  });

  it("zooms from where the carried view is, never snapping to a limit", async () => {
    holdFrames();
    const { fixture, view } = mount();
    await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
    enterTheMun(fixture);
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-frame-parent="Kerbin"]'),
      ).not.toBeNull(),
    );
    const before = onScreen(view.container, 'circle[data-body="Mun"]').scale;
    zoomIn(view.container, 1);
    await waitFor(() =>
      expect(
        onScreen(view.container, 'circle[data-body="Mun"]').scale,
      ).not.toBe(before),
    );
    const after = onScreen(view.container, 'circle[data-body="Mun"]').scale;
    expect(before / after).toBeCloseTo(1.15, 6);
    await act(async () => {});
  });

  it("then eases to the whole of the new frame, centred on the body entered", async () => {
    const frames = holdFrames();
    const { fixture, view } = mount();
    await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
    const fitted = onScreen(view.container, 'circle[data-body="Kerbin"]').scale;
    enterTheMun(fixture);
    await waitFor(() =>
      expect(svgOf(view.container).getAttribute("aria-label")).toContain("Mun"),
    );
    const carried = onScreen(view.container, 'circle[data-body="Mun"]').scale;

    // Half way through, the picture is between the two and still moving.
    frames.run(1000);
    frames.run(1450);
    const midway = onScreen(view.container, 'circle[data-body="Mun"]');
    expect(midway.scale).toBeLessThan(carried);
    expect(midway.scale).toBeGreaterThan(fitted);

    frames.run(2000);
    const settled = onScreen(view.container, 'circle[data-body="Mun"]');
    expect(settled.x).toBeCloseTo(0.5, 9);
    expect(settled.y).toBeCloseTo(0.5, 9);
    expect(settled.scale).toBe(fitted);
    expect(screen.queryByRole("button", { name: "Reset view" })).toBeNull();
    await act(async () => {});
  });

  it("cuts straight to the whole of the new frame under reduced motion, with the caption still naming the frame left", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as never;
    try {
      const { fixture, view } = mount();
      await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
      enterTheMun(fixture);
      await waitFor(() =>
        expect(view.container.textContent).toContain("Frame: Mun, was Kerbin"),
      );
      const mun = onScreen(view.container, 'circle[data-body="Mun"]');
      expect(mun.x).toBeCloseTo(0.5, 6);
      expect(mun.y).toBeCloseTo(0.5, 6);
      await act(async () => {});
    } finally {
      window.matchMedia = original;
    }
  });
  describe("zooming out after the ease", () => {
    const orbits = [
      {
        label: "a high Mun orbit",
        moon: { index: MUN_INDEX, mu: MUN_MU, sma: 1_400_000, ecc: 0.7 },
        planet: "Kerbin",
      },
      {
        label: "a low Mun orbit",
        moon: { index: MUN_INDEX, mu: MUN_MU, sma: 250_000, ecc: 0.01 },
        planet: "Kerbin",
      },
      {
        label: "a Minmus orbit, with Kerbin 47 Mm away",
        moon: { index: MINMUS_INDEX, mu: MINMUS_MU, sma: 90_000, ecc: 0.02 },
        planet: "Kerbin",
      },
    ];

    it.each(orbits)("puts the planet on the picture from $label", async ({
      moon,
      planet,
    }) => {
      const frames = holdFrames();
      const { fixture, view } = mount();
      await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
      enterTheMun(fixture, moon);
      await waitFor(() =>
        expect(svgOf(view.container).getAttribute("aria-label")).toContain(
          moon.index === MUN_INDEX ? "Mun" : "Minmus",
        ),
      );
      frames.run(1000);
      frames.run(2000);

      zoomOut(view.container, 80);

      expect(planetIsOnThePicture(view.container, planet)).toBe(true);
      await act(async () => {});
    });

    it("returns to the fitted frame with Reset view after zooming out", async () => {
      const frames = holdFrames();
      const { fixture, view } = mount();
      await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
      enterTheMun(fixture);
      await waitFor(() =>
        expect(svgOf(view.container).getAttribute("aria-label")).toContain(
          "Mun",
        ),
      );
      frames.run(1000);
      frames.run(2000);
      const fitted = svgOf(view.container).getAttribute("viewBox");

      zoomOut(view.container, 80);
      expect(svgOf(view.container).getAttribute("viewBox")).not.toBe(fitted);
      fireEvent.click(screen.getByRole("button", { name: "Reset view" }));

      expect(svgOf(view.container).getAttribute("viewBox")).toBe(fitted);
      await act(async () => {});
    });
  });
  describe("the frame body's own orbit about its planet", () => {
    async function inTheMunFrame(system?: unknown) {
      const frames = holdFrames();
      const { fixture, view } = mount();
      await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
      if (system !== undefined) {
        act(() => {
          fixture.emit("system.bodies", system);
        });
      }
      enterTheMun(fixture);
      await waitFor(() =>
        expect(svgOf(view.container).getAttribute("aria-label")).toContain(
          "Mun",
        ),
      );
      frames.run(1000);
      frames.run(2000);
      return view;
    }

    it("is drawn about the planet once the planet is on the picture, through the moon", async () => {
      const view = await inTheMunFrame();
      expect(
        view.container.querySelector("path[data-frame-body-orbit]"),
      ).toBeNull();

      zoomOut(view.container, 80);

      const ring = view.container.querySelector(
        'path[data-frame-body-orbit="Mun"]',
      );
      if (ring === null) throw new Error("the Mun's orbit is not drawn");
      const kerbin = svgOf(view.container).querySelector(
        '[data-frame-parent="Kerbin"] circle',
      );
      if (kerbin === null) throw new Error("Kerbin is not on the picture");
      const about = {
        x: Number(kerbin.getAttribute("cx")),
        y: Number(kerbin.getAttribute("cy")),
      };
      const points = pathPoints(ring);
      const radii = points.map((p) => Math.hypot(p.x - about.x, p.y - about.y));
      const radius = radii[0];
      // The path is the Mun's orbit about Kerbin, whatever size it is drawn at.
      for (const r of radii) expect(r / radius).toBeCloseTo(1, 2);
      // The Mun sits at the frame's centre, the origin, and the path passes through it.
      const nearest = Math.min(...points.map((p) => Math.hypot(p.x, p.y)));
      expect(nearest / radius).toBeLessThan(0.02);
      await act(async () => {});
    });

    it("is left out while the planet is only pointed to from the edge", async () => {
      const view = await inTheMunFrame();
      zoomOut(view.container, 2);
      expect(
        view.container.querySelector("[data-frame-parent-direction]"),
      ).not.toBeNull();
      expect(
        view.container.querySelector("path[data-frame-body-orbit]"),
      ).toBeNull();
      await act(async () => {});
    });

    it("is not drawn when the catalogue gives the moon no orbit", async () => {
      const view = await inTheMunFrame({
        bodies: SYSTEM.bodies.map((b) =>
          b.name === "Mun" ? { ...b, orbit: null } : b,
        ),
      });
      zoomOut(view.container, 80);
      expect(
        view.container.querySelector("path[data-frame-body-orbit]"),
      ).toBeNull();
      await act(async () => {});
    });
  });
  describe("anchoring the view on a body", () => {
    const pressTwice = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.click(screen.getByRole("button", { name }));
    };

    async function inTheMunFrame() {
      const frames = holdFrames();
      const { fixture, view } = mount();
      await waitFor(() => onScreen(view.container, 'circle[data-body="Mun"]'));
      enterTheMun(fixture);
      await waitFor(() =>
        expect(svgOf(view.container).getAttribute("aria-label")).toContain(
          "Mun",
        ),
      );
      frames.run(1000);
      frames.run(2000);
      zoomOut(view.container, 80);
      return { view, frames };
    }

    it("anchors on the planet from a moon's frame, which the craft is about, and draws the craft's moon on its own orbit", async () => {
      const { view } = await inTheMunFrame();
      expect(planetIsOnThePicture(view.container, "Kerbin")).toBe(true);

      pressTwice("Kerbin");

      await waitFor(() =>
        expect(view.container.textContent).toContain(
          "Frame: Kerbin (anchored)",
        ),
      );
      expect(svgOf(view.container).getAttribute("aria-label")).toContain(
        "Kerbin",
      );
      expect(
        view.container.querySelector('path[data-body-orbit="Mun"]'),
      ).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "Focus vessel" }),
      ).toBeInTheDocument();
      await act(async () => {});
    });

    it("lets go of the anchor with Reset view", async () => {
      const { view } = await inTheMunFrame();
      pressTwice("Kerbin");
      await waitFor(() =>
        expect(view.container.textContent).toContain("(anchored)"),
      );

      fireEvent.click(screen.getByRole("button", { name: "Reset view" }));

      await waitFor(() =>
        expect(view.container.textContent).not.toContain("(anchored)"),
      );
      expect(svgOf(view.container).getAttribute("aria-label")).toContain("Mun");
      await act(async () => {});
    });

    it("offers Reset view on the whole picture while anchored", async () => {
      const { view, frames } = await inTheMunFrame();
      fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
      pressTwice("Kerbin");
      await waitFor(() =>
        expect(view.container.textContent).toContain("(anchored)"),
      );
      frames.run(3000);
      frames.run(5000);
      expect(svgOf(view.container).getAttribute("aria-label")).toContain(
        "Kerbin",
      );

      fireEvent.click(screen.getByRole("button", { name: "Reset view" }));

      await waitFor(() =>
        expect(view.container.textContent).not.toContain("(anchored)"),
      );
      await act(async () => {});
    });

    it("lets go of the anchor when the Frame setting changes", async () => {
      const { view } = await inTheMunFrame();
      pressTwice("Kerbin");
      await waitFor(() =>
        expect(view.container.textContent).toContain("(anchored)"),
      );

      act(() => view.setFrame("Minmus"));

      await waitFor(() =>
        expect(view.container.textContent).not.toContain("(anchored)"),
      );
      expect(svgOf(view.container).getAttribute("aria-label")).toContain(
        "Minmus",
      );
      await act(async () => {});
    });

    it("anchors from the keyboard with Enter and says so to a screen reader once selected", async () => {
      const { view } = await inTheMunFrame();
      const mark = () => screen.getByRole("button", { name: "Kerbin" });
      expect(mark()).not.toHaveAttribute("aria-describedby");

      fireEvent.keyDown(mark(), { key: "Enter" });
      await waitFor(() =>
        expect(mark()).toHaveAttribute("aria-pressed", "true"),
      );
      const hint = mark().getAttribute("aria-describedby");
      expect(hint).not.toBeNull();
      expect(view.container.querySelector(`[id="${hint}"]`)?.textContent).toBe(
        "Press again to anchor the view on Kerbin",
      );

      fireEvent.keyDown(mark(), { key: " " });
      await waitFor(() =>
        expect(view.container.textContent).toContain(
          "Frame: Kerbin (anchored)",
        ),
      );
      await act(async () => {});
    });

    it("leaves the view and the anchor alone when another body is pressed once", async () => {
      const { view } = await inTheMunFrame();
      pressTwice("Kerbin");
      await waitFor(() =>
        expect(view.container.textContent).toContain("(anchored)"),
      );
      const before = svgOf(view.container).getAttribute("viewBox");

      fireEvent.click(screen.getByRole("button", { name: "Mun" }));

      expect(view.container.textContent).toContain("Frame: Kerbin (anchored)");
      expect(svgOf(view.container).getAttribute("viewBox")).toBe(before);
      await act(async () => {});
    });
  });
});
