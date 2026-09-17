import { getComponents } from "@ksp-gonogo/sitrep-sdk/registry";
import { describe, expect, it } from "vitest";

/**
 * The package's whole contract is a side effect, so the test is that the side
 * effect happened. There is no API to assert on, which is the point.
 *
 * Held to the hosts that ticket 221 was FILED about rather than to a count, for the
 * reason the sdk's own command scan was rewritten the same way: a count turns
 * "a widget was deleted" and "a widget was added" into the same failure, and
 * neither is what this guards. These four are the ones an Uplink outside this
 * repo could not draw its scene inside.
 */
const HOSTS_THAT_BLOCKED_AN_UPLINK_PAGE = [
  /**
   * Three contributions a stand-in cannot draw, because `strategies.screens`,
   * `space-center-status.facilities` and `astronaut-complex.readouts` are each
   * read by a `useContributions(...)` in the host's own body.
   */
  "strategies",
  "space-center-status",
  "astronaut-complex",
  /**
   * Draws `landing-status.badges`, and mounts `PlotBoard` in its body, so it is
   * also the host that draws a contribution on the app-wide `plots` slot.
   */
  "landing-status",
];

describe("@ksp-gonogo/render-hosts", () => {
  it("registers the hosts an out-of-repo Uplink names in _scene.host", async () => {
    await import("./index");
    const registered = new Set(getComponents().map((c) => c.id));
    expect(
      HOSTS_THAT_BLOCKED_AN_UPLINK_PAGE.filter((id) => !registered.has(id)),
    ).toEqual([]);
  });

  it("registers a host with a BODY, which is the whole difference from a stand-in", async () => {
    await import("./index");
    const strategies = getComponents().find((c) => c.id === "strategies");
    /**
     * `standInHost` synthesises `{ component: () => null, description:
     * "Stand-in host for a render scene.", channels: undefined }`. A slot drawn
     * by the host's own body renders nothing against that, which is what
     * ticket 317 measured and why this package exists rather than a second
     * stand-in.
     *
     * Compared on what a stand-in CANNOT have rather than on the component
     * identity: `not.toBe(() => null)` reads like the right assertion and is
     * worthless, because the arrow it compares against is a fresh function that
     * could never be equal to anything.
     */
    expect(strategies?.description).not.toBe(
      "Stand-in host for a render scene.",
    );
    expect(strategies?.channels?.length ?? 0).toBeGreaterThan(0);
    expect(strategies?.contributionSlots).toContain("strategies.screens");
  });
});
