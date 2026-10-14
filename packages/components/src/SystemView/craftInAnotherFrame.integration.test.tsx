import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;

const KERBOL_INDEX = 0;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;

const MUN_SMA = 12_000_000;

const SYSTEM = {
  bodies: [
    {
      index: KERBOL_INDEX,
      name: "Kerbol",
      parentIndex: null,
      radius: 261_600_000,
      gravParameter: KERBOL_MU,
      orbit: null,
    },
    {
      index: KERBIN_INDEX,
      name: "Kerbin",
      parentIndex: KERBOL_INDEX,
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
        sma: MUN_SMA,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 1.7,
        epoch: 0,
      },
    },
  ],
};

function mount(parentBodyIndex: number, frame: string) {
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
          <SystemViewComponent config={{ frame } as never} id="sv" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", SYSTEM);
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: parentBodyIndex,
      sma: 400_000,
      ecc: 0.05,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
      mu: parentBodyIndex === MUN_INDEX ? MUN_MU : KERBIN_MU,
      horizon: { kind: 1, trajectoryKind: 2 },
    });
  });
  return { fixture, view };
}

/** The craft's marker and the named body's dot, once both are drawn. */
async function craftAndBody(
  view: { container: HTMLElement },
  bodyName: string,
): Promise<{ craft: Element; body: { x: number; y: number } }> {
  const dot = await waitFor(() => {
    const found = view.container.querySelector(
      `circle[data-body="${bodyName}"]`,
    );
    if (found === null) throw new Error(`${bodyName} is not drawn yet`);
    return found;
  });
  const craft = await waitFor(() => {
    const found = view.container.querySelector("[data-vessel-position]");
    if (found === null) throw new Error("the craft is not drawn");
    return found;
  });
  return {
    craft,
    body: {
      x: Number(dot.getAttribute("cx")),
      y: Number(dot.getAttribute("cy")),
    },
  };
}

/** Whether any circle of the craft's marker sits within `pixels` of the point. */
function markerNear(
  craft: Element,
  at: { x: number; y: number },
  pixels: number,
): boolean {
  return Array.from(craft.querySelectorAll("circle")).some((c) => {
    const dx = Number(c.getAttribute("cx")) - at.x;
    const dy = Number(c.getAttribute("cy")) - at.y;
    return Math.hypot(dx, dy) < pixels;
  });
}

describe("SystemView draws the craft in a frame centred on another body", () => {
  it("puts a craft in the Mun's sphere of influence at the Mun when the frame is Kerbin", async () => {
    const { view } = mount(MUN_INDEX, "Kerbin");
    const { craft, body } = await craftAndBody(view, "Mun");
    expect(markerNear(craft, body, 12)).toBe(true);
    await act(async () => {});
  });

  it("puts a craft about Kerbin at Kerbin when the frame is the star two bodies up", async () => {
    const { view } = mount(KERBIN_INDEX, "Kerbol");
    const { craft, body } = await craftAndBody(view, "Kerbin");
    expect(markerNear(craft, body, 12)).toBe(true);
    await act(async () => {});
  });

  it("draws a craft about a body with no moons rather than the empty state when the frame follows the craft", async () => {
    const { view } = mount(MUN_INDEX, "auto");
    const { craft } = await craftAndBody(view, "Mun");
    expect(craft).not.toBeNull();
    expect(view.container.textContent).not.toContain("No bodies orbiting");
    await act(async () => {});
  });
});
