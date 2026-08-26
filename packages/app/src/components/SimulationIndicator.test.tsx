import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SimulationIndicator } from "./SimulationIndicator";

/**
 * The board's own statement that the flight it is describing is a rehearsal.
 *
 * The case worth pinning hardest is the silent one: a game with no rehearsal
 * mode publishes nothing on this channel, and rendering a MISSION badge there
 * would be a claim nothing on the wire supports. Stock is most of the
 * installs, so a wrong answer there is a wrong answer nearly everywhere.
 */
function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["flight.simulation"],
  });
  render(
    <fixture.Provider>
      <SimulationIndicator />
    </fixture.Provider>,
  );
  return fixture;
}

function emit(
  fixture: ReturnType<typeof setupStreamFixture>,
  payload: Record<string, unknown>,
) {
  act(() => {
    fixture.emit("flight.simulation", payload);
    fixture.wall.advanceBy(1);
    fixture.store.beginFrame();
  });
}

describe("SimulationIndicator", () => {
  it("says nothing under a game that has no simulations", () => {
    mount();

    expect(screen.queryByText("SIMULATION")).toBeNull();
  });

  it("says nothing for a real mission", () => {
    const fixture = mount();

    emit(fixture, {
      simulated: false,
      delayApplied: true,
      delayInSimulation: false,
    });

    expect(screen.queryByText("SIMULATION")).toBeNull();
  });

  it("marks a rehearsal, and says the delay went with it", () => {
    const fixture = mount();

    emit(fixture, {
      simulated: true,
      delayApplied: false,
      delayInSimulation: false,
    });

    expect(screen.getByText("SIMULATION")).toBeInTheDocument();
    expect(screen.getByText("DELAY CUT")).toBeInTheDocument();
  });

  /**
   * The operator asked to rehearse under the real delay, so the board IS
   * delayed and the ordinary reading applies. Saying otherwise would tell them
   * to trust a live board that is not one.
   */
  it("drops the delay badge when the operator kept the delay on", () => {
    const fixture = mount();

    emit(fixture, {
      simulated: true,
      delayApplied: true,
      delayInSimulation: true,
    });

    expect(screen.getByText("SIMULATION")).toBeInTheDocument();
    expect(screen.queryByText("DELAY CUT")).toBeNull();
  });
});
