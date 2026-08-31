import {
  ContributionsProvider,
  clearContributions,
  DashboardItemContext,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MissionEventLogComponent } from "./index";
import type { MissionLogSourceEntry } from "./sources";

/**
 * The `mission-event-log.sources` slot, exercised through a real registration
 * and the real per-frame aggregation, because the thing worth proving is that a
 * source registered the way an Uplink registers one arrives on screen.
 *
 * The pure half (ordering, dedupe, which sentence each state earns) is in
 * `sources.test.ts`; these tests are about the three states being visibly
 * different from each other in the rendered widget.
 */

const META = {
  componentId: "mission-event-log",
  contributionSlots: ["mission-event-log.sources"] as const,
};

const trees: Array<() => void> = [];

function renderLog() {
  const stream = setupStreamFixture({
    carriedChannels: [
      "flight.started",
      "vessel.identity",
      "vessel.dock",
      "career.status",
    ],
    pinnedUt: 1000,
    suspendFrames: true,
  });
  const result = render(
    <stream.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <DashboardItemContext.Provider value={{ instanceId: "log" }}>
            <MissionEventLogComponent config={{}} id="log" />
          </DashboardItemContext.Provider>
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </stream.Provider>,
  );
  trees.push(result.unmount);
  return { stream, ...result };
}

function contribute(
  id: string,
  entry: MissionLogSourceEntry,
  requires?: string,
) {
  const entries = [entry];
  registerContribution({
    id,
    contributes: "mission-event-log.sources",
    requires,
    compute: () => entries,
  });
}

afterEach(() => {
  for (const unmount of trees) unmount();
  trees.length = 0;
  clearContributions();
});

describe("MissionEventLog: the source contribution slot", () => {
  it("reads exactly as it always did while nobody contributes a source", async () => {
    renderLog();
    expect(await screen.findByText(/No mission events yet/i)).toBeTruthy();
    // Nothing about sources on screen at all: an app with no career Uplink
    // installed should not learn that the concept exists.
    expect(visibleText()).not.toMatch(/recording|no data received/i);
  });

  it("says a recording source is watching, rather than leaving it as no events", async () => {
    contribute("test-quiet", {
      id: "career",
      label: "Career log",
      state: "recording",
      events: [],
    });
    renderLog();
    await waitFor(() =>
      expect(visibleText()).toMatch(/Career log: recording, nothing yet/),
    );
  });

  it("says a switched-off source is not recording, and never that nothing happened", async () => {
    contribute("test-off", {
      id: "career",
      label: "Career log",
      state: "not-recording",
      stateReason: "logging is off in this save",
    });
    renderLog();
    await waitFor(() =>
      expect(visibleText()).toMatch(
        /Career log: not recording \(logging is off in this save\)/,
      ),
    );
    expect(visibleText()).not.toMatch(/recording, nothing yet/);
  });

  it("says an unread source has sent nothing, which is not the same as an empty log", async () => {
    contribute("test-unread", {
      id: "career",
      label: "Career log",
      state: "unreadable",
    });
    renderLog();
    await waitFor(() =>
      expect(visibleText()).toMatch(/Career log: no data received/),
    );
    expect(visibleText()).not.toMatch(/recording, nothing yet/);
  });

  it("draws a contributed row on the timeline beside the widget's own", async () => {
    contribute("test-rows", {
      id: "career",
      label: "Career log",
      state: "recording",
      events: [
        {
          id: "failure",
          ut: 950,
          label: "Engine failed",
          detail: "AJ10-37",
          kindLabel: "failure",
          severity: "critical",
        },
      ],
    });
    const { stream } = renderLog();
    act(() => {
      stream.emit("vessel.identity", { vesselType: 0, launchUt: 900 });
      stream.emit("flight.started", { ut: 900, vesselName: "Mun Tester" });
    });
    await waitFor(() => expect(visibleText()).toMatch(/Launched Mun Tester/));
    expect(visibleText()).toMatch(/FAILURE/);
    expect(visibleText()).toMatch(/Engine failed · AJ10-37/);
    // Two rows, and the count is the merged count rather than the widget's own.
    expect(visibleText()).toMatch(/2 events/);
  });

  it("marks two rows of the same flight with their shared group", async () => {
    contribute("test-group", {
      id: "career",
      label: "Career log",
      state: "recording",
      events: [
        { id: "launch", ut: 940, label: "Launched", groupId: "L-17" },
        { id: "failure", ut: 950, label: "Engine failed", groupId: "L-17" },
      ],
    });
    renderLog();
    await waitFor(() => expect(screen.getAllByText("⟨L-17⟩")).toHaveLength(2));
  });

  /**
   * A contribution gated on an absent Domain is skipped by the aggregation
   * before `compute` runs, so the widget sees no source at all and correctly
   * says nothing.
   *
   * This is deliberate and must stay: an Uplink whose mod is not running has
   * not failed to read its log, it is not there, and inventing an `unreadable`
   * source for it would put a permanent "no data received" line on the log of
   * every career that has never installed that mod. Absent is a different
   * sentence from unreadable, and the Domain gate is where the difference is
   * decided.
   */
  it("stays silent about a source whose Domain is absent, rather than calling it unreadable", async () => {
    contribute(
      "test-gated",
      {
        id: "career",
        label: "Career log",
        state: "unreadable",
      },
      "some-absent-mod",
    );
    renderLog();
    expect(await screen.findByText(/No mission events yet/i)).toBeTruthy();
    expect(visibleText()).not.toMatch(/no data received/i);
  });
});
