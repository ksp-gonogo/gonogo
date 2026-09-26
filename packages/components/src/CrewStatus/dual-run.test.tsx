import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import valentinaSoloOrbit from "./__fixtures__/valentina-solo-orbit.json";
import { CrewStatusComponent } from "./index";

/** Renders the recorded valentina-solo-orbit fixture (one pilot, 1-seat pod) through the stream. */
describe("CrewStatus, real recorded-fixture render off the stream (delay=0)", () => {
  it("renders Valentina's solo-orbit roster and headcount off the stream", async () => {
    const mode = { name: "default-6x8", w: 6, h: 8 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.crew"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "crew-dual" }}>
          <CrewStatusComponent id="crew-dual" w={mode.w} h={mode.h} />
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

    // The headcount is a panel badge, which a bare-component render never mounts.
    await waitFor(() =>
      expect(screen.getByText("Valentina Kerman")).toBeInTheDocument(),
    );
  });
});
