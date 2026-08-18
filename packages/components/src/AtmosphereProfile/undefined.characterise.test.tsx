import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * What AtmosphereProfile DOES today when its telemetry reads are `undefined`,
 * recorded before `useTelemetry` becomes a `Reading`.
 *
 * Four absence-shaped sites, three different meanings:
 *  - `bodyName = vesselState?.parentBodyName ?? undefined`, then
 *    `showNoBodyNotice = bodyName !== undefined && body === undefined`: the ONE
 *    place in this widget that distinguishes absent from present-but-unusable,
 *    and it distinguishes them on `undefined` specifically
 *  - `altitude = vesselState?.altitudeAsl ?? undefined`, gated by
 *    `altitude === undefined` inside the threshold memo. The derived channel
 *    leaves `altitudeAsl` `null` on the OnRails (propagated) basis, so this site
 *    flattens "this basis cannot measure altitude" into "nothing has arrived",
 *    and drops the current-pressure marker with no on-screen trace
 *  - `magnitudeOf(flight?.atmDensity)` gated by `liveDensity !== null &&
 *    liveDensity > 1e-9`: absent, non-finite and a genuine vacuum zero all
 *    suppress the HUD chip identically
 *  - `liveAirTemp !== null` / `liveSkinTemp !== null` per chip row: a partial
 *    flight record drops rows individually
 */

const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

function renderAtmo() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "atmo-undef" }}>
        <AtmosphereProfileComponent config={{}} id="atmo-undef" w={8} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...rendered };
}

/**
 * The body-name resolution chain: `vessel.identity.parentBodyIndex` against a
 * `system.bodies` entry, feeding the derived `vessel.state.parentBodyName`.
 * `quality` decides whether `altitudeAsl` is populated (Loaded) or left `null`
 * (the OnRails default).
 */
function emitBody(
  fixture: ReturnType<typeof setupStreamFixture>,
  name: string,
  opts: { quality?: number; flight?: Record<string, unknown> } = {},
) {
  fixture.emit(
    "vessel.orbit",
    {},
    { quality: opts.quality ?? Quality.OnRails },
  );
  fixture.emit("vessel.flight", opts.flight ?? {});
  fixture.emit("vessel.identity", { parentBodyIndex: 1 });
  fixture.emit("system.bodies", {
    bodies: [{ name, index: 1, parentIndex: 0, radius: 600_000, orbit: null }],
  });
}

