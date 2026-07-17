import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render as rtlRender, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearBodies()
// notifies the body-registry subscribers. RTL auto-cleanup runs after this
// file's afterEach, so it can't be relied on to unmount first — clearBodies()
// firing on a still-mounted widget is a state update outside act(), the
// documented anti-pattern in CLAUDE.md.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

/**
 * KeplerPeriod's behavior test. This was a fork↔stream parity
 * dual-run back when both `useDataValue` reads were GAPPED and the widget
 * stayed 100% legacy — the stream leg had to feed the gapped keys through a
 * legacy `"data"` `MockDataSource` because nothing streamed. `v.body`/
 * `o.referenceBody` are now un-gapped onto the SDK-derived
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
  unmountAll();
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
