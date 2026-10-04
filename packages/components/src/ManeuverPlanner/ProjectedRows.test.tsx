import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ProjectedRows } from "./ProjectedRows";

const PROJECTED = {
  ApR: 800_000,
  PeR: 700_000,
  sma: 750_000,
  eccentricity: 0.07,
  period: 2_000,
  inclination: 1.5,
};

function renderRows(marking: Parameters<typeof ProjectedRows>[0]["marking"]) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <ProjectedRows
        projected={PROJECTED}
        body={{
          id: "kerbin",
          name: "Kerbin",
          radius: 600_000,
          hasAtmosphere: true,
          maxAtmosphere: 70_000,
        }}
        marking={marking}
      />
    </fixture.Provider>,
  );
  return { view, fixture };
}

describe("ManeuverPlanner ProjectedRows marks", () => {
  it("draws the planned orbit's figures plain while the orbit is current", async () => {
    const { view } = renderRows(null);
    await act(async () => {});
    expect(view.container.querySelector("[data-reckoned]")).toBeNull();
  });

  it.each([
    "held",
    "modelled",
  ] as const)("marks every planned figure %s when the orbit it came from is", async (kind) => {
    const { view } = renderRows({ kind, caption: kind });
    await act(async () => {});
    const marked = view.container.querySelectorAll(`[data-reckoned="${kind}"]`);
    // Ap, Pe, T and Inc: Ecc is a bare ratio and no Unit.
    expect(marked.length).toBeGreaterThanOrEqual(4);
  });
});
