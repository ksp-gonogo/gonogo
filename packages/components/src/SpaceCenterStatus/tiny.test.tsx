import { act, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

type Fixture = ReturnType<typeof setupStreamFixture>;

function emitCareer(fixture: Fixture, padOccupied: boolean): void {
  act(() => {
    fixture.emit("spaceCenter.launchSites", [
      { name: "__pad_occupancy__", padOccupied, padVesselTitle: null },
    ]);
    fixture.emit("career.status", {
      balances: { funds: 78400.5, reputation: 200, science: 100 },
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
}

function spoken(): string[] {
  return [...document.querySelectorAll("[aria-live=polite]")]
    .map((r) => r.textContent ?? "")
    .filter((t) => t !== "");
}

describe("SpaceCenterStatus tiny mode", () => {
  it("draws the balance over the pad word at its 3x4 floor, and says the word politely", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("space-center-status", {
      w: 3,
      h: 4,
      wrapper: fixture.Provider,
    });
    emitCareer(fixture, false);

    await waitFor(() => expect(visibleText()).toContain("CLEAR"));
    expect(visibleText()).toContain("78,401");
    expect(document.querySelectorAll("[data-tiny-essential]")).toHaveLength(2);
    expect(spoken()).toEqual(["Pad CLEAR"]);

    emitCareer(fixture, true);
    await waitFor(() => expect(spoken()).toEqual(["Pad ACTIVE"]));
    expect(visibleText()).toContain("ACTIVE");
    await act(async () => {});
  });

  it("marks a held balance rather than blanking it", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("space-center-status", {
      w: 3,
      h: 4,
      wrapper: fixture.Provider,
    });
    emitCareer(fixture, false);
    await waitFor(() => expect(visibleText()).toContain("78,401"));
    expect(document.querySelector("[data-held]")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(document.querySelector("[data-held]")).not.toBeNull(),
    );
    expect(visibleText()).toContain("78,401");
    await act(async () => {});
  });

  it("claims no pad state and no balance before anything has arrived", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("space-center-status", {
      w: 3,
      h: 4,
      wrapper: fixture.Provider,
    });

    await waitFor(() => expect(visibleText()).toContain("KSC"));
    const text = visibleText();
    expect(text).not.toContain("CLEAR");
    expect(text).not.toContain("ACTIVE");
    expect(text.split(NULL_DISPLAY)).toHaveLength(3);
    expect(document.querySelector("[data-held]")).toBeNull();
    expect(spoken()).toEqual([]);
    await act(async () => {});
  });
});
