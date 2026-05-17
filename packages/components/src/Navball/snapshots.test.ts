import { describe, expect, it } from "vitest";
import bankedRight from "./__fixtures__/banked-90-right.json";
import gravityTurn from "./__fixtures__/gravity-turn-east.json";
import inverted from "./__fixtures__/inverted-level.json";
import launchpad from "./__fixtures__/launchpad-vertical.json";
import maneuverBurn from "./__fixtures__/maneuver-burn.json";
import northLevel from "./__fixtures__/north-level.json";
import progradeLevel from "./__fixtures__/prograde-east-level.json";
import steepDive from "./__fixtures__/steep-dive-west.json";
import uncontrollableDrift from "./__fixtures__/uncontrollable-drift.json";
import { renderAttitudeDialToSvg } from "./render";

/**
 * Attitude-dial SVG snapshots. The same `renderAttitudeDialToSvg` helper
 * drives the CLI harness (`pnpm --filter @gonogo/components render-navball`)
 * so the snapshot reflects exactly what a reviewer would see when opening
 * the SVG in a browser.
 *
 * Floating-point coordinates are rounded to 2dp before snapshotting so
 * unrelated numeric refactors don't produce noisy diffs. If you change
 * the dial and these snapshots break, eyeball the rendered SVGs in
 * `local_docs/renders/navball/` (regenerate with the render-navball
 * script). If the visual change is intended, run `vitest -u`.
 */

interface Fixture {
  "n.heading": number;
  "n.pitch": number;
  "n.roll": number;
}

function normalise(svg: string): string {
  return svg.replace(/-?\d+\.\d+/g, (m) => Number.parseFloat(m).toFixed(2));
}

function renderFixture(f: Fixture): string {
  return normalise(
    renderAttitudeDialToSvg({
      heading: f["n.heading"],
      pitch: f["n.pitch"],
      roll: f["n.roll"],
      size: 320,
    }),
  );
}

describe("Attitude dial SVG snapshots", () => {
  it("renders launchpad-vertical (pitch +90, nose up)", () => {
    expect(renderFixture(launchpad as Fixture)).toMatchSnapshot();
  });

  it("renders prograde-east-level (baseline, horizon bisects dial)", () => {
    expect(renderFixture(progradeLevel as Fixture)).toMatchSnapshot();
  });

  it("renders gravity-turn-east (pitch +45, climbing east)", () => {
    expect(renderFixture(gravityTurn as Fixture)).toMatchSnapshot();
  });

  it("renders banked-90-right (knife-edge bank, horizon vertical)", () => {
    expect(renderFixture(bankedRight as Fixture)).toMatchSnapshot();
  });

  it("renders inverted-level (180° roll, sky/ground swap)", () => {
    expect(renderFixture(inverted as Fixture)).toMatchSnapshot();
  });

  it("renders steep-dive-west (pitch -60, heading 270, 10° roll)", () => {
    expect(renderFixture(steepDive as Fixture)).toMatchSnapshot();
  });

  it("renders maneuver-burn (heading 120, slight pitch up)", () => {
    expect(renderFixture(maneuverBurn as Fixture)).toMatchSnapshot();
  });

  it("renders uncontrollable-drift (descending, mild roll)", () => {
    expect(renderFixture(uncontrollableDrift as Fixture)).toMatchSnapshot();
  });

  it("renders north-level (heading 0, level horizon)", () => {
    expect(renderFixture(northLevel as Fixture)).toMatchSnapshot();
  });

  it("renders a no-data placeholder (all inputs null)", () => {
    expect(
      normalise(
        renderAttitudeDialToSvg({
          heading: null,
          pitch: null,
          roll: null,
          size: 200,
        }),
      ),
    ).toMatchSnapshot();
  });
});
