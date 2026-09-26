import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinSuborbital from "./__fixtures__/kerbin-suborbital-prograde-node.json";
import { ManeuverPlannerComponent } from "./index";

/**
 * The planned nodes render off the stream alone, and the node list and the
 * burn-window section describe the same node because both iterate one parsed
 * array.
 */

const NODE_UT = kerbinSuborbital["o.maneuverNodes"][0].UT;
const PINNED_UT = kerbinSuborbital["t.universalTime"];
/** 43301.21875 - 43274.2794794121, rendered floored to whole seconds. */
const SECONDS_TO_BURN = Math.floor(NODE_UT - PINNED_UT);

describe("ManeuverPlanner: full node render off the stream", () => {
  it("draws the planned node, and the burn window describes that same node", async () => {
    const mode = { name: "default-10x18", w: 10, h: 18 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.maneuver"],
      pinnedUt: PINNED_UT,
      suspendFrames: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-stream" }}>
          <ManeuverPlannerComponent
            id="mnv-stream"
            config={{}}
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("vessel.maneuver", {
        nodes: [
          {
            id: "stream-node-id",
            ut: NODE_UT,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 300,
            dvTotal: 300,
            // Contract-valid: `patches` is always an array.
            patches: [],
          },
        ],
      });
    });

    // Waits on a presence only the emitted frame can supply, never on a badge's absence.
    await waitFor(() => {
      if (!visibleText(container).includes("300")) {
        throw new Error("the emitted node has not reached the list yet");
      }
    });

    const text = visibleText(container);
    expect(text).toContain("Planned nodes");
    expect(text).not.toContain("No maneuver nodes planned.");
    expect(text).toContain("300 m/s");
    expect(text).toContain(`burn in ${SECONDS_TO_BURN}s`);
    expect(container.querySelectorAll("li[data-burn-instant-row]").length).toBe(
      3,
    );

    // The burn window's half-delta-v instant is the node's UT, so both count down to one moment.
    expect(text).toContain("Burn windows");
    expect(text).toContain(`in ${SECONDS_TO_BURN}s`);
    // No burn-duration model, so ignition and cutoff are absent rather than substituted.
    expect(text).toContain("no burn-time model");

    expect(
      container.querySelector('button[aria-label="Edit node"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Delete node"]'),
    ).not.toBeNull();
  });
});
