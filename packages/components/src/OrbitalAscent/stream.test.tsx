import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalAscentComponent } from "./index";

/** Proves the parent-body name resolves off the real stream pipeline, with no DataSource registered. */
describe("OrbitalAscent: v.body genuinely runs off the stream (R6)", () => {
  it("resolves the streamed parent-body name off the real pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.flight", "vessel.identity", "system.bodies"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ascent-stream" }}>
          <OrbitalAscentComponent id="ascent-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(visibleText(container)).toContain("ORBITAL ASCENT");
    expect(container.textContent).not.toContain("No reference data");

    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);

    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Gargantua",
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 1, launchUt: 0 });
    });

    // A radius with no gravitational parameter resolves the body but not its reference curve.
    await waitFor(() => {
      if (!visibleText(container).includes("No reference data")) {
        throw new Error("streamed body name has not resolved yet");
      }
    });
    expect(visibleText(container)).toContain("Gargantua");
  });
});
