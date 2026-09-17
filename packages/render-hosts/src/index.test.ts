import { getComponents } from "@ksp-gonogo/sitrep-sdk/registry";
import { describe, expect, it } from "vitest";

/**
 * The package's whole contract is a side effect, so the test is that the side
 * effect happened. There is no API to assert on, which is the point.
 *
 * Held to the hosts that #221 was FILED about rather than to a count, for the
 * reason the sdk's own command scan was rewritten the same way: a count turns
 * "a widget was deleted" and "a widget was added" into the same failure, and
 * neither is what this guards. These four are the ones an Uplink outside this
 * repo could not draw its scene inside.
 */
const HOSTS_THAT_BLOCKED_AN_UPLINK_PAGE = [
  // rp1, the three contributions a stand-in cannot draw because the host's own
  // body draws them
  "strategies",
  "space-center-status",
  "astronaut-complex",
  // ferramaerospaceresearch, its one scene not on the global `plots` slot
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
    // `standInHost` synthesises `component: () => null`. A slot drawn by the
    // host's own body renders nothing against that, which is what #317
    // measured and why this package exists rather than a second stand-in.
    expect(strategies?.component).toBeTypeOf("function");
    expect(strategies?.component).not.toBe(() => null);
    expect(strategies?.contributionSlots).toContain("strategies.screens");
  });
});
