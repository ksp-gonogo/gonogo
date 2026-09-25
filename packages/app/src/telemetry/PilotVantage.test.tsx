import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PilotVantage } from "./PilotVantage";

/** The instant every case pins the view clock to. */
const VIEW_UT = 1_000;

const CRAFT = "vessel:abc-123";

const KSC = "ground:Kerbal Space Center";

/**
 * The roster the mod publishes for a save whose crewed craft is a control
 * source with an antenna: exactly the shape `CrewedVesselSource` mints, the home
 * ground station alongside it because every save has one.
 */
const ROSTER = [
  { id: KSC, displayName: "KSC", active: true, isHome: true },
  { id: CRAFT, displayName: "Ares I", active: true },
];

/**
 * Mounts the binding over a real client/store pipeline, with the craft's own
 * source on the orbit PAYLOAD's meta, which already spells the centre id. The
 * envelope's `meta.source` beside it is the Courier node and reads "system"
 * for every non-fleet topic; `emitOrbitFrom` takes it separately so a case can
 * put a real centre id there and prove the binding ignores it.
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
    emitOrbitFrom: (source: string | null, envelopeSource = "system") => {
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
            ...(source === null ? {} : { meta: { source, quality: 0 } }),
          },
          { source: envelopeSource },
        );
        fixture.store.beginFrame();
      });
    },
  };
}

describe("PilotVantage", () => {
  it("moves the session off the ground and onto the craft the pilot is aboard", () => {
    const fixture = mountPilot();
    expect(fixture.client.selectedVantage).toBeUndefined();

    fixture.emitRoster(ROSTER);
    fixture.emitOrbitFrom(CRAFT);

    expect(fixture.client.selectedVantage).toBe(CRAFT);

    fixture.unmount();
  });

  it("keeps the ground vantage for a craft the roster does not carry as an active centre", () => {
    const fixture = mountPilot();

    fixture.emitRoster([
      { id: KSC, displayName: "KSC", active: true, isHome: true },
    ]);
    fixture.emitOrbitFrom(CRAFT);

    // The mod would refuse this id, and a refused request tracked optimistically would leave every reader of `selectedVantage` naming a centre the frames are not from.
    expect(fixture.client.selectedVantage).toBeUndefined();

    fixture.unmount();
  });

  it("names the craft from the orbit sample's own provenance, never the envelope's", () => {
    const fixture = mountPilot();

    fixture.emitRoster(ROSTER);
    fixture.emitOrbitFrom("vessel:xyz-999", CRAFT);

    expect(fixture.client.selectedVantage).toBeUndefined();

    fixture.unmount();
  });

  it("keeps the ground vantage for an orbit sample that names no craft", () => {
    const fixture = mountPilot();

    fixture.emitRoster(ROSTER);
    fixture.emitOrbitFrom(null, CRAFT);

    expect(fixture.client.selectedVantage).toBeUndefined();

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
