import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AstronautComplexComponent } from "./index";

/**
 * When telemetry stops being current, the rosters, counts and hire price are
 * held (facts only an event changes), and the funds balance is withheld with a
 * stated reason, distinct from a balance that never arrived.
 */

const CARRIED = [
  "spaceCenter.astronautComplex",
  "spaceCenter.crewRoster",
  "career.status",
  "career.crew.hire",
  "career.crew.fire",
];

const APPLICANT = {
  name: "Desdin Kerman",
  trait: "Scientist",
  experienceLevel: 0,
  courage: 0.65,
  stupidity: 0.2,
};

const CREW = [
  {
    name: "Jebediah Kerman",
    trait: "Pilot",
    experienceLevel: 3,
    situation: "Available",
    situationOrdinal: 0,
    available: true,
  },
];

describe("AstronautComplex when its telemetry is no longer current", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ac-stale" }}>
          <AstronautComplexComponent config={{}} id="ac-stale" w={6} h={8} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emitCareer(): void {
    act(() => {
      stream.emit("career.status", { economy: { funds: 500000 } });
      stream.emit("spaceCenter.astronautComplex", {
        applicants: [APPLICANT],
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: 24000,
      });
      stream.emit("spaceCenter.crewRoster", CREW);
    });
  }

  function dropTheLink(): void {
    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });
  }

  it("shows the balance while it is current", async () => {
    // The control: without it the assertions below would pass on a widget that never draws a balance.
    const { container } = renderWidget();
    emitCareer();

    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );
    expect(screen.getByText("Funds").nextElementSibling).not.toHaveTextContent(
      NULL_DISPLAY,
    );
    expect(visibleText(container)).not.toContain("Funds no longer current");
  });

  it("withholds the balance and SAYS why, rather than leaving a bare em dash", async () => {
    const { container } = renderWidget();
    emitCareer();
    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );

    dropTheLink();

    await waitFor(() =>
      expect(visibleText(container)).toContain("Funds no longer current"),
    );
    // Withheld, not held: the last balance must not stay on screen as the figure about to be spent from.
    expect(screen.getByText("Funds").nextElementSibling).toHaveTextContent(
      NULL_DISPLAY,
    );
    expect(visibleText(container)).not.toContain("500,000");
  });

  it("says nothing about a stale balance before one has ever arrived", async () => {
    // A cold start is not a dropped link.
    const { container } = renderWidget();

    await waitFor(() =>
      expect(visibleText(container)).toContain("waiting for telemetry"),
    );
    expect(visibleText(container)).not.toContain("Funds no longer current");
  });

  it("keeps the rosters, the cap and the quoted hire price on screen", async () => {
    // Withholding these facts would report a Complex with no candidates and a corps with no crew.
    const { container } = renderWidget();
    emitCareer();
    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );

    dropTheLink();

    await waitFor(() =>
      expect(visibleText(container)).toContain("Funds no longer current"),
    );
    expect(screen.getByText("Desdin Kerman")).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 13/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Applicants" })).toBeInTheDocument();

    const activeTab = screen.getByRole("tab", { name: "Active" });
    act(() => {
      activeTab.click();
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(visibleText(container)).not.toContain("No active crew");
  });

  it("does not present a stale Complex as a save with no space programme", async () => {
    // "career mode only" is a statement about the save, never reached from a dropped link.
    const { container } = renderWidget();
    emitCareer();
    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );

    dropTheLink();

    await waitFor(() =>
      expect(visibleText(container)).toContain("Funds no longer current"),
    );
    expect(visibleText(container)).not.toContain("career mode only");
  });
});
