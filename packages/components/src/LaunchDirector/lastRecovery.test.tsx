import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import padCraftParts from "./__fixtures__/pad-craft-parts.json";
import { LaunchDirectorComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

type Emit = { channel: string; value: unknown };
const EMITS = padCraftParts._stream.emits as Emit[];

const SUMMARY = {
  capturedAtUT: 89691.776,
  vesselName: "Mun Lander R",
  recoveryLocation: "LaunchPad",
  recoveryFactor: "",
  scienceEarned: null,
  totalScience: null,
  fundsEarned: null,
  totalFunds: null,
  displayReputation: false,
  scienceBreakdown: [
    {
      subjectId: "crewReport@MunSrfLanded",
      subjectTitle: "Crew Report from the Mun",
      dataGathered: 38,
      scienceAmount: null,
    },
  ],
  partBreakdown: [
    { partName: "fuelTank", partTitle: "FL-T400", count: 3 },
    { partName: "mk1pod", partTitle: "Mk1 Pod", count: 1 },
  ],
  resourceBreakdown: [],
  crewBreakdown: [{ name: "Dunbal Kerman", trait: "Scientist", newLevel: 5 }],
};

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ld-recovery" }}>
        <LaunchDirectorComponent id="ld-recovery" w={14} h={16} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    for (const e of EMITS.filter(
      (e) => !e.channel.startsWith("spaceCenter.craft."),
    )) {
      fixture.emit(e.channel, e.value);
    }
  });
  return fixture;
}

describe("LaunchDirector: the last recovery", () => {
  it("shows nothing until a recovery has been recorded", () => {
    mount();

    expect(document.querySelector("[data-last-recovery]")).toBeNull();
  });

  it("shows the recovery that just happened with what came home", () => {
    const fixture = mount();

    act(() => {
      fixture.emit("recovery.lastSummary", SUMMARY);
      fixture.store.beginFrame();
    });

    const block = document.querySelector("[data-last-recovery]");
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain("Mun Lander R");
    expect(block?.textContent).toContain("LaunchPad");
    expect(block?.textContent).toMatch(/Y\d+ D\d+ \d\d:\d\d:\d\d/);
    expect(block?.textContent).toContain("1 crew · 4 parts");
    expect(block?.textContent).toContain("38");
    expect(screen.getByText(/Last recovery/i)).toBeTruthy();
  });

  it("keeps the figures apart, with the science data named", () => {
    const fixture = mount();

    act(() => {
      fixture.emit("recovery.lastSummary", {
        ...SUMMARY,
        fundsEarned: 3966,
        scienceEarned: 5,
        scienceBreakdown: [{ ...SUMMARY.scienceBreakdown[0], dataGathered: 1 }],
      });
      fixture.store.beginFrame();
    });

    const figures = document.querySelector(
      "[data-last-recovery] > div:last-child",
    );
    // Read as text, as a copy or a screen reader gets it: every figure apart and the data named.
    expect(figures?.textContent?.replace(/[\u00a0\u2009]/g, " ")).toBe(
      "1 crew · 4 parts · 1.0 mits of data · 3,966f funds · 5.0 science",
    );
  });
});
