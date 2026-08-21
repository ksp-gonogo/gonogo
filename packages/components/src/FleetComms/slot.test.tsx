import { getAugmentsForSlot, getContributionsForSlot } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SystemViewComponent } from "../SystemView";
import { UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
// Importing the augment module registers it ONCE, at this file's first
// import (module-load self-registration, same lifecycle as
// `registerComponent`): deliberately NOT cleared with `clearAugments()`
// between tests the way `SystemView/slot.test.tsx` clears its ad-hoc,
// per-test test-augments: there is nothing here to re-register between
// tests, so clearing would just permanently empty both slots after the
// first `it()`.
import "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

const KERBIN_MU = 3.5316e12;

/**
 * Integration coverage for the Fleet/Comms augment (Phase 1 spine,
 * local_docs/design/specs/2026-07-15-system-view-fleet-comms-design.md):
 * registers into SystemView's real `system-view.overlay`/`system-view.actions`
 * slots and renders through the real host, same pattern
 * as `SystemView/slot.test.tsx`'s own test-augment cases. Pure projection/timing
 * math is covered by `projection.test.ts`/`pendingPulse.test.ts`; this file
 * proves the WIRING: the augment reads the right topics, anchors the
 * commlink line/pulses on the vessel's projected position without drawing a
 * second copy of `SystemDiagram`'s own vessel marker, and the two action
 * toggles actually gate what's drawn. The header link badge left this file
 * with the augment it used to be: it is a contribution now, covered end to
 * end by `./panel-badge.test.tsx`.
 */
describe("FleetComms: Phase 1 spine augment on SystemView", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    __resetFleetCommsTogglesForTests();
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "vessel.target",
        "system.bodies",
        "comms.path",
        "comms.link",
        "system.uplink.pending",
      ],
      pinnedUt: 100,
    });
  });

  async function renderDiagram() {
    const result = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbin",
            parentIndex: null,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            orbit: null,
          },
          {
            index: 1,
            name: "Mun",
            parentIndex: 0,
            radius: 200_000,
            gravParameter: 6.5138398e10,
            orbit: {
              sma: 12_000_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 100,
            },
          },
        ],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Test Ship",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 0,
        sma: 700_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 100,
        mu: KERBIN_MU,
        horizon: UNBOUNDED_HORIZON,
      });
    });
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(1),
    );
    return result;
  }

  it("registers both slot fills at module load", () => {
    const overlay = getAugmentsForSlot("system-view.overlay");
    const actions = getAugmentsForSlot("system-view.actions");
    expect(overlay.map((a) => a.id)).toContain("fleet-comms-overlay");
    expect(actions.map((a) => a.id)).toContain("fleet-comms-actions");
  });

  // The badge is no longer one of them, and this is what would catch a
  // half-done migration that left the augment registered as well.
  it("no longer registers a badges augment", () => {
    expect(getAugmentsForSlot("system-view.badges")).toEqual([]);
  });

  // The contribution IS registered, by importing `./index` above (which
  // side-effect imports `./badge`). Proves the two halves stay wired together
  // without this file having to import the badge module itself.
  it("registers the badge as a contribution on the same slot id", () => {
    // `core:`-prefixed: a contribution id is stamped with its owning client,
    // and the built-in half registers through `CORE_UPLINK_CLIENT`.
    expect(
      getContributionsForSlot("system-view.badges").map((c) => c.id),
    ).toContain("core:fleet-comms-badge");
  });

  it("does not draw a second vessel dot on top of SystemDiagram's own marker (regression: 'green dots stacked in the centre')", async () => {
    // Root cause of the live-reported bug: this augment used to render its
    // OWN copy of the active-vessel dot at the exact same projected point
    // `SystemDiagram.tsx`'s built-in `VesselMarker` already draws (both use
    // the identical `--color-accent-fg` fill): two circles stacked exactly
    // on top of each other, which a realistic low orbit projects only a few
    // px from the diagram's origin, reading as duplicate dots sitting on the
    // frame body itself. `SystemDiagram`'s marker fill is the only thing
    // that should ever paint that colour once this augment has mounted.
    await renderDiagram();
    await waitFor(() => {
      expect(
        document.querySelectorAll('circle[fill="var(--color-accent-fg)"]'),
      ).toHaveLength(1);
    });
  });

  it("anchors the commlink line on the vessel's actual projected position, not the origin", async () => {
    await renderDiagram();
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.path", {
        hops: [{ from: "Test Ship", to: "KSC", kind: 0 }],
      });
    });
    await waitFor(() => {
      // Scoped to this augment's own overlay `<svg>`: `SystemDiagram`'s own
      // vessel marker can ALSO draw a `<line>` (a leader line back to the
      // vessel's true position when its marker would otherwise land on the
      // frame body's own dot), a bare `document.querySelector("line")`
      // would happily match that one instead of the commlink line this
      // test means to check.
      const line = document.querySelector(
        '[aria-label="Fleet and comms overlay"] line',
      );
      expect(line).toBeTruthy();
      // x1/y1 is the diagram origin (the frame body); x2/y2 must be a
      // distinct, non-zero point: i.e. the vessel's real projected
      // position, not collapsed onto the origin.
      const x2 = Number(line?.getAttribute("x2"));
      const y2 = Number(line?.getAttribute("y2"));
      expect(Number.isFinite(x2)).toBe(true);
      expect(Number.isFinite(y2)).toBe(true);
      expect(x2 !== 0 || y2 !== 0).toBe(true);
    });
  });

  it("does not draw a commlink line when the vessel orbits a different body than the frame", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbin",
            parentIndex: null,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            orbit: null,
          },
          {
            index: 1,
            name: "Mun",
            parentIndex: 0,
            radius: 200_000,
            gravParameter: 6.5138398e10,
            orbit: {
              sma: 12_000_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 100,
            },
          },
        ],
      });
      // Vessel orbits Mun (index 1), diagram frame is Kerbin, off-frame.
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Test Ship",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 1,
      });
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 50_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 100,
        mu: 6.5138398e10,
        horizon: UNBOUNDED_HORIZON,
      });
    });
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(1),
    );
    // Scoped to this augment's own overlay `<svg>`, see the doc comment on
    // the earlier "anchors the commlink line" test for why a bare "line"
    // selector would also match SystemDiagram's own vessel-marker leader
    // line (not present here regardless, the vessel is off-frame).
    expect(
      document.querySelector('[aria-label="Fleet and comms overlay"] line'),
    ).toBeNull();
  });

  it("hides the commlink highlight when the Commlinks toggle is switched off", async () => {
    const user = userEvent.setup();
    await renderDiagram();
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.path", {
        hops: [{ from: "Test Ship", to: "KSC", kind: 0 }],
      });
    });

    // `getByTitle` only recognises a `<title>` child of the `<svg>` ROOT
    // element, not one nested inside a shape element (`<line>`), so the
    // commlink line's own `<title>` tooltip is asserted via a direct DOM
    // query instead. Scoped to this augment's own overlay `<svg>` for the
    // same reason as the earlier "anchors the commlink line" test.
    await waitFor(() => {
      expect(
        document.querySelector(
          '[aria-label="Fleet and comms overlay"] line > title',
        )?.textContent,
      ).toBe("Test Ship -> KSC");
    });

    const commlinksButton = screen.getByRole("button", { name: "Commlinks" });
    expect(commlinksButton.getAttribute("aria-pressed")).toBe("true");
    await user.click(commlinksButton);
    expect(commlinksButton.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => {
      expect(
        document.querySelector('[aria-label="Fleet and comms overlay"] line'),
      ).toBeNull();
    });
  });

  it("draws a pending-uplink pulse while the Command Traffic toggle is on, and none once switched off", async () => {
    const user = userEvent.setup();
    await renderDiagram();
    // `useUtNow()` tracks the view clock's undelayed estimate, anchored off
    // the `deliveredAt` of the most recently ingested sample ACROSS EVERY
    // topic (`ViewClock.observeSample`): not `validAt`, and not this
    // fixture's `pinnedUt` (that only affects `useViewUt()`'s DELAYED read).
    // Overriding `deliveredAt: 95` here anchors `utNow` at 95 for the
    // assertions below (dispatchedAt 90 + oneWaySeconds 5 = still in the
    // outbound leg at t=95).
    act(() => {
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "cmd-1",
              command: "kos.run",
              label: "",
              topic: "kos/1",
              vantage: "KSC",
              dispatchedAt: 90,
              oneWaySeconds: 5,
            },
          ],
        },
        { deliveredAt: 95 },
      );
    });

    await waitFor(() => {
      // The gradient pulse dot is keyed by the entry id, assert via the
      // gradient fill it uses (only present once a pulse actually renders).
      expect(
        document.querySelector(
          'circle[fill="url(#fleet-comms-pulse-gradient)"]',
        ),
      ).toBeTruthy();
    });

    const trafficButton = screen.getByRole("button", {
      name: "Traffic",
    });
    await user.click(trafficButton);
    expect(
      document.querySelector('circle[fill="url(#fleet-comms-pulse-gradient)"]'),
    ).toBeNull();
  });

  it("has no axe violations with both slots filled", async () => {
    // `renderDiagram()` already mounts the diagram with both slots filled and
    // its data emitted: a second mount of the same widget added nothing to
    // scan, and left a tree that was still mid-first-frame while axe's long
    // async traversal ran.
    const { container } = await renderDiagram();
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.path", {
        hops: [{ from: "Test Ship", to: "KSC", kind: 0 }],
      });
    });
    // Settle the geometry first so the scan sees the drawn overlay rather than
    // a half-built one.
    await waitFor(() => {
      expect(
        document.querySelector('[aria-label="Fleet and comms overlay"] line'),
      ).toBeTruthy();
    });
    // The helper, not a bare `await axe(...)`: `comms.link` rides `useTelemetry`
    // (the delayed `TimelineStore` frame), so the overlay keeps updating while
    // axe walks the DOM, and awaited bare those updates land outside act. The
    // badge used to be a later settle target that hid this; it is a contribution
    // now and no longer in this tree.
    await expectNoA11yViolations(container);
  });
});
