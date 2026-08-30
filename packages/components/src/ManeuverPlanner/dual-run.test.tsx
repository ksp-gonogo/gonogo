import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinSuborbital from "./__fixtures__/kerbin-suborbital-prograde-node.json";
import { ManeuverPlannerComponent } from "./index";

/**
 * ManeuverPlanner renders its planned nodes entirely off the Uplink stream.
 *
 * This file used to be a legacy<->stream behavior-preservation dual-run: the
 * same planned node rendered once off the legacy `"data"` `DataSource` and
 * once with a `TelemetryProvider` mounted alongside it, asserted byte-
 * identical. That comparison no longer has a legacy leg to make. The widget
 * has no `useDataValue` read left at all: the node list reads
 * `useStream("vessel.maneuver.legacy")`, which has NO legacy fallback, so a
 * leg fed only `o.maneuverNodes` renders "No maneuver nodes planned." for any
 * fixture whatsoever.
 *
 * Which is what it had been doing. Both legs rendered the empty state and the
 * byte comparison passed on the strength of two blank renders agreeing, until
 * `11d4f359c` registered the production derived channels in
 * `setupStreamFixture` and the stream leg started drawing the node it was fed.
 * The legacy leg could not follow, so a real render began failing against an
 * empty one. Worse, it failed only sometimes: the settle waited for the
 * "SYNCING" badge to go ABSENT, and a wait on an absence is satisfied on the
 * first paint when the badge has not appeared yet, so whether the stream leg
 * was allowed to commit its frame came down to machine speed. That is the
 * exact wait `unfed-snapshot-gate.ts` was built over, and it was still
 * load-bearing here.
 *
 * What remains is the full stream render on its own, with NO legacy source
 * registered anywhere in this file, and a wait on the node's presence rather
 * than a badge's absence. It also pins the invariant `11d4f359c` was about:
 * the node list and the burn-window section describe the SAME node, because
 * both iterate one parsed array rather than reading `vessel.maneuver` twice.
 *
 * The New-maneuver preview still reports "Awaiting orbit telemetry": this
 * fixture carries no `vessel.orbit` emit, and the preview's inputs are a
 * separate surface from the node list this file is about.
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
            // Contract-valid: `patches` is always an array. Omitting it was
            // what made this file the one that threw.
            patches: [],
          },
        ],
      });
    });

    // Wait on the node's OWN delta-v reaching the list, a fact only the
    // emitted frame can supply. The previous wait ("SYNCING" gone) was
    // satisfiable before any frame committed; see this file's doc comment.
    await waitFor(() => {
      if (!visibleText(container).includes("300")) {
        throw new Error("the emitted node has not reached the list yet");
      }
    });

    const text = visibleText(container);
    // The list: one node, its delta-v and its countdown, off the derived
    // `vessel.maneuver.legacy` reshape of the emitted frame.
    expect(text).toContain("Planned nodes");
    expect(text).not.toContain("No maneuver nodes planned.");
    expect(text).toContain("300 m/s");
    expect(text).toContain(`burn in ${SECONDS_TO_BURN}s`);
    expect(container.querySelectorAll("li[data-burn-instant-row]").length).toBe(
      3,
    );

    // The burn window is the same node, not a second read of it: its half-delta-v
    // instant IS the node's UT, so it counts down to the same moment the row does.
    expect(text).toContain("Burn windows");
    expect(text).toContain(`in ${SECONDS_TO_BURN}s`);
    // Nothing on this craft models a burn duration, so ignition and cutoff are
    // absent rather than substituted from the node's UT.
    expect(text).toContain("no burn-time model");

    // Editing and deleting a node are the list's own controls, and they only
    // exist once a node does.
    expect(
      container.querySelector('button[aria-label="Edit node"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Delete node"]'),
    ).not.toBeNull();
  });
});
