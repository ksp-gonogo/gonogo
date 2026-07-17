import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import valentinaSoloOrbit from "./__fixtures__/valentina-solo-orbit.json";
import { CrewManifestComponent } from "./index";

/**
 * CrewManifest's real recorded-fixture render off the stream.
 *
 * All of CrewManifest's reads are now stream reads — `vessel.crew`
 * (count/capacity/roster, canonical `useTelemetry`) plus the derived
 * `vessel.state.isEVA` (`useStream`). The original version of this test rendered
 * the same crew state once off a legacy `DataSource` (`snapshotWidgetMode`,
 * which mounts no `TelemetryProvider`) and once off the stream and asserted
 * byte-identical DOM; that comparison is no longer possible — the legacy leg
 * now renders nothing but "No crew data" since every read is stream-only. Same
 * cause (full stream migration, not a test bug) as every other widget's
 * `dual-run.test.tsx` dropping its now-impossible legacy leg.
 *
 * What remains, and is still worth its own file: the real `valentina-solo-orbit`
 * fixture (single pilot in a 1-seat Mk1 pod) run genuinely through the stream
 * pipeline.
 */
describe("CrewManifest — real recorded-fixture render off the stream (delay=0)", () => {
  it("renders Valentina's solo-orbit roster and headcount off the stream", async () => {
    const mode = { name: "default-6x8", w: 6, h: 8 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.crew"],
      pinnedUt: 10,
    });

    render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "crew-dual" }}>
          <CrewManifestComponent id="crew-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("vessel.crew", {
        count: valentinaSoloOrbit["v.crewCount"],
        capacity: valentinaSoloOrbit["v.crewCapacity"],
        crew: valentinaSoloOrbit["v.crew"].map((name) => ({ name })),
      });
    });

    await waitFor(() =>
      expect(screen.getByText("1 / 1 aboard")).toBeInTheDocument(),
    );
    expect(screen.getByText("Valentina Kerman")).toBeInTheDocument();
  });
});
