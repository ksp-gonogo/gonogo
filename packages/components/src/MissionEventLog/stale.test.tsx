import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { MissionEventLogComponent } from "./index";

/**
 * What the Mission Log does when the stream stops being current.
 *
 * The decision is the opposite of a widget that withholds, and it is a decision
 * rather than an oversight, which is why it is asserted from outside the
 * component. A log is a record of what HAPPENED. "Booster crashed at T+300" does
 * not stop being true because the link went quiet at T+400, and a log that blanks
 * itself on a stream hiccup deletes the one account of the event the operator is
 * now trying to reason about. So every read here is held, not withheld.
 *
 * The two things a held read must not do are also pinned: it must not reformat
 * the history (the launch time is held too, so rows keep their mission-elapsed
 * stamp), and re-feeding a held value to the Tier-B edge detectors every frame
 * must not manufacture an edge out of a value that has not moved.
 */

const CARRIED = [
  "flight.started",
  "flight.ended",
  "flight.vesselChanged",
  "crash.lastCrash",
  "recovery.lastSummary",
  "vessel.structure",
  "vessel.orbit",
  "vessel.dock",
  "vessel.identity",
  "career.status",
];

const trees: Array<() => void> = [];

function renderLog(): StreamFixture {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1000,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <MissionEventLogComponent config={{}} id="log-stale" />
    </fixture.Provider>,
  );
  trees.push(unmount);
  return fixture;
}

/** A launched vessel with one logged crash, and a known stage count. */
function emitMission(fixture: StreamFixture): void {
  act(() => {
    fixture.emit("vessel.identity", { vesselType: 0, launchUt: 900 });
    fixture.emit("flight.started", { ut: 900, vesselName: "Mun Tester" });
    fixture.emit("vessel.structure", { currentStage: 3, stageCount: 4 });
    fixture.store.beginFrame();
  });
}

function goStale(fixture: StreamFixture): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

afterEach(() => {
  for (const unmount of trees) unmount();
  trees.length = 0;
});

describe("MissionEventLog when its readings are no longer current", () => {
  it("logs the launch while the stream is current", async () => {
    // The control. Without it every assertion below would also pass on a widget
    // that never logged anything in the first place.
    const fixture = renderLog();
    emitMission(fixture);
    await waitFor(() =>
      expect(visibleText()).toMatch(/T\+.* · Launched Mun Tester/),
    );
  });

  it("keeps the history it has already logged rather than blanking to the empty state", async () => {
    const fixture = renderLog();
    emitMission(fixture);
    await waitFor(() => expect(visibleText()).toContain("Launched Mun Tester"));

    goStale(fixture);

    // "No mission events yet" is a statement about a mission where nothing has
    // happened, and reaching it from a dropped link would report a quiet mission
    // over the top of a launch the operator watched.
    expect(screen.queryByText("No mission events yet")).not.toBeInTheDocument();
    expect(visibleText()).toContain("Launched Mun Tester");
    expect(visibleText()).toContain("1 events");
  });

  it("keeps stamping the history from the held launch time", async () => {
    const fixture = renderLog();
    emitMission(fixture);
    await waitFor(() => expect(visibleText()).toContain("T+"));

    goStale(fixture);

    // A launch instant cannot drift, so withholding it would swap every row from
    // a mission-elapsed clock to a raw UT mid-mission: the same history, silently
    // re-expressed in another quantity, on nothing but a stream hiccup.
    expect(visibleText()).toContain("T+");
    expect(visibleText()).not.toContain("UT ");
  });

  it("manufactures no new event out of a held value", async () => {
    const fixture = renderLog();
    emitMission(fixture);
    await waitFor(() => expect(visibleText()).toContain("Launched Mun Tester"));
    expect(screen.queryByText("STAGE")).not.toBeInTheDocument();

    goStale(fixture);

    // The Tier-B detectors are fed the held stage count on every frame after the
    // link drops. A held value has not moved, so there is no edge, and the log
    // must not grow while nothing is arriving.
    expect(screen.queryByText("STAGE")).not.toBeInTheDocument();
    expect(visibleText()).toContain("1 events");
  });
});
