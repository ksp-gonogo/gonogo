import { WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ContributionsPanelStore } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewStatusComponent } from "./index";

/** EVA suit meters stay drawn, marked, when `vessel.resources` stops arriving: those two figures decide whether a kerbal can get back inside. */

const VESSEL_TYPE_EVA = 7;

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mountEva() {
  const fixture = setupStreamFixture({
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
    // The control: without it every assertion below would pass on a widget that never drew a meter.
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

    await waitFor(() =>
      expect(screen.getByRole("meter", { name: "O2" })).toHaveAttribute(
        "aria-valuenow",
        "25",
      ),
    );
    expect(screen.getByRole("meter", { name: "EC" })).toBeInTheDocument();
  });

  it("no longer states its own staleness in words", async () => {
    // Each meter already carries the stale mark, so prose would say it twice.
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
