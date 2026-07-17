import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StaffRosterComponent } from "./index";

// Unmount each rendered tree BEFORE clearing the action-handler registry —
// clearActionHandlers() firing on a still-mounted widget is a state update
// outside act(). RTL auto-cleanup runs after this file's afterEach, too late
// to unmount first.
const renderedTrees: Array<() => void> = [];

/**
 * StaffRoster stream test-adapter proof: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`. `kc.crewRoster` is mapped onto `spaceCenter.crewRoster`
 * (map-topic.ts) — a whole-topic bare-array read, same "key == topic" shape
 * as `parts.robotics`/`science.lab`. `parseStaff`'s expanded fields
 * (veteran/isBadass/careerFlights/courage/stupidity/currentVesselName) have
 * no mod-side equivalent yet and default to their safe zero/false values,
 * same as they already do for an older Telemachus DLL that never emitted
 * them.
 */
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("StaffRoster — genuinely runs off the stream", () => {
  it("renders the roster from spaceCenter.crewRoster's bare array", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["spaceCenter.crewRoster"],
      pinnedUt: 10,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sr-stream" }}>
          <StaffRosterComponent id="sr-stream" w={5} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    expect(fixture.transport.isSubscribed("spaceCenter.crewRoster")).toBe(true);

    act(() => {
      fixture.emit("spaceCenter.crewRoster", [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          experienceLevel: 3,
          available: true,
          unavailableReason: "",
        },
        {
          name: "Bill Kerman",
          trait: "Engineer",
          experienceLevel: 1,
          available: false,
          unavailableReason: "Assigned",
        },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeTruthy(),
    );
    expect(screen.getByText("Bill Kerman")).toBeTruthy();
    expect(screen.getByText("1/2 available")).toBeTruthy();
  });
});
