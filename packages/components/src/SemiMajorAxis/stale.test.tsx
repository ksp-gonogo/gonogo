import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * What this widget does when `vessel.orbit` stops being current: SMA dates
 * rather than blanks, since "No orbit data" is the sentence for a craft with
 * no orbit at all. A held number must not look live, the time it was read
 * travels with it through Unit, and a cold start must not be marked.
 */

/** The held figure's spoken staleness, which carries the grade and the instant it was read. */
function heldCaption(container: HTMLElement): string | null {
  return container.querySelector("[data-unit-currency]")?.textContent ?? null;
}

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
  // Clears the subtitle and sparkline size gates, so anything missing is a currency reason.
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
    // The control: without it every assertion below would pass on a widget that captioned every render.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-control");
    emitOrbit(fixture);

    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));
    expect(container.querySelector("[data-not-current]")).toBeNull();
    expect(heldCaption(container)).toBeNull();
  });

  it("keeps the value, and the held figure itself carries when it was read", async () => {
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-held");
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));

    goStale(fixture);

    await waitFor(() =>
      expect(container.querySelector("[data-not-current]")).not.toBeNull(),
    );
    // The number survives: this widget dates its readout rather than withholding it.
    expect(visibleText(container)).toContain("675.0 km");
    // Said in words through the Unit, since the muted tone is invisible to a screen reader.
    expect(heldCaption(container)).toMatch(/OFFLINE, as of /);
    // Time is shown only through Unit, never as a caption the widget writes.
    expect(visibleText(container)).not.toMatch(/last contact|ago/);
  });

  it("marks the NUMBER itself, and says the grade beside it", async () => {
    // The number itself says it is not a reading of now, in the same word the panel badge uses.
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
    // The caption is spoken only, so the sighted readout is unchanged.
    expect(visibleText(container)).toContain("675.0 km");
    expect(visibleText(container)).not.toContain("OFFLINE");
  });

  it("marks the held figure at 3x3, where the body holds only the figure", async () => {
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-tiny", { w: 3, h: 3 });
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));

    goStale(fixture);

    await waitFor(() =>
      expect(container.querySelector("[data-not-current]")).not.toBeNull(),
    );
    expect(visibleText(container)).toContain("675.0 km");
    expect(heldCaption(container)).toMatch(/OFFLINE, as of /);
  });

  it("marks nothing before an orbit has ever arrived", async () => {
    // A cold start is not a held reading, and must not accuse the link on first paint.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-cold");

    await waitFor(() => expect(visibleText(container)).toContain("SMA"));
    expect(visibleText(container)).toContain("No orbit data");
    expect(container.querySelector("[data-not-current]")).toBeNull();
  });

  it("keeps the streaming figure out of every live region", async () => {
    // It changes every frame, so no widget region announces it.
    const fixture = newFixture();
    const container = mount(fixture, "sma-stale-live-regions");
    emitOrbit(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("675.0 km"));
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    // The panel's status announcer is the one live region, and it is empty.
    expect(
      [...container.querySelectorAll("[aria-live]")].map(
        (el) => el.textContent,
      ),
    ).toEqual([""]);

    goStale(fixture);

    await waitFor(() =>
      expect(container.querySelector("[data-not-current]")).not.toBeNull(),
    );
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("does not mark a confirmed tombstone, which is a claim about the craft", async () => {
    // `absent` says there is no orbit, not that the link went quiet, so no staleness caveat.
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
    expect(container.querySelector("[data-not-current]")).toBeNull();
  });
});
