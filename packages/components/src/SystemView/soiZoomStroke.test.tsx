import { act, fireEvent, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * Board #28 regression: near-parent-orbit visibility at SOI zoom.
 *
 * SystemView's `plotScale` (metres -> SVG user-units) is pinned to the
 * OUTERMOST orbit and never rescales on zoom; zooming only shrinks the
 * origin-centred SVG `viewBox` (magnification), capped at 25x. So a
 * near-parent orbit renders at a tiny fixed user-unit radius and is only
 * inspectable by zooming in.
 *
 * The bug: orbit + trajectory stroke widths were authored in SVG USER-UNITS
 * (`strokeWidth={1.2}` etc.), not divided by `zoom` like every dot / marker /
 * label / border in the diagram. Because the viewBox magnifies user-units,
 * an orbit's ON-SCREEN stroke grew with zoom, hitting 1.2 * 25 = 30 px at max
 * zoom. A near-parent orbit was then swallowed by its own 30 px stroke into an
 * unreadable filled blob that also smeared over the parent + nearby objects,
 * i.e. the near-parent orbit was no longer visible AS an orbit at SOI zoom.
 *
 * Invariant this locks in: an orbit's on-screen stroke width stays a thin,
 * roughly zoom-invariant line at ANY zoom (the same screen-constant treatment
 * the body markers already get via `/zoom`). At zoom=1 the rendered width is
 * unchanged (`1.2 / 1 === 1.2`), so the auto-fit visual-gate baseline does not
 * move.
 */

const KERBIN_MU = 3.5316e12;

// A wide-dynamic-range frame: a NEAR moon (2 Mm) close to the parent and a FAR
// moon (120 Mm) that pins plotScale, so the near orbit is compressed and only
// readable by zooming in, exactly the SOI-zoom situation the bug is about.
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
      carriedChannels: ["system.bodies", "vessel.identity", "vessel.orbit"],
      pinnedUt: 100,
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
      expect(container.querySelectorAll("ellipse").length).toBeGreaterThan(0),
    );

    // Zoom to the 25x cap (wheel is 1.15x per notch; 30 notches saturates).
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no diagram svg");
    for (let i = 0; i < 30; i++) fireEvent.wheel(svg, { deltaY: -100 });

    const zoom = currentZoom(container);
    expect(zoom).toBeGreaterThan(20); // reached (near) the 25x cap

    // Every orbit ellipse's ON-SCREEN stroke (user-unit width * zoom) must stay
    // a thin line. Pre-fix this was 1.2 * 25 = 30 px; a screen-constant stroke
    // stays ~1.2 px. Cap at 3 px leaves headroom without admitting the blob.
    const ellipses = Array.from(container.querySelectorAll("ellipse"));
    expect(ellipses.length).toBeGreaterThan(0);
    for (const el of ellipses) {
      const strokeUser = Number(el.getAttribute("stroke-width"));
      const onScreen = strokeUser * zoom;
      expect(onScreen).toBeLessThanOrEqual(3);
    }
  });
});
