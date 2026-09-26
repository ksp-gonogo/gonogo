import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalAscentComponent } from "./index";

/**
 * OrbitalAscent's stream render golden. `v.body` is
 * `vessel.identity.parentBodyIndex` named against `system.bodies`, with NO
 * legacy fallback at all (see `stream.test.tsx`). This proves the widget
 * renders off the real stream pipeline for an ascent state. The two plotted
 * series ride `vessel.flight`, which this file does not emit.
 *
 * A body no static table carries ("Gargantua") is streamed so the body's
 * presence is race-safely observable: the "No reference data" notice appears
 * only if `v.body` actually streamed, so waiting on it can't false-green on an
 * empty stream. The roster reports a radius for Gargantua and only the
 * gravitational parameter is missing, so the body IS known and its reference
 * curve is not.
 */
// A body name no bundled table carries, driving the "No reference data" notice.
const UNTABLED_BODY = "Gargantua";

describe("OrbitalAscent: stream render golden (delay=0)", () => {
  it("renders the ascent state off the stream with v.body streamed", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.flight", "vessel.identity", "system.bodies"],
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

    // The notice is produced ONLY by the streamed v.body, so this can't
    // false-green on an empty stream.
    await waitFor(() => {
      if (!visibleText(container).includes("No reference data")) {
        throw new Error("stream leg has not resolved v.body yet");
      }
    });
    expect(visibleText(container)).toContain("ORBITAL ASCENT");
    expect(visibleText(container)).toContain(UNTABLED_BODY);
  });
});
