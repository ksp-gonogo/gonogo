import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  UNBOUNDED_HORIZON,
} from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * The state word beside the dashes when the conic will not advance the
 * elements.
 *
 * Five dashes and nothing else cannot be told from a broken widget, and the two
 * want opposite reactions: one is the model declining by design, the other is
 * a fault. The word is the instrument's state, not an explanation, one word
 * for every decline; each scene below declines for a different reason, and the
 * control at the end declines for none.
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
  "system.frame",
];

const EARTH = {
  index: 1,
  name: "Earth",
  gravParameter: 3.986e14,
  radius: 6371000,
  atmosphere: { depth: 140000, hasOxygen: true, seaLevelPressure: 101.3 },
};

function scene(orbit: Record<string, unknown>, quality = Quality.OnRails) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "co-ms" }}>
        <CurrentOrbitComponent config={{}} id="co-ms" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", { bodies: [EARTH] });
    fixture.emit("vessel.identity", {
      vesselId: "co-ms-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 1,
    });
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 6371000 + 400000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
        mu: 3.986e14,
        ...orbit,
      },
      { quality },
    );
  });
}

describe("CurrentOrbit names why the figures are dashes", () => {
  it("says CANNOT MODEL for a loaded craft, with the condition in its note", () => {
    scene({}, Quality.Loaded);

    const state = screen.getByText("CANNOT MODEL");
    expect(state.getAttribute("title")).toMatch(/under physics/);
  });

  it("says CANNOT MODEL for a coast inside the air", () => {
    scene({ sma: 6371000 + 60000 });

    expect(screen.getByText("CANNOT MODEL")).toBeInTheDocument();
  });

  it("says CANNOT MODEL past the SOI transition", () => {
    scene({ encounter: { transitionUt: 5 } });

    expect(screen.getByText("CANNOT MODEL")).toBeInTheDocument();
  });

  it("leaves a refused trajectory to its own note rather than saying it twice", () => {
    // A provider that stated no shape: the trajectory is withheld, and its note
    // is the account on screen.
    scene({ horizon: UNBOUNDED_HORIZON });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/CANNOT MODEL/)).toBeNull();
  });

  it("says nothing when the conic advances the orbit", () => {
    // The control: without it every case above would also pass on a widget
    // that printed a state word unconditionally.
    scene({});

    expect(screen.queryByText(/CANNOT MODEL/)).toBeNull();
  });
});
