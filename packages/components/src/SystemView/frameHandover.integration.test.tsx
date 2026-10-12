import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
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
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "system-view", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <SystemViewComponent config={{ frame: "auto" } as never} id="sv" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
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
  return { fixture, view };
}

/** The craft crosses into the Mun's sphere of influence: its identity and its elements both name the Mun. */
function enterTheMun(fixture: StreamFixture) {
  act(() => {
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: MUN_INDEX,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: MUN_INDEX,
      sma: 1_400_000,
      ecc: 0.7,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 3.1,
      epoch: 0,
      mu: MUN_MU,
      horizon: ANALYTIC,
    });
  });
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

describe("SystemView when the craft changes the body it orbits", () => {
  it("keeps the body entered and the body left where they were on the picture", async () => {
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
});
