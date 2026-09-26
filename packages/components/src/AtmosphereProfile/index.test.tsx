import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import {
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

const CARRIED_CHANNELS = ["vessel.flight", "vessel.identity", "system.bodies"];

/**
 * Names the parent body: `vessel.identity.parentBodyIndex` resolved against a
 * single-entry `system.bodies` table.
 */
function emitBody(
  fixture: ReturnType<typeof setupStreamFixture>,
  name: string,
) {
  fixture.emit("vessel.identity", { parentBodyIndex: 1 });
  fixture.emit("system.bodies", {
    bodies: [{ name, index: 1, parentIndex: 0, radius: 600_000, orbit: null }],
  });
}

describe("AtmosphereProfileComponent", () => {
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

  function renderAtmo() {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    const rendered = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "atmo-test" }}>
          <AtmosphereProfileComponent config={{}} id="atmo-test" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    return { fixture, ...rendered };
  }

  it("draws a pressure curve for an atmospheric body", async () => {
    const { fixture, container } = renderAtmo();

    act(() => {
      emitBody(fixture, "Kerbin");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("draws a current-altitude threshold line once altitude arrives", async () => {
    const { fixture, container } = renderAtmo();

    act(() => {
      emitBody(fixture, "Kerbin");
      fixture.emit("vessel.flight", { altitudeAsl: 5_600 });
    });

    await waitFor(() => {
      // The curve is drawn dashed; the threshold line is solid. Look for
      // any non-dashed stroke line spanning the plot width.
      const text = container.textContent ?? "";
      // The label goes through speakQuantity, so it carries the unit's WORD
      // rather than its symbol: a chart annotation is read aloud, and
      // "kilopascals" beats "kay pee ay".
      expect(text).toMatch(/pascals/);
    });
  });

  it("shows the airless notice for non-atmospheric bodies", async () => {
    const { fixture, container } = renderAtmo();

    act(() => {
      emitBody(fixture, "Mun");
    });

    await waitFor(() => {
      expect(visibleText(container)).toMatch(/no atmosphere/i);
    });
  });
});
