import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinFlight from "./__fixtures__/kerbin-flight-two-experiments.json";
import { ScienceBenchComponent } from "./index";

/**
 * ScienceBench's stream render golden. This began life as a
 * legacy-`DataSource`↔stream byte-identical dual-run (`sci.experiments`'s
 * `part`-keyed shape compared against `science.experiments`'s `partName`-keyed
 * shape); with the widget now reading its whole state off canonical Topics
 * (`science.experiments`/`science.experimentBreakdown` + the derived
 * `vessel.state`/`vessel.surface`/`career.status` channels), there is no legacy
 * read path left to compare against — same "the legacy leg is gone" story as
 * `ScienceOfficer/dual-run.test.tsx`'s own doc comment. What remains proves the
 * widget renders the full two-experiment career-flight state correctly off the
 * real stream pipeline, using the SAME `kerbin-flight-two-experiments` fixture,
 * with `science.experiments` emitted in its NEW `partName`-keyed wire shape.
 */
describe("ScienceBench — stream render golden (delay=0)", () => {
  it("renders the full experiment/breakdown/career state off the stream pipeline", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "system.bodies",
        "vessel.surface",
        "science.experiments",
        "science.experimentBreakdown",
        "career.status",
        "career.mode",
      ],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sb-dual" }}>
          <ScienceBenchComponent id="sb-dual" w={8} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // body Kerbin + situation Flying (ordinal 5) + biome Water.
      fixture.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0,
        inc: 0,
        argPe: 0,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 1,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", {
        parentBodyIndex: 1,
        situation: 5,
        launchUt: 0,
      });
      fixture.emit("vessel.surface", { biome: "Water" });
      fixture.emit("career.mode", { mode: 1 });
      fixture.emit("career.status", {
        economy: {
          science: kerbinFlight["career.science"],
          funds: kerbinFlight["career.funds"],
          reputation: kerbinFlight["career.reputation"],
        },
      });
      // science.experiments in its NEW partName-keyed wire shape (part -> partName).
      fixture.emit(
        "science.experiments",
        kerbinFlight["sci.experiments"].map((e) => ({
          partName: e.part,
          location: "experiment",
          experimentId: e.subjectId.split("@")[0],
          subjectId: e.subjectId,
          title: e.title,
          dataAmount: e.dataAmount,
        })),
      );
      fixture.emit(
        "science.experimentBreakdown",
        kerbinFlight["sci.experimentBreakdown"],
      );
    });

    await waitFor(() => {
      if (
        !container.textContent?.includes(
          "Temperature Scan from Kerbin's upper atmosphere",
        )
      ) {
        throw new Error("stream leg has not rendered the breakdown yet");
      }
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    // Situation line resolves off the derived vessel.state + vessel.surface.
    expect(screen.getByText(/Flying — Water/i)).toBeInTheDocument();

    // Breakdown view (takes precedence over the plain experiment list) shows
    // both subjects, sorted by remainingPotential desc.
    expect(
      screen.getByText("Temperature Scan from Kerbin's upper atmosphere"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Crew Report from Kerbin's upper atmosphere"),
    ).toBeInTheDocument();

    // Career strip renders (CAREER mode) — labels present.
    const scope = within(container);
    expect(scope.getByText("SCI")).toBeInTheDocument();
    expect(scope.getByText("FUNDS")).toBeInTheDocument();
    expect(scope.getByText("REP")).toBeInTheDocument();
  });
});
