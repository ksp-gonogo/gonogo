import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ScienceDataComponent } from "./index";

/**
 * Proves the ledgers and banked balance keep their last value when reads stop being current, while the locale is withheld and names itself.
 * An omitted locale would read like a vessel that never reported a biome.
 */

describe("ScienceData when its reads are held", () => {
  let stream: StreamFixture;

  beforeEach(() => {
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderData() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sci-stale" }}>
          <ScienceDataComponent config={{}} id="sci-stale" w={8} h={10} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** A landed Mun vessel with one record aboard, an archive, and banked science. */
  function emitLandedWithScience(): void {
    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: "Mun",
            index: 2,
            parentIndex: 0,
            radius: 200_000,
            orbit: null,
          },
        ],
      });
      stream.emit("vessel.identity", {
        parentBodyIndex: 2,
        situation: 0,
        launchUt: 0,
      });
      stream.emit("vessel.surface", { landedAt: "Northwest Crater" });
      stream.emit("science.experiments", [
        {
          subjectId: "crewReport@MunSrfLandedNorthwestCrater",
          title: "Crew Report",
          dataAmount: 5,
        },
      ]);
      stream.emit("science.archive", [
        {
          subjectId: "crewReport@MunSrfLandedNorthwestCrater",
          experimentId: "crewReport",
          experimentTitle: "Crew Report",
          body: "Mun",
          situation: "SrfLanded",
          biome: "Northwest Crater",
        },
      ]);
      stream.emit("spaceCenter.scene", { scene: "Flight" });
      stream.emit("career.mode", { mode: 1 });
      stream.emit("career.status", { balances: { science: 1234 } });
    });
  }

  function goHeld(): void {
    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });
  }

  it("names the locale on the situation line while the surface read is current", async () => {
    // The control: without it the assertions below would pass on a widget that never renders a locale.
    const { container } = renderData();
    emitLandedWithScience();

    await waitFor(() =>
      expect(visibleText(container)).toContain(
        "Mun · Landed · Northwest Crater",
      ),
    );
  });

  it("withholds the locale and says why, rather than shortening the line in silence", async () => {
    const { container } = renderData();
    emitLandedWithScience();
    await waitFor(() =>
      expect(visibleText(container)).toContain("Northwest Crater"),
    );

    goHeld();

    await waitFor(() =>
      expect(visibleText(container)).toContain("Mun · Landed · locale held"),
    );
    // The biome is gone, not merely captioned.
    expect(visibleText(container)).not.toContain("Landed · Northwest Crater");
  });

  it("keeps the records aboard, because a ledger cannot change unobserved", async () => {
    const { container } = renderData();
    emitLandedWithScience();
    await waitFor(() =>
      expect(screen.getByText("Crew Report")).toBeInTheDocument(),
    );

    goHeld();

    await waitFor(() =>
      expect(visibleText(container)).toContain("locale held"),
    );
    expect(screen.getByText("Crew Report")).toBeInTheDocument();
    expect(visibleText(container)).not.toContain("No science data aboard");
    expect(visibleText(container)).toContain("1234");
  });

  it("does not turn a dropped link into a Sandbox save on the Archive tab", async () => {
    renderData();
    emitLandedWithScience();
    await waitFor(() =>
      expect(screen.getByText("Crew Report")).toBeInTheDocument(),
    );

    goHeld();
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));

    await waitFor(() =>
      expect(visibleText()).not.toContain("No R&D archive in this save"),
    );
    expect(visibleText()).not.toContain("No science collected yet this career");
  });

  it("says nothing about currency before anything has ever arrived", async () => {
    // A cold start is not a withheld locale.
    const { container } = renderData();
    await waitFor(() =>
      expect(visibleText(container)).toContain("Awaiting situation telemetry"),
    );
  });
});
