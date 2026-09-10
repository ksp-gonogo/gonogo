import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * The diagram is the third pan/zoom surface, and the last one still holding its
 * own wheel handler. That handler was React's, so it was passive and never
 * blocked the page; what it did do was zoom the diagram out from under anyone
 * scrolling past it, because it fired on every wheel event the pointer
 * happened to be over.
 *
 * Both directions are asserted, because either one alone passes for the wrong
 * reason: a surface that has stopped zooming entirely satisfies the first test,
 * and one that swallows every wheel satisfies the second.
 */

const KERBIN_MU = 3.5316e12;

function system() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        orbit: null,
      },
      {
        index: 1,
        name: "Mun",
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5e10,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
    ],
  };
}

/** viewBox width = tile width (360) / zoom, so zoom = 360 / vbWidth. */
function currentZoom(container: HTMLElement): number {
  const svg = container.querySelector("svg");
  const vb = (svg?.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  const vbWidth = vb[2] || 360;
  return 360 / vbWidth;
}

/**
 * Renders the widget and waits for the populated diagram. The empty state
 * returns before the element the wheel listener binds to exists, so a test that
 * dispatched at it would be dispatching at nothing.
 */
async function renderDiagram() {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: ["system.bodies", "vessel.identity", "vessel.orbit"],
    pinnedUt: 100,
    suspendFrames: true,
  });
  const { container } = render(
    <fixture.Provider>
      <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", system());
  });
  await waitFor(() =>
    expect(
      container.querySelectorAll("path[data-body-orbit]").length,
    ).toBeGreaterThan(0),
  );
  return container;
}

/** A real dispatch rather than `fireEvent`, so `defaultPrevented` can be read. */
function wheelOn(el: Element, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent("wheel", {
    deltaY: -100,
    cancelable: true,
    bubbles: true,
    ...init,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

describe("SystemView wheel handling", () => {
  it("leaves a plain wheel to the page so scrolling past the diagram does not zoom it", async () => {
    const container = await renderDiagram();
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no diagram svg");
    const before = currentZoom(container);

    const ev = wheelOn(svg, {});

    expect(ev.defaultPrevented).toBe(false);
    expect(currentZoom(container)).toBe(before);
  });

  it("zooms on ctrl+wheel, the gesture a trackpad pinch sends, and keeps that one off the page", async () => {
    const container = await renderDiagram();
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no diagram svg");
    const before = currentZoom(container);

    const ev = wheelOn(svg, { ctrlKey: true });

    expect(ev.defaultPrevented).toBe(true);
    expect(currentZoom(container)).toBeGreaterThan(before);
  });
});
