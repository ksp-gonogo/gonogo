import type {
  PartState,
  PartStateModule,
  VesselTopology,
} from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import fuellinePrelaunchPartState from "./__fixtures__/fuelline-tester-22parts-prelaunch.partState.json";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import oxstatRing from "./__fixtures__/oxstat-ring-17parts.json";
import roverBAlone from "./__fixtures__/rover-b-alone-28parts.json";
import roverMerged from "./__fixtures__/rover-merged-56parts.json";
import syntheticRadialOffsets from "./__fixtures__/synthetic-radial-offsets-16parts.json";
import wingedLander from "./__fixtures__/winged-lander-31parts.json";
import { renderShipMapToSvg } from "./render";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
} from "./shipTopology";

/**
 * SVG output snapshots of the ship diagram, through the same
 * `renderShipMapToSvg` the `render-ship-map` CLI harness uses. Coordinates are
 * rounded to 2dp so numeric refactors do not churn. On a break, eyeball the
 * harness SVGs; if the change is intended, run `vitest -u`.
 */

interface Fixture {
  "v.topology": VesselTopology;
  /** A fixture's free-text note, declared because an undeclared key fails the `as Fixture` cast with an error naming `orgPos`. */
  _comment?: string;
}

type PartStateSidecar = Record<string, PartStateModule[]>;

/** Drops the sidecar fixtures' `_comment` key, leaving the per-flightId entries. */
function sidecarOf(raw: Record<string, unknown>): PartStateSidecar {
  const out: PartStateSidecar = {};
  for (const [flightId, modules] of Object.entries(raw)) {
    if (flightId === "_comment") continue;
    out[flightId] = Array.isArray(modules)
      ? (modules as PartStateModule[])
      : [];
  }
  return out;
}

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

/** Round decimals in SVG attribute values to 2dp so sub-visible precision does not churn snapshots. */
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
    // The sidecar's synthetic engine, parachute and solar states exercise renderPartStateOverlays.
    expect(
      renderFixture(
        fuellinePrelaunch as Fixture,
        sidecarOf(fuellinePrelaunchPartState),
      ),
    ).toMatchSnapshot();
  });

  it("renders fuelline-tester-poststage2 (minimum-survival craft)", () => {
    expect(renderFixture(fuellinePostStage2 as Fixture)).toMatchSnapshot();
  });

  it("renders oxstat-ring (radial OX-STAT panels, axial-major)", () => {
    // The OX-STAT panels ring the booster base long axis axial, so each solar box renders as a vertical strip.
    expect(renderFixture(oxstatRing as Fixture)).toMatchSnapshot();
  });

  it("renders winged-lander (radial winglets + two solar rings)", () => {
    // Winglets and two OX-STAT rings on non-root parents: azimuth foreshortening for both plate types, parent-relative.
    expect(renderFixture(wingedLander as Fixture)).toMatchSnapshot();
  });

  it("renders synthetic-radial-offsets (part-local mesh-centre offsets)", () => {
    // The only fixture whose `bounds.center` is the mod's part-local `Part.boundsCentroidOffset`, so the only rendered check of the frame conversion.
    expect(renderFixture(syntheticRadialOffsets as Fixture)).toMatchSnapshot();
  });

  it("renders an empty parts list as a placeholder", () => {
    expect(
      normalise(renderShipMapToSvg([], { width: 200, height: 200 })),
    ).toMatchSnapshot();
  });
});
