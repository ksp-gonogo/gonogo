import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * What this widget does when `vessel.orbit` stops being current.
 *
 * SMA DATES rather than blanks, and this file is what holds that choice in
 * place. A semi-major axis is a number beside a label, the one figure the tile
 * exists to show, and "2.87 Mm, at last contact 10s ago" is both honest and
 * usable: an operator can still tell a Kerbin sync orbit from a Mun orbit off a
 * ten-second-old reading. Blanking it would leave the tile saying "No orbit
 * data", which is the sentence for a craft with no orbit at all.
 *
 * So the assertions that earn the file are the ones about the WORDING. A held
 * number looks exactly like a live one, which is the failure this widget could
 * have quietly shipped, and the cold-start case is asserted alongside because a
 * caption that appears on first paint accuses the link of dropping every time
 * the page loads.
 */

const CARRIED = ["vessel.orbit", "system.bodies"];

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mount(
  fixture: ReturnType<typeof setupStreamFixture>,
  instanceId: string,
  size: { w: number; h: number } = { w: 5, h: 6 },
) {
  // w=5,h=6 clears the subtitle and sparkline size gates, so anything missing
  // below is missing for a currency reason rather than a layout one.
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <SemiMajorAxisComponent
          config={{}}
          id={instanceId}
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

function newFixture() {
  return setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function emitOrbit(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
  });
}

/** Drop the link, then run a frame: nothing else re-derives the readings. */
function goStale(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("SemiMajorAxis when vessel.orbit is no longer current", () => {
  it("draws the value with no caveat while the orbit reading is current", async () => {
    // The control. Without it, every assertion below would also pass on a
    // widget that captioned every render.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-control");
    emitOrbit(fixture);

    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));
    expect(visibleText(container)).not.toContain("at last contact");
  });

  it("keeps the value and says it is from the last contact, with its age", async () => {
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-held");
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));

    goStale(fixture);

    await waitFor(() =>
      expect(visibleText(container)).toContain("at last contact"),
    );
    // The number survives: this widget dates its readout instead of withholding
    // it, and losing the figure would be losing the widget.
    expect(visibleText(container)).toContain("675.0 km");
    // The age is what makes the caveat actionable: "at last contact" alone does
    // not say whether the link went quiet a second ago or a minute ago. Emitted
    // at UT 0 against a view clock pinned at 10.
    expect(visibleText(container)).toMatch(/at last contact, .*10s ago/);
    // Said out loud, not just coloured: the mute on the number is a glance-level
    // hint and a screen reader cannot see it.
    expect(
      screen
        .getAllByRole("status")
        .some((el) => el.textContent?.includes("at last contact")),
    ).toBe(true);
  });

  it("marks the NUMBER itself, and says the grade beside it", async () => {
    // The widget's own caption says the observation is old; this says the
    // number on screen is not a reading of now, on the number, where an
    // operator scanning a wall of tiles is actually looking. It reaches a
    // screen reader as the same word the panel badge uses.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-marked");
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));
    expect(container.querySelector("[data-not-current]")).toBeNull();

    goStale(fixture);

    await waitFor(() =>
      expect(container.querySelector("[data-not-current]")).not.toBeNull(),
    );
    expect(container.textContent).toContain("OFFLINE");
    // And it costs the sighted readout nothing: the caption is spoken only.
    expect(visibleText(container)).toContain("675.0 km");
    expect(visibleText(container)).not.toContain("OFFLINE");
  });

  it("leaves the held mark alone to say it at 3x3, where the age has no room", async () => {
    // A 3x3 body holds the figure and nothing under it, and a caption drawn
    // there is cut off by the cell rather than read.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-tiny", { w: 3, h: 3 });
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));

    goStale(fixture);

    await waitFor(() =>
      expect(container.querySelector("[data-not-current]")).not.toBeNull(),
    );
    expect(visibleText(container)).toContain("675.0 km");
    expect(visibleText(container)).not.toContain("at last contact");
    expect(container.textContent).toContain("OFFLINE");
  });

  it("says nothing about last contact before an orbit has ever arrived", async () => {
    // A cold start is not a held reading. Conflating the two would have the tile
    // accusing the link on first paint, every paint.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-cold");

    await waitFor(() => expect(visibleText(container)).toContain("SMA"));
    expect(visibleText(container)).toContain("No orbit data");
    expect(visibleText(container)).not.toContain("at last contact");
  });

  it("keeps the streaming figure and the ticking age out of every live region", async () => {
    // A live region re-announces on every change, and both of these change every frame: only the transition to held is an event worth speaking.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-live-regions");
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    // The panel's own status announcer is the one live region, and it is empty.
    expect(
      [...container.querySelectorAll("[aria-live]")].map(
        (el) => el.textContent,
      ),
    ).toEqual([""]);

    goStale(fixture);

    await waitFor(() =>
      expect(visibleText(container)).toContain("at last contact"),
    );
    const regions = screen.getAllByRole("status");
    expect(regions.map((el) => el.textContent)).toEqual(["at last contact"]);
  });

  it("does not caption a confirmed tombstone, which is a claim about the craft", async () => {
    // `absent` is the subject saying there is no orbit, not a link that went
    // quiet, so the empty state stands on its own with no staleness caveat
    // attached to it.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-absent");
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));

    act(() => {
      fixture.emit("vessel.orbit", null, { validAt: 5 });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("No orbit data"),
    );
    expect(visibleText(container)).not.toContain("at last contact");
  });
});
