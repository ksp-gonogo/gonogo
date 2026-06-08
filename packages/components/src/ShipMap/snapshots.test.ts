import type { PartState, PartStateModule, VesselTopology } from "@gonogo/core";
import { describe, expect, it } from "vitest";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import fuellinePrelaunchPartState from "./__fixtures__/fuelline-tester-22parts-prelaunch.partState.json";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import oxstatRing from "./__fixtures__/oxstat-ring-17parts.json";
import roverBAlone from "./__fixtures__/rover-b-alone-28parts.json";
import roverMerged from "./__fixtures__/rover-merged-56parts.json";
import wingedLander from "./__fixtures__/winged-lander-31parts.json";
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
 * `local_docs/renders/ship-map/` (regenerate with the render-ship-map
 * script) — if the visual change is intended, run `vitest -u`.
 */

interface Fixture {
  "v.topology": VesselTopology;
}

type PartStateSidecar = Record<string, PartStateModule[]>;

function fixtureToParts(
  fixture: Fixture,
  sidecar?: PartStateSidecar,
): ShipMapPart[] {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  const orgPosById = new Map(topo.parts.map((p) => [p.flightId, p.orgPos]));
  return topo.parts.map((p) => {
    const modules = sidecar?.[String(p.flightId)];
    const partState: PartState | undefined = modules
      ? { seq: 0, modules }
      : undefined;
    return buildShipMapPart(
      p,
      undefined,
      undefined,
      useX,
      partState,
      p.parentFlightId != null ? orgPosById.get(p.parentFlightId) : null,
    );
  });
}

/** Round any decimal number in an SVG attribute value to 2dp so floating-
 *  point precision below the visible threshold doesn't churn snapshots. */
function normalise(svg: string): string {
  return svg.replace(/-?\d+\.\d+/g, (m) => Number.parseFloat(m).toFixed(2));
}

function renderFixture(fixture: Fixture, sidecar?: PartStateSidecar): string {
  return normalise(
    renderShipMapToSvg(fixtureToParts(fixture, sidecar), {
      width: 800,
      height: 800,
    }),
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
    // Drives the partState overlay path: synthetic engine-firing /
    // parachute-armed / solar-deploying entries in the sidecar exercise
    // renderPartStateOverlays in the snapshot fold. Without the sidecar
    // the snapshot would never catch a regression in the overlay layer.
    expect(
      renderFixture(
        fuellinePrelaunch as Fixture,
        fuellinePrelaunchPartState as PartStateSidecar,
      ),
    ).toMatchSnapshot();
  });

  it("renders fuelline-tester-poststage2 (minimum-survival craft)", () => {
    expect(renderFixture(fuellinePostStage2 as Fixture)).toMatchSnapshot();
  });

  it("renders oxstat-ring (radial OX-STAT panels, axial-major)", () => {
    // Regression guard: the eight OX-STAT panels ring the booster base
    // with their long axis axial, so each body box is taller than wide.
    // The solar shape must orient as a vertical strip; a horizontal
    // strip here reads perpendicular to the real panel orientation.
    expect(renderFixture(oxstatRing as Fixture)).toMatchSnapshot();
  });

  it("renders winged-lander (radial winglets + two solar rings)", () => {
    // Real-capture fixture: AV-T1 + AV-R8 winglets and two OX-STAT rings.
    // Exercises azimuth foreshortening for both flat-plate types — fins
    // (broad span radial) and panels (broad face tangential) — on parts
    // mounted to non-root parents, so it also guards the parent-relative
    // radial basis.
    expect(renderFixture(wingedLander as Fixture)).toMatchSnapshot();
  });

  it("renders an empty parts list as a placeholder", () => {
    expect(
      normalise(renderShipMapToSvg([], { width: 200, height: 200 })),
    ).toMatchSnapshot();
  });
});
