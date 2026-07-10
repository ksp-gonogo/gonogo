import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

/**
 * KeplerPeriod's R6 Wave-1 behavior test. This was a fork↔stream parity
 * dual-run back when both `useDataValue` reads were GAPPED and the widget
 * stayed 100% legacy — the stream leg had to feed the gapped keys through a
 * legacy `"data"` `MockDataSource` because nothing streamed. The SharedLib
 * phase un-gapped `v.body`/`o.referenceBody` onto the SDK-derived
 * `vessel.state.parentBodyName`/`referenceBodyName` display maps, so the
 * legacy MockDataSource leg is dropped: the widget now feeds entirely from
 * the real stream pipeline (`TelemetryProvider` + `StubTransport`), and this
 * test proves the POSITIVE path — a KNOWN streamed body resolves and the
 * Kepler reference curve renders (the unknown-body degraded path is covered
 * in `stream.test.tsx`).
 */
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
          [{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  clearBodies();
  vi.unstubAllGlobals();
});

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

describe("KeplerPeriod — renders the reference curve off the stream (R6 Wave 1)", () => {
  it("draws the Kepler curve once a known reference body streams in", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-dual" }}>
          <KeplerPeriodComponent id="kepler-dual" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Kerbin's low orbit (kerbin-lko fixture) expressed as the derived
    // channel's inputs: `referenceBodyIndex`/`parentBodyIndex` point at
    // Kerbin (stock index 1), so `resolveBodyName` -> "Kerbin" and the widget
    // resolves a real BodyDefinition with a `gm` to build the curve from.
    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 680000,
        ecc: 0.0,
        inc: 0.0,
        argPe: 0.0,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 1,
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 1, launchUt: 0 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
    });

    // A real subscription must have happened for StubTransport (subscription-
    // gated) to deliver.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    // The reference curve renders off the streamed, resolved body — no
    // "Unknown body"/"No reference data" degraded notice.
    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
    expect(container.textContent).not.toContain("Unknown body");
    expect(container.textContent).not.toContain("No reference data");
  });
});
