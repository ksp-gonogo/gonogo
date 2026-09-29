import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * What AtmosphereProfile does when its telemetry reads are absent:
 *
 *  - `showNoBodyNotice = bodyName !== undefined && body === undefined` is the
 *    one place that tells absent from present but unusable (neither the
 *    `system.bodies` roster nor the bundled table can build the body)
 *  - a flight record without altitude drops the current-pressure marker with
 *    no trace, while the rest of the chart draws
 *  - `liveDensity > 1e-9` suppresses the HUD chip identically for absent,
 *    non-finite and a genuine vacuum zero
 *  - each chip row has its own `!== null` gate, so a partial record drops rows
 *    individually
 */

function renderAtmo() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
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

/** The body-name chain (`vessel.identity.parentBodyIndex` against `system.bodies`), plus the `vessel.flight` record. */
function emitBody(
  fixture: ReturnType<typeof setupStreamFixture>,
  name: string,
  opts: { flight?: Record<string, unknown> } = {},
) {
  fixture.emit("vessel.flight", opts.flight ?? {});
  fixture.emit("vessel.identity", { parentBodyIndex: 1 });
  fixture.emit("system.bodies", {
    bodies: [{ name, index: 1, parentIndex: 0, radius: 600_000, orbit: null }],
  });
}

describe("AtmosphereProfile: what undefined means today", () => {
  let restoreResizeObserver: () => void = () => {};
  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });

  afterEach(() => {
    clearBodies();
    restoreResizeObserver();
    vi.unstubAllGlobals();
  });

  it("shows the waiting-for-body empty state and NO notices when nothing has arrived", () => {
    const { container } = renderAtmo();

    // The widget's only honest never-arrived surface, from the body read alone.
    expect(visibleText(container)).toContain("Waiting for body telemetry...");

    // Named absences: no unknown-body notice, no no-model notice, no HUD chip.
    expect(screen.queryByRole("status")).toBeNull();
    expect(visibleText(container)).not.toContain("Unknown body");
    expect(visibleText(container)).not.toContain("ρ");
    // No current-pressure threshold: only its label renders the spelled-out unit.
    expect(visibleText(container)).not.toMatch(/pascals/);
  });

  it("takes a body the bundled table has never heard of as known, because the stream described it", async () => {
    const { fixture, container } = renderAtmo();

    /* The roster states the radius, so a name the stock table cannot resolve is still a known body, one reporting no air. */
    act(() => {
      emitBody(fixture, "Definitely-Not-A-Body");
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain(
        "No atmosphere on Definitely-Not-A-Body",
      ),
    );
    expect(visibleText(container)).not.toContain("Unknown body");
    expect(visibleText(container)).not.toContain("Waiting for body telemetry");
  });

  it("distinguishes a body it cannot build at all from no body name at all", async () => {
    const { fixture, container } = renderAtmo();

    /* A name arrived and neither the roster (no radius) nor the bundled table can describe the body. */
    act(() => {
      fixture.emit("vessel.flight", {});
      fixture.emit("vessel.identity", { parentBodyIndex: 1 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Definitely-Not-A-Body",
            index: 1,
            parentIndex: 0,
            orbit: null,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("Unknown body"),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Definitely-Not-A-Body",
    );
    // Not exclusive: GraphView keeps saying "waiting" under a notice saying the wait is hopeless.
    expect(visibleText(container)).toContain("Waiting for body telemetry...");
  });

  it("silently omits the current-pressure marker while the flight record carries no altitude", async () => {
    const { fixture, container } = renderAtmo();

    // Density and no altitude: the marker drops.
    act(() => {
      emitBody(fixture, "Kerbin", { flight: { atmDensity: 1.217 } });
    });

    // The curve draws, so the operator has no cue the "flying through this pressure" line is missing.
    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
    expect(visibleText(container)).not.toMatch(/pascals/);

    // With an altitude the marker draws: the missing field is the only cause.
    act(() => {
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

    // Only `atmDensity` absent: the all-or-nothing chip withholds the temperatures that did arrive.
    act(() => {
      emitBody(fixture, "Kerbin", {
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

    // Start from a live chip, so the disappearance is caused by the zero.
    act(() => {
      emitBody(fixture, "Kerbin", {
        flight: { altitudeAsl: 5_600, atmDensity: 1.217 },
      });
    });
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));

    // An observed 0 kg/m³ is discarded by the same test as an absent field: the chip vanishes rather than reading zero.
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

    // Skin temperature absent: the one place absence renders per field.
    act(() => {
      emitBody(fixture, "Kerbin", {
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
    // No placeholder: the row is simply not there.
    expect(visibleText(container)).not.toContain("Skin");
  });
});