describe("AtmosphereProfile: what undefined means today", () => {
  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    vi.stubGlobal(
      "ResizeObserver",
      class FakeResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(_el: Element) {
          this.cb(
            [
              {
                contentRect: { width: 400, height: 300 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    clearBodies();
    vi.unstubAllGlobals();
  });

  it("shows the waiting-for-body empty state and NO notices when nothing has arrived", () => {
    const { container } = renderAtmo();

    // `body === undefined` picks the GraphView empty state. This is the widget's
    // only honest never-arrived surface, and it comes from the body read alone.
    expect(visibleText(container)).toContain("Waiting for body telemetry...");

    // Named absences rather than an empty container: no unknown-body notice (its
    // gate needs `bodyName !== undefined`), no no-model notice, and no HUD chip.
    expect(screen.queryByRole("status")).toBeNull();
    expect(visibleText(container)).not.toContain("Unknown body");
    expect(visibleText(container)).not.toContain("ρ");
    // No current-pressure threshold: its label is the only thing that renders
    // the word, `speakQuantity` spells the unit out.
    expect(visibleText(container)).not.toMatch(/pascals/);
  });

  it("distinguishes a body name it does not know from no body name at all", async () => {
    const { fixture, container } = renderAtmo();

    // The gate's `bodyName !== undefined` half: a name arrived, `getBody` cannot
    // resolve it, so the operator gets a specific explanation. Compare the test
    // above, where the same missing chart draws the generic waiting state.
    act(() => {
      emitBody(fixture, "Definitely-Not-A-Body");
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("Unknown body"),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Definitely-Not-A-Body",
    );
    // The chart's own empty state is NOT exclusive with the notice: `body` is
    // still undefined, so GraphView keeps saying "waiting" underneath a notice
    // that says the wait is over and hopeless. Both render at once today.
    expect(visibleText(container)).toContain("Waiting for body telemetry...");
  });

  it("silently omits the current-pressure marker while the altitude read is null", async () => {
    const { fixture, container } = renderAtmo();

    // OnRails is the default basis, and `deriveVesselState` leaves `altitudeAsl`
    // NULL there: a confirmed "this basis does not measure altitude", not a
    // never-arrived. The widget's `?? undefined` flattens the two, and the
    // threshold memo's `altitude === undefined` gate then drops the marker.
    act(() => {
      emitBody(fixture, "Kerbin", { flight: { atmDensity: 1.217 } });
    });

    // The pressure curve draws, so the chart is fully live and the operator has
    // no cue that the "you are flying through this pressure" line is missing.
    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
    expect(visibleText(container)).not.toMatch(/pascals/);

    // The same emission on the Loaded basis, where `altitudeAsl` is a real
    // number, does draw the marker: the omission above is the null read and
    // nothing else.
    act(() => {
      fixture.emit(
        "vessel.orbit",
        {},
        { quality: Quality.Loaded, validAt: 1, seq: 1, deliveredAt: 1 },
      );
      fixture.emit(
        "vessel.flight",
        { altitudeAsl: 5_600, atmDensity: 1.217 },
        { validAt: 1, seq: 1, deliveredAt: 1 },
      );
    });
    await waitFor(() => expect(visibleText(container)).toMatch(/pascals/));
  });

  it("suppresses the whole HUD chip when the flight record has no density", async () => {
    const { fixture, container } = renderAtmo();

    // Body resolves, altitude resolves, only `atmDensity` is absent. The chip is
    // an all-or-nothing render keyed on the density read, so the air and skin
    // temperatures that DID arrive are withheld with it.
    act(() => {
      emitBody(fixture, "Kerbin", {
        quality: Quality.Loaded,
        flight: {
          altitudeAsl: 5_600,
          atmosphericTemperature: 289,
          externalTemperature: 291,
        },
      });
    });

    await waitFor(() => expect(visibleText(container)).toMatch(/pascals/));
    expect(visibleText(container)).not.toContain("ρ");
    expect(visibleText(container)).not.toContain("Air");
    expect(visibleText(container)).not.toContain("Skin");
  });

  it("suppresses the HUD chip for a genuine vacuum zero exactly as for an absent density", async () => {
    const { fixture, container } = renderAtmo();

    // Start from a live chip so the disappearance below is caused by the zero.
    act(() => {
      emitBody(fixture, "Kerbin", {
        quality: Quality.Loaded,
        flight: { altitudeAsl: 5_600, atmDensity: 1.217 },
      });
    });
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));

    // An observed 0 kg/m³ is a real measurement, and `liveDensity > 1e-9`
    // discards it with the same test that discards an absent field: the chip
    // vanishes rather than reading zero.
    act(() => {
      fixture.emit(
        "vessel.flight",
        { altitudeAsl: 5_600, atmDensity: 0 },
        { validAt: 1, seq: 1, deliveredAt: 1 },
      );
    });

    await waitFor(() => expect(visibleText(container)).not.toContain("ρ"));
    expect(visibleText(container)).not.toContain("kg/m³");
  });

  it("drops individual chip rows for the temperatures the flight record omits", async () => {
    const { fixture, container } = renderAtmo();

    // Partial payload: density present, air temperature present, skin
    // temperature absent. Each row has its own `!== null` gate, so this is the
    // one place absence is rendered per field rather than per record.
    act(() => {
      emitBody(fixture, "Kerbin", {
        quality: Quality.Loaded,
        flight: {
          altitudeAsl: 5_600,
          atmDensity: 1.217,
          atmosphericTemperature: 289,
        },
      });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("1.217 kg/m³"),
    );
    expect(visibleText(container)).toContain("Air");
    // No placeholder for the missing row, it is simply not there.
    expect(visibleText(container)).not.toContain("Skin");
  });
});
