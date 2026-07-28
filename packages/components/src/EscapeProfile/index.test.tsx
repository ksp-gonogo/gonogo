import {
  clearBodies,
  DashboardItemContext,
  registerBody,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EscapeProfileComponent } from "./index";

// vessel.state's carried-channels gate is parent-channel-scoped, every
// vessel.state.* field needs ALL of vesselStateChannel.inputs carried.
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

/** Resolves `vessel.state.parentBodyName` to `name` via a single-entry `system.bodies` table. */
function emitBody(
  fixture: ReturnType<typeof setupStreamFixture>,
  name: string,
) {
  fixture.emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: 700_000,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    mu: 3.5316e12,
    meanAnomalyAtEpoch: 0,
    epoch: 10,
    encounter: null,
  });
  fixture.emit("system.bodies", {
    bodies: [{ name, index: 1, parentIndex: 0, radius: 600_000, orbit: null }],
  });
  fixture.emit("vessel.identity", { parentBodyIndex: 1 });
}

describe("EscapeProfileComponent", () => {
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

  function renderEscape() {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });
    const rendered = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "esc-test" }}>
          <EscapeProfileComponent config={{}} id="esc-test" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    return { fixture, ...rendered };
  }

  it("renders the title and no curve before v.body arrives", async () => {
    const { container } = renderEscape();
    await screen.findByText("ESCAPE PROFILE");
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("draws the escape-velocity curve once the body is known", async () => {
    const { fixture, container } = renderEscape();

    act(() => {
      emitBody(fixture, "Kerbin");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("falls back to a notice when the body has no GM", async () => {
    registerBody({
      id: "Modtopia",
      name: "Modtopia",
      radius: 500_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });

    const { fixture } = renderEscape();

    act(() => {
      emitBody(fixture, "Modtopia");
    });

    expect(await screen.findByText(/no reference data/i)).toBeInTheDocument();
  });
});
