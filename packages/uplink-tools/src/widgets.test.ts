import { getComponents } from "@ksp-gonogo/sitrep-sdk/registry";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The package's whole contract is a side effect, so the test is that the side
 * effect happened. There is no API to assert on, which is the point.
 *
 * Held to the widgets that ticket 221 was FILED about rather than to a count, for the
 * reason the sdk's own command scan was rewritten the same way: a count turns
 * "a widget was deleted" and "a widget was added" into the same failure, and
 * neither is what this guards. These four are the ones an Uplink outside this
 * repo could not draw its scene inside.
 */
const WIDGETS_THAT_BLOCKED_AN_UPLINK_PAGE = [
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
   * also the widget that draws a contribution on the app-wide `plots` slot.
   */
  "landing-status",
];

describe("@ksp-gonogo/uplink-tools/widgets", () => {
  /**
   * Warmed once, with its own budget, because the whole cost of this file is
   * ONE cold import and it lands on whichever test runs first. Measured: the
   * first test 2110ms and the second 1ms, which is not two tests of different
   * weight.
   *
   * The budget is generous because the import transforms the app's entire
   * widget graph through vite, and `test` runs every package in parallel under
   * turbo, so it is paid on a contended machine. It timed out at the 30s
   * default there while passing in 2s locally. That is a transform cost under
   * contention rather than a slow module: the same import through
   * `loadHostWidgets` is what every in-repo Uplink's `uplink-page.test.ts`
   * already does, and one measured at 1356ms for it and passes in CI.
   *
   * Here rather than on each test so that the cost is attributed where it
   * occurs and a genuinely slow ASSERTION still fails on the default.
   */
  beforeAll(async () => {
    await import("./widgets");
  }, 120_000);

  it("registers the widgets an out-of-repo Uplink names in _scene.hostWidget", () => {
    const registered = new Set(getComponents().map((c) => c.id));
    expect(
      WIDGETS_THAT_BLOCKED_AN_UPLINK_PAGE.filter((id) => !registered.has(id)),
    ).toEqual([]);
  });

  it("registers a widget with a BODY, which is the whole difference from a stand-in", () => {
    const strategies = getComponents().find((c) => c.id === "strategies");
    /**
     * `standInHostWidget` synthesises `{ component: () => null, description:
     * "Stand-in host widget for a render scene.", channels: undefined }`. A slot drawn
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
      "Stand-in host widget for a render scene.",
    );
    expect(strategies?.channels?.length ?? 0).toBeGreaterThan(0);
    expect(strategies?.contributionSlots).toContain("strategies.screens");
  });
});
