import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AstronautComplexComponent } from "./index";

/**
 * When telemetry stops being current, the rosters, counts and hire price are
 * held (facts only an event changes), and the funds balance stays on screen
 * marked by its Unit, withheld from the affordability verdict, distinct from a
 * balance that never arrived.
 */

const HELD_FUNDS_TITLE = "Affordability is not judged against a held balance";

/** The held balance's spoken staleness, which carries the grade and the instant it was read. */
function heldFundsMark(): string | null {
  const readout = screen.queryByTitle(HELD_FUNDS_TITLE);
  return readout?.querySelector("[data-unit-currency]")?.textContent ?? null;
}

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

describe("AstronautComplex when its telemetry is held", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
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
    expect(screen.queryByTitle(HELD_FUNDS_TITLE)).toBeNull();
    expect(visibleText(container)).toContain("500,000");
  });

  it("keeps the held balance on screen, marked by its Unit, and says affordability is not judged against it", async () => {
    const { container } = renderWidget();
    emitCareer();
    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );

    dropTheLink();

    await waitFor(() => expect(heldFundsMark()).toMatch(/as of /));
    expect(visibleText(container)).toContain("500,000");
    // The game arbitrates the purchase, so a held balance never refuses a hire.
    expect(
      screen.getByRole("button", { name: /^Hire Desdin Kerman/ }),
    ).toBeEnabled();
  });

  it("says nothing about a stale balance before one has ever arrived", async () => {
    // A cold start is not a dropped link.
    const { container } = renderWidget();

    await waitFor(() =>
      expect(visibleText(container)).toContain("waiting for telemetry"),
    );
    expect(screen.queryByTitle(HELD_FUNDS_TITLE)).toBeNull();
    expect(screen.getByText("Funds").nextElementSibling).toHaveTextContent(
      NULL_DISPLAY,
    );
  });

  it("keeps the rosters, the cap and the quoted hire price on screen", async () => {
    // Withholding these facts would report a Complex with no candidates and a corps with no crew.
    const { container } = renderWidget();
    emitCareer();
    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );

    dropTheLink();

    await waitFor(() => expect(heldFundsMark()).not.toBeNull());
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

  it("marks the held hire price as a held figure, not a current one", async () => {
    renderWidget();
    emitCareer();
    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );
    const hire = () => screen.getByText("Next Hire").nextElementSibling;
    expect(hire()?.querySelector("[data-held]")).toBeNull();

    dropTheLink();

    await waitFor(() =>
      expect(hire()?.querySelector("[data-held]")).not.toBeNull(),
    );
    expect(hire()).toHaveTextContent("24,000");
  });

  it("does not present a stale Complex as a save with no space programme", async () => {
    // "career mode only" is a statement about the save, never reached from a dropped link.
    const { container } = renderWidget();
    emitCareer();
    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );

    dropTheLink();

    await waitFor(() => expect(heldFundsMark()).not.toBeNull());
    expect(visibleText(container)).not.toContain("career mode only");
  });
});
