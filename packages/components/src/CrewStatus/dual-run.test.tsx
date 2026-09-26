import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import valentinaSoloOrbit from "./__fixtures__/valentina-solo-orbit.json";
import { CrewStatusComponent } from "./index";

/**
 * CrewStatus's real recorded-fixture render off the stream.
 *
 * Every CrewStatus read is a stream read: `vessel.crew` (count/capacity/roster)
 * plus `vessel.identity.vesselType` for the EVA flag. This file runs the real
 * `valentina-solo-orbit` fixture (single pilot in a 1-seat Mk1 pod) through
 * the stream pipeline.
 */
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

    // The "1 / 1 aboard" headcount now lives on the info-tone
    // `crew-status.badges` panel-badge contribution (`./badge.ts`), which
    // this bare-component render (no `Panel` badge chrome) never mounts.
    await waitFor(() =>
      expect(screen.getByText("Valentina Kerman")).toBeInTheDocument(),
    );
  });
});
