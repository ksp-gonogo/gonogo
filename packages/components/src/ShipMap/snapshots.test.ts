import type { VesselTopology } from "@gonogo/core";
import { describe, expect, it } from "vitest";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import roverBAlone from "./__fixtures__/rover-b-alone-28parts.json";
import roverMerged from "./__fixtures__/rover-merged-56parts.json";
import { renderShipMapToSvg } from "./render";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
} from "./shipTopology";

/**
 * SVG output snapshots — locks the rendered ship diagram against
 * unintended drift. The same `renderShipMapToSvg` helper drives the CLI
 * harness (`pnpm --filter @gonogo/components render-ship-map`) so the
 * snapshot reflects exactly what a reviewer would see when opening the
 * SVG in a browser.
 *
 * Floating-point coordinates are rounded to 2dp before snapshotting so
 * unrelated numeric refactors don't produce noisy diffs. If you change
 * the diagram and these snapshots break, eyeball the rendered SVGs in
 * `local_docs/ship-map-renders/` (regenerate with the render-ship-map
 * script) — if the visual change is intended, run `vitest -u`.
 */

interface Fixture {
  "v.topology": VesselTopology;
}

function fixtureToParts(fixture: Fixture): ShipMapPart[] {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  return topo.parts.map((p) =>
    buildShipMapPart(p, undefined, undefined, useX),
  );
}

/** Round any decimal number in an SVG attribute value to 2dp so floating-
 *  point precision below the visible threshold doesn't churn snapshots. */
function normalise(svg: string): string {
  return svg.replace(/-?\d+\.\d+/g, (m) => Number.parseFloat(m).toFixed(2));
}

function renderFixture(fixture: Fixture): string {
  return normalise(
    renderShipMapToSvg(fixtureToParts(fixture), { width: 800, height: 800 }),
  );
}

describe("Ship Map SVG snapshots", () => {
  it("renders rover-b-alone", () => {
    expect(renderFixture(roverBAlone as Fixture)).toMatchSnapshot();
  });

  it("renders rover-merged (docked T-shape)", () => {
    expect(renderFixture(roverMerged as Fixture)).toMatchSnapshot();
  });

  it("renders fuelline-tester-prelaunch (multi-engine with fuel lines)", () => {
    expect(renderFixture(fuellinePrelaunch as Fixture)).toMatchSnapshot();
  });

  it("renders fuelline-tester-poststage2 (minimum-survival craft)", () => {
    expect(renderFixture(fuellinePostStage2 as Fixture)).toMatchSnapshot();
  });

  it("renders an empty parts list as a placeholder", () => {
    expect(
      normalise(renderShipMapToSvg([], { width: 200, height: 200 })),
    ).toMatchSnapshot();
  });
});
