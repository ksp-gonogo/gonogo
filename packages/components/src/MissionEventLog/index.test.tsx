import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MissionEventLogComponent } from "./index";

/**
 * Integration test: a real TelemetryProvider/stream feeds the widget via
 * `fixture.emit`; the widget accumulates events off the live topics. Covers a
 * Tier-A discrete event (launch, crash), the empty state, and a Tier-B
 * value-edge event (staging), so both derivation families are exercised
 * end-to-end through the accumulator hook.
 */

const trees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    carriedChannels: [
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
    ],
    pinnedUt: 1000,
    suspendFrames: true,
  });
}

function renderLog(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <MissionEventLogComponent config={{}} id="log" />
    </fixture.Provider>,
  );
  trees.push(unmount);
}

afterEach(() => {
  for (const u of trees) u();
  trees.length = 0;
});

describe("MissionEventLogComponent", () => {
  it("shows the empty state before any event arrives", () => {
    renderLog(newFixture());
    expect(screen.getByText("MISSION LOG")).toBeInTheDocument();
    expect(screen.getByText(/No mission events yet/i)).toBeInTheDocument();
  });

  it("logs a launch event from flight.started", async () => {
    const fixture = newFixture();
    renderLog(fixture);
    act(() => {
      fixture.emit("vessel.identity", {
        vesselType: 0,
        launchUt: 900,
      });
      fixture.emit("flight.started", { ut: 900, vesselName: "Mun Tester" });
    });
    // A row is no longer one text node: the stamp renders through
    // <Countdown>, which splits the number from its symbol. The MET stamp is
    // relative to launchUt (T+…), a delay-honest happened-at time, and it is
    // the row's OWN text rather than an aria-label that would override it.
    await waitFor(() =>
      expect(visibleText()).toMatch(/T\+.* · Launched Mun Tester/),
    );
  });

  it("logs a crash event from crash.lastCrash", async () => {
    const fixture = newFixture();
    renderLog(fixture);
    act(() => {
      fixture.emit("crash.lastCrash", {
        ut: 1200,
        vesselName: "Booster",
        cause: "impact",
      });
    });
    await waitFor(() => expect(visibleText()).toMatch(/Booster crashed/));
  });

  it("logs a staging event from a vessel.structure stage-count edge", async () => {
    const fixture = newFixture();
    renderLog(fixture);
    // Wait for the widget's subscription so the seed sample isn't dropped
    // (StubTransport.emit is subscription-gated). Then seed prev=3, then the
    // decrease is the 3->2 edge; async act flushes each sample's effect.
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("vessel.structure")).toBe(true),
    );
    await act(async () => {
      fixture.emit("vessel.structure", { currentStage: 3 });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      fixture.emit("vessel.structure", { currentStage: 2 });
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() =>
      expect(screen.getByText(/Staged \(stage 2\)/)).toBeInTheDocument(),
    );
  });
});
