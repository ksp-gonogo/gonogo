import {
  clearBodies,
  DashboardItemContext,
  registerBody,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { OrbitalAscentComponent } from "./index";

/**
 * The widget's own read is the parent-body name, off the client-derived
 * `vessel.state` channel (`parentBodyName`, resolved from
 * `vessel.identity.parentBodyIndex` against `system.bodies`). The reference
 * curve is then computed client-side from the body registry. The two plotted
 * series (`v.altitude`/`v.horizontalVelocity`) go through the shared GraphView
 * path and are left empty here — the assertions only cover the body-driven
 * reference curve, so no series data is emitted.
 */

// All eight vessel.state inputs — the carried-channels gate is
// parent-channel-scoped, so the whole set must be carried for
// parentBodyName to route off the stream.
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
] as const;

describe("OrbitalAscentComponent", () => {
  // Trees are unmounted synchronously in afterEach before clearBodies()
  // notifies the body-registry subscribers — that notification re-renders a
  // still-mounted widget, the act() anti-pattern. RTL auto-cleanup runs after
  // this hook, too late to rely on for the ordering.
  const trees: Array<() => void> = [];

  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    // The default installDomStubs ResizeObserver never fires its callback,
    // which leaves LineChart's `size` null and skips the SVG paths we want
    // to assert against. Stub a version that fires once on observe(), the
    // same shape used by the Graph widget's own tests.
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
    for (const unmount of trees) unmount();
    trees.length = 0;
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderAscent() {
    const fixture = setupStreamFixture({
      carriedChannels: [...VESSEL_STATE_INPUTS],
      pinnedUt: 10,
    });
    const result = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ascent-test" }}>
          <OrbitalAscentComponent config={{}} id="ascent-test" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    trees.push(result.unmount);
    return { ...result, fixture };
  }

  /** Stream the parent-body name through vessel.identity + system.bodies. */
  function emitBody(fixture: StreamFixture, name: string) {
    act(() => {
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name,
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 1, launchUt: 0 });
    });
  }

  it("renders the title and no reference curve before v.body arrives", async () => {
    const { container } = renderAscent();
    // Wait for the panel to actually render (covers any post-mount async
    // settling from the buffered series subscription) before asserting
    // the negative.
    await screen.findByText("ORBITAL ASCENT");
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("renders a circular-orbit reference curve once the body is known", async () => {
    const { container, fixture } = renderAscent();

    emitBody(fixture, "Kerbin");

    // The reference curve is a dashed SVG path inside the LineChart svg.
    await waitFor(() => {
      const dashed = container.querySelectorAll("path[stroke-dasharray]");
      expect(dashed.length).toBeGreaterThan(0);
    });
  });

  it("falls back to a notice when the body has no GM registered", async () => {
    registerBody({
      id: "Modtopia",
      name: "Modtopia",
      radius: 500_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });

    const { container, fixture } = renderAscent();

    emitBody(fixture, "Modtopia");

    expect(await screen.findByText(/no reference data/i)).toBeInTheDocument();
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("falls back to a notice when the body is not in the registry", async () => {
    const { fixture } = renderAscent();

    emitBody(fixture, "MysteryRock");

    expect(await screen.findByText(/unknown body/i)).toBeInTheDocument();
  });
});
