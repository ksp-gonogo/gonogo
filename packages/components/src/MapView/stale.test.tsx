import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * What MapView does when its position is held. A dot on a map is
 * a claim about where the craft is now, so the marker is withheld; the readouts
 * keep the last observed figures, each marked held by its own Unit.
 */

function mount() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mapview-stale" }}>
        <MapViewComponent id="mapview-stale" w={4} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...rendered };
}

/** A position arriving on the wire, at the launchpad. */
function emitPosition(fixture: ReturnType<typeof mount>["fixture"]) {
  act(() => {
    fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
    fixture.emit("vessel.flight", {
      latitude: -0.0972,
      longitude: -74.5577,
      altitudeAsl: 80,
      dynamicPressureKPa: 0,
      mach: 0,
      surfaceSpeed: 0,
      verticalSpeed: 0,
    });
  });
}

/** The held-marked figure whose visible text contains `text`, or null. */
function heldFigure(container: HTMLElement, text: string): Element | null {
  const shown = (el: Element) => el.textContent?.replace(/\s+/g, " ") ?? "";
  return (
    [...container.querySelectorAll("[data-held]")].find((el) =>
      shown(el).includes(text),
    ) ?? null
  );
}

function dropLink(fixture: ReturnType<typeof mount>["fixture"]) {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("MapView when the position is held", () => {
  it("draws the position unmarked while it is current", async () => {
    // The control: without it every assertion below would pass on a widget that never renders a position.
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() => {
      expect(visibleText(container)).toContain("-0.10°");
    });
    expect(container.querySelector("[data-held]")).toBeNull();
  });

  it("keeps the held coordinates, each marked with its spoken caption", async () => {
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("-0.10°"));

    dropLink(fixture);

    await waitFor(() => {
      for (const text of ["-0.10", "-74.56"]) {
        const figure = heldFigure(container, text);
        expect(figure).not.toBeNull();
        expect(
          figure?.querySelector("[data-unit-currency]")?.textContent,
        ).toBeTruthy();
      }
    });
  });

  it("keeps the held altitude, marked on its own field's currency", async () => {
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() =>
      expect(visibleText(container).replace(/\s+/g, " ")).toContain("80.0 m"),
    );

    dropLink(fixture);

    await waitFor(() => expect(heldFigure(container, "80.0")).not.toBeNull());
  });

  it("writes no caption of its own for a held position", async () => {
    const { fixture, container } = mount();
    emitPosition(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("-0.10°"));

    dropLink(fixture);

    await waitFor(() =>
      expect(container.querySelector("[data-held]")).not.toBeNull(),
    );
    expect(visibleText(container)).not.toContain("No position data");
  });

  it("marks nothing held before anything has ever arrived", async () => {
    // A cold start is not a stale position, and must not accuse the link on first paint.
    const { container } = mount();
    await waitFor(() => {
      expect(visibleText(container)).toContain("Waiting for telemetry");
    });
    expect(container.querySelector("[data-held]")).toBeNull();
  });
});
