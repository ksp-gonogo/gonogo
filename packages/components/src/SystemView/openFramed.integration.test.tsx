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

/** A circular orbit well inside the Mun's: the whole system is far wider than the craft's orbit. */
const LOW_ORBIT = { sma: 900_000, ecc: 0 };

function emitCraft(
  fixture: StreamFixture,
  body: { index: number; mu: number },
  orbit: { sma: number; ecc: number },
) {
  act(() => {
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: body.index,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: body.index,
      sma: orbit.sma,
      ecc: orbit.ecc,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 3,
      epoch: 0,
      mu: body.mu,
      horizon: ANALYTIC,
    });
  });
}

function mount(options: { frame?: string; craft?: boolean } = {}) {
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
          <SystemViewComponent
            config={{ frame: options.frame ?? "auto" } as never}
            id="sv"
          />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", SYSTEM);
  });
  if (options.craft !== false) {
    emitCraft(fixture, { index: KERBIN_INDEX, mu: KERBIN_MU }, LOW_ORBIT);
  }
  return { fixture, view };
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

/** The width of the picture in plot units: the smaller, the more the diagram is zoomed in. */
function pictureWidth(container: HTMLElement): number {
  const svg = container.querySelector("svg[viewBox]");
  if (svg === null) throw new Error("the diagram is not drawn");
  return Number((svg.getAttribute("viewBox") ?? "").split(/\s+/)[2]);
}

/** Where the craft's marker sits on the picture, as a fraction of its width and height. */
function craftOnScreen(container: HTMLElement) {
  const svg = container.querySelector("svg[viewBox]");
  const mark = svg?.querySelector(
    "[data-vessel-position] > circle[cx]:not([data-vessel-selected]):not([data-vessel-hit])",
  );
  if (!svg || !mark) throw new Error("the craft is not drawn");
  const [x, y, w, h] = (svg.getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  return {
    x: (Number(mark.getAttribute("cx")) - x) / w,
    y: (Number(mark.getAttribute("cy")) - y) / h,
  };
}

const resetView = () => screen.queryByRole("button", { name: "Reset view" });

describe("SystemView opens framed on the craft's orbit", () => {
  it("opens on the craft's orbit when a craft orbits the frame body", async () => {
    const whole = mount({ craft: false });
    await waitFor(() => pictureWidth(whole.view.container));
    const wholeWidth = pictureWidth(whole.view.container);
    whole.view.unmount();

    const { view } = mount();
    await waitFor(() => expect(resetView()).not.toBeNull());
    expect(pictureWidth(view.container)).toBeLessThan(wholeWidth / 4);
    await act(async () => {});
  });

  it("keeps the whole system when there is no craft", async () => {
    const { view } = mount({ craft: false });
    await waitFor(() => pictureWidth(view.container));
    expect(resetView()).toBeNull();
    await act(async () => {});
  });

  it("keeps the whole system when the craft orbits another body than the frame's", async () => {
    // The frame is held on the Mun while the craft is about Kerbin.
    const { view } = mount({ frame: "Mun" });
    await waitFor(() => pictureWidth(view.container));
    expect(resetView()).toBeNull();
    await act(async () => {});
  });

  it("returns to the whole system with Reset view", async () => {
    const whole = mount({ craft: false });
    await waitFor(() => pictureWidth(whole.view.container));
    const wholeWidth = pictureWidth(whole.view.container);
    whole.view.unmount();

    const { view } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reset view" }));
    await waitFor(() =>
      expect(pictureWidth(view.container)).toBeCloseTo(wholeWidth, 6),
    );
    expect(resetView()).toBeNull();
    await act(async () => {});
  });

  it("centres on the craft and zooms to its orbit with Focus vessel", async () => {
    const frames = holdFrames();
    const { view } = mount();
    const framedWidth = await waitFor(() => {
      expect(resetView()).not.toBeNull();
      return pictureWidth(view.container);
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    const wholeWidth = pictureWidth(view.container);
    expect(wholeWidth).toBeGreaterThan(framedWidth);

    fireEvent.click(screen.getByRole("button", { name: "Focus vessel" }));
    frames.run(1000);
    frames.run(2500);
    expect(pictureWidth(view.container)).toBeCloseTo(framedWidth, 6);
    const craft = craftOnScreen(view.container);
    expect(craft.x).toBeCloseTo(0.5, 6);
    expect(craft.y).toBeCloseTo(0.5, 6);
    await act(async () => {});
  });

  it("does not move a view the operator has moved when the orbit arrives later", async () => {
    const { fixture, view } = mount({ craft: false });
    await waitFor(() => pictureWidth(view.container));
    const before = pictureWidth(view.container);
    act(() => {
      svgWheel(view.container, -100);
    });
    const moved = pictureWidth(view.container);
    expect(moved).toBeLessThan(before);

    emitCraft(fixture, { index: KERBIN_INDEX, mu: KERBIN_MU }, LOW_ORBIT);
    await act(async () => {});
    expect(pictureWidth(view.container)).toBe(moved);
  });

  it("does not reframe when the orbit changes after the picture opened", async () => {
    const { fixture, view } = mount();
    await waitFor(() => expect(resetView()).not.toBeNull());
    act(() => {
      svgWheel(view.container, 100);
    });
    const moved = pictureWidth(view.container);

    emitCraft(
      fixture,
      { index: KERBIN_INDEX, mu: KERBIN_MU },
      { sma: 1_500_000, ecc: 0.1 },
    );
    await act(async () => {});
    expect(pictureWidth(view.container)).toBe(moved);
  });
});

function svgWheel(container: HTMLElement, deltaY: number) {
  const svg = container.querySelector("svg[viewBox]");
  if (svg === null) throw new Error("the diagram is not drawn");
  svg.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}
