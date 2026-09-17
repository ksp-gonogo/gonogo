import { WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ContributionsPanelStore } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewStatusComponent } from "./index";

/**
 * What the EVA suit meters do when `vessel.resources` stops arriving.
 *
 * `EvaSuitReadout` used to return early and replace both meters with the
 * sentence "Suit resources no longer current". The comment justifying it said a
 * held reading "is exactly the case where nothing was drawn", and the code in
 * the same file contradicted it: `suitTank` takes both halves as FIELD
 * READINGS, so `amount` and `capacity` are populated on a stale reading and
 * carry the currency they were read with.
 *
 * So both meters draw, marked. The two figures in question are the ones that
 * decide whether a kerbal outside the craft has time to get back in, which is
 * the worst possible pair to discard the moment the link goes.
 */

const ORBIT = {
  eccentricity: 0.001,
  semiMajorAxis: 700000,
  inclination: 0,
  lan: 0,
  argPe: 12.5,
  mu: 3.5316e12,
  meanAnomalyAtEpoch: 0,
  epoch: 10,
  referenceBodyIndex: 1,
};
const VESSEL_TYPE_EVA = 7;

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mountEva() {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "vessel.crew",
      "vessel.state",
      "vessel.identity",
      "vessel.orbit",
      "vessel.resources",
    ],
    pinnedUt: 10,
  });
  const { unmount } = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "crew-status", contributionSlots: [] }}
      >
        <ContributionsPanelStore.Provider>
          <CrewStatusComponent config={{}} id="crew-stale" />
        </ContributionsPanelStore.Provider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);

  act(() => {
    fixture.emit("vessel.crew", {
      count: 1,
      capacity: 1,
      crew: [{ name: "Jebediah Kerman" }],
    });
    fixture.emit("vessel.orbit", ORBIT);
    fixture.emit("vessel.identity", { vesselType: VESSEL_TYPE_EVA });
    fixture.emit("vessel.resources", {
      resources: {
        Oxygen: { current: 3, max: 12 },
        ElectricCharge: { current: 6, max: 33 },
      },
    });
  });
  return fixture;
}

describe("CrewStatus: EVA suit resources that have stopped arriving", () => {
  it("draws both suit meters while the readings are current", async () => {
    // The control. Without it every assertion below would also pass on a
    // widget that never drew a suit meter at all.
    mountEva();

    await waitFor(() => expect(screen.getByText("O2")).toBeInTheDocument());
    expect(screen.getByRole("meter", { name: "O2" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(screen.getByText("EC")).toBeInTheDocument();
  });

  it("keeps both meters, with their figures, once the link drops", async () => {
    const fixture = mountEva();
    await waitFor(() => expect(screen.getByText("O2")).toBeInTheDocument());

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    /* The meters survive the drop and keep their fractions. The old early
       return replaced both with a sentence, so an operator on EVA lost the two
       figures that decide whether their kerbal can get back inside. */
    await waitFor(() =>
      expect(screen.getByRole("meter", { name: "O2" })).toHaveAttribute(
        "aria-valuenow",
        "25",
      ),
    );
    expect(screen.getByRole("meter", { name: "EC" })).toBeInTheDocument();
  });

  it("no longer states its own staleness in words", async () => {
    /* The sentence goes because each meter already carries the mark. Saying it
       again in prose over marked figures says it twice, and the ruling this
       widget was changed under is that a widget defaulting to "can't show this
       now" is the stale style. */
    const fixture = mountEva();
    await waitFor(() => expect(screen.getByText("O2")).toBeInTheDocument());

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(screen.getByRole("meter", { name: "O2" })).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Suit resources no longer current/),
    ).not.toBeInTheDocument();
  });
});
