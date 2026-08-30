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
 * What ScienceData does when its reads stop being current.
 *
 * The split here is between a ledger and a position. The science aboard, the
 * per-subject breakdown, the R&D archive and the banked balance all move on
 * events (a crew runs an experiment, a capsule is recovered, a node is bought),
 * and no event reaches us down a link that is not delivering, so all four keep
 * their last value. The locale does not: it names the biome a sample would come
 * from, and a vessel that is flying crosses biomes with nobody touching
 * anything, so a held locale would attribute the science on screen to the wrong
 * place.
 *
 * The assertion that earns this file is the locale's replacement wording. An
 * omitted locale is also what a vessel that never reported a biome shows, and
 * those two say opposite things about the records listed under the line.
 */

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
] as const;

const CARRIED = [
  ...VESSEL_STATE_INPUTS,
  "vessel.surface",
  "science.experiments",
  "science.experimentBreakdown",
  "science.archive",
  "career.status",
  "career.mode",
  // Emitting career.mode gives the widget a game signal, and without a scene to
  // go with it `useGameContext` reads "not in flight" and turns the Aboard tab
  // off. The locale line lives on that tab.
  "spaceCenter.scene",
] as const;

describe("ScienceData when its reads are no longer current", () => {
  let stream: StreamFixture;

  beforeEach(() => {
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
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
      stream.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0,
        inc: 0,
        argPe: 0,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 2,
      });
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
      stream.emit("career.status", { economy: { science: 1234 } });
    });
  }

  function goNotCurrent(): void {
    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });
  }

  it("names the locale on the situation line while the surface read is current", async () => {
    // The control. Without it every assertion below would also pass on a widget
    // that never renders a locale.
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

    goNotCurrent();

    await waitFor(() =>
      expect(visibleText(container)).toContain(
        "Mun · Landed · locale no longer current",
      ),
    );
    // The biome itself is gone from the line, not merely captioned: an operator
    // reading "Northwest Crater" would take the records below it as sampled
    // there.
    expect(visibleText(container)).not.toContain("Landed · Northwest Crater");
  });

  it("keeps the records aboard, because a ledger cannot change unobserved", async () => {
    const { container } = renderData();
    emitLandedWithScience();
    await waitFor(() =>
      expect(screen.getByText("Crew Report")).toBeInTheDocument(),
    );

    goNotCurrent();

    await waitFor(() =>
      expect(visibleText(container)).toContain("locale no longer current"),
    );
    // Blanking these would report an empty vessel, which is a statement about
    // the craft rather than about the link.
    expect(screen.getByText("Crew Report")).toBeInTheDocument();
    expect(visibleText(container)).not.toContain("No science data aboard");
    expect(visibleText(container)).toContain("1234");
  });

  it("does not turn a dropped link into a Sandbox save on the Archive tab", async () => {
    // The archive's absence gate says "No R&D archive in this save", a claim
    // about the save file. Reaching it from a stale read would tell a career
    // player they are in Sandbox.
    renderData();
    emitLandedWithScience();
    await waitFor(() =>
      expect(screen.getByText("Crew Report")).toBeInTheDocument(),
    );

    goNotCurrent();
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));

    await waitFor(() =>
      expect(visibleText()).not.toContain("No R&D archive in this save"),
    );
    expect(visibleText()).not.toContain("No science collected yet this career");
  });

  it("says nothing about currency before anything has ever arrived", async () => {
    // A cold start is not a withheld locale. Conflating them would accuse the
    // link of dropping on first paint.
    const { container } = renderData();
    await waitFor(() =>
      expect(visibleText(container)).toContain("Awaiting situation telemetry"),
    );
    expect(visibleText(container)).not.toContain("no longer current");
  });
});
