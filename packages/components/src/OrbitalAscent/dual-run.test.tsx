import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalAscentComponent } from "./index";

// No bundled table carries this body, so its "No reference data" notice can only come from the stream.
const UNTABLED_BODY = "Gargantua";

describe("OrbitalAscent: stream render golden (delay=0)", () => {
  it("renders the ascent state off the stream with the parent body streamed", async () => {
    const streamFixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    registerStockBodies();

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ascent-dual" }}>
          <OrbitalAscentComponent id="ascent-dual" w={10} h={8} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("system.bodies", {
        bodies: [
          {
            name: UNTABLED_BODY,
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      streamFixture.emit("vessel.identity", {
        parentBodyIndex: 1,
        launchUt: 0,
      });
    });

    await waitFor(() => {
      if (!visibleText(container).includes("No reference data")) {
        throw new Error("the parent body has not resolved yet");
      }
    });
    expect(visibleText(container)).toContain("ORBITAL ASCENT");
    expect(visibleText(container)).toContain(UNTABLED_BODY);
  });
});
