import { act, fireEvent, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * An orbit's on-screen stroke stays a thin, roughly zoom-invariant line at any zoom.
 *
 * `plotScale` is pinned to the outermost orbit and zoom only shrinks the viewBox (up to 25x), so a user-unit stroke would grow with zoom and swallow a near-parent orbit. At zoom 1 the width is unchanged, so the visual baseline does not move.
 */

const KERBIN_MU = 3.5316e12;

// A near moon (2 Mm) and a far moon (120 Mm) that pins plotScale, so the near orbit is readable only by zooming in.
function wideSystem() {
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
        name: "Near",
        parentIndex: 0,
        radius: 100_000,
        gravParameter: 6.5e10,
        orbit: {
          sma: 2_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
      {
        index: 2,
        name: "Far",
        parentIndex: 0,
        radius: 100_000,
        gravParameter: 1.7e9,
        orbit: {
          sma: 120_000_000,
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

describe("SystemView: near-parent orbit stroke stays readable at SOI zoom (board #28)", () => {
  it("keeps orbit stroke a thin, screen-constant line at max zoom instead of ballooning with the viewBox", async () => {
    const fixture: StreamFixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });
    const { container } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.bodies", wideSystem());
    });
    await waitFor(() =>
      expect(
        container.querySelectorAll("path[data-body-orbit]").length,
      ).toBeGreaterThan(0),
    );

    // Zoom to the 25x cap (1.15x per notch). ctrl+wheel is the pinch gesture the diagram zooms on; a plain wheel belongs to the page.
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no diagram svg");
    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(svg, { deltaY: -100, ctrlKey: true });
    }

    const zoom = currentZoom(container);
    expect(zoom).toBeGreaterThan(20); // reached (near) the 25x cap

    // A screen-constant stroke stays about 1.2px; a user-unit one would reach 30px at the cap.
    const rings = Array.from(
      container.querySelectorAll("path[data-body-orbit]"),
    );
    expect(rings.length).toBeGreaterThan(0);
    for (const el of rings) {
      const strokeUser = Number(el.getAttribute("stroke-width"));
      const onScreen = strokeUser * zoom;
      expect(onScreen).toBeLessThanOrEqual(3);
    }
  });
});
