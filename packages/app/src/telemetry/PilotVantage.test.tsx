import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PilotVantage } from "./PilotVantage";

/** The instant every case pins the view clock to. */
const VIEW_UT = 1_000;

const CRAFT = "vessel:abc-123";

/**
 * The roster the mod publishes for a save whose crewed craft is a control
 * source with an antenna: exactly the shape `CrewedVesselSource` mints, KSC
 * alongside it because every save has one.
 */
const ROSTER = [
  { id: "ksc", displayName: "KSC", active: true },
  { id: CRAFT, displayName: "Ares I", active: true },
];

/**
 * Mounts the binding over a real client/store pipeline, with the craft's own
 * `meta.source` on the orbit sample: that stamp is what `vessel.state`'s
 * `subjectId` is, and the whole point of the fix is that it already spells the
 * centre id.
 */
function mountPilot() {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.orbit", "commandCentre.roster"],
    pinnedUt: VIEW_UT,
  });
  let selectionChanges = 0;
  fixture.client.onSelectedVantageChange(() => {
    selectionChanges += 1;
  });
  const view = render(
    <fixture.Provider>
      <PilotVantage />
    </fixture.Provider>,
  );
  return {
    ...fixture,
    ...view,
    selections: () => selectionChanges,
    emitRoster: (roster: unknown) => {
      act(() => {
        fixture.emit("commandCentre.roster", roster);
        fixture.store.beginFrame();
      });
    },
    emitOrbitFrom: (source: string) => {
      act(() => {
        fixture.emit(
          "vessel.orbit",
          {
            referenceBodyIndex: 1,
            sma: 700_000,
            ecc: 0.01,
            inc: 0,
            lan: 0,
            argPe: 0,
            meanAnomalyAtEpoch: 0,
            epoch: 10,
            mu: 3.5316e12,
          },
          { source },
        );
        fixture.store.beginFrame();
      });
    },
  };
}

describe("PilotVantage", () => {
  it("moves the session off the ground and onto the craft the pilot is aboard", () => {
    const fixture = mountPilot();
    expect(fixture.client.selectedVantage).toBe("ksc");

    fixture.emitRoster(ROSTER);
    fixture.emitOrbitFrom(CRAFT);

    expect(fixture.client.selectedVantage).toBe(CRAFT);

    fixture.unmount();
  });

  it("keeps the ground vantage for a craft the roster does not carry as an active centre", () => {
    const fixture = mountPilot();

    fixture.emitRoster([{ id: "ksc", displayName: "KSC", active: true }]);
    fixture.emitOrbitFrom(CRAFT);

    // The mod would refuse this id, and a refused request tracked optimistically would leave every reader of `selectedVantage` naming a centre the frames are not from.
    expect(fixture.client.selectedVantage).toBe("ksc");

    fixture.unmount();
  });

  it("asks once: a repeated frame from the same craft re-subscribes nothing", () => {
    const fixture = mountPilot();

    fixture.emitRoster(ROSTER);
    fixture.emitOrbitFrom(CRAFT);
    fixture.emitOrbitFrom(CRAFT);
    fixture.emitOrbitFrom(CRAFT);

    expect(fixture.selections()).toBe(1);

    fixture.unmount();
  });

  it("re-points onto the new craft when the pilot switches vessel", () => {
    const other = "vessel:xyz-999";
    const fixture = mountPilot();

    fixture.emitRoster([
      ...ROSTER,
      { id: other, displayName: "Ares II", active: true },
    ]);
    fixture.emitOrbitFrom(CRAFT);
    fixture.emitOrbitFrom(other);

    expect(fixture.client.selectedVantage).toBe(other);

    fixture.unmount();
  });
});
