import {
  DashboardItemContext,
  getComponent,
  PerfBudget,
  registerStockBodies,
  useWidgetStreamStatus,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { PanelStatusProvider } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus genuinely running OFF THE STREAM (a real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`): no legacy
 * `DataSource` is registered anywhere in this file, so a value only reaches the
 * widget if it actually streamed.
 *
 * The rebooted widget runs a FULL-VECTOR suicide-burn solve client-side off the
 * streamed `vessel.flight` / `vessel.propulsion` / `vessel.orbit` channels plus
 * the static stock-body radius (`getBody`), with NO derived `vessel.state.
 * landing*` fields involved. This file proves the whole chain, subscription,
 * carried-channel promotion, derived `vessel.state` body resolution, and the
 * DOM render, works end to end on a real Mun descent, with the horizontal
 * component (the correctness fix) surfaced.
 *
 * `carriedChannels` mirrors `index.test.tsx`'s superset: the carried gate is
 * parent-channel-scoped, and `vessel.orbit` is emitted `{ quality:
 * Quality.Loaded }` so the MEASURED basis is live.
 */
const CARRIED = [
  "vessel.state",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.propulsion",
  "vessel.surface",
  "dv.summary",
  "comms.delay",
];

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };

describe("LandingStatus: full-vector solve genuinely runs off the stream", () => {
  /**
   * The contribution budgets, reset between tests.
   *
   * `Contributions "<slot>" entries recomputed/sec` is capped at 30, which is
   * ~7x a real 4 Hz stream. A spec emits its whole scenario in a handful of
   * milliseconds, so the thirty-odd frames this file replays land inside one
   * rolling second and every slot on the widget trips its cap at 31. The same
   * thirty-one frames take eight seconds in the app.
   *
   * Reset rather than raised: the threshold is right for the load it is
   * measuring, and widening it to fit a test's clock is how a budget stops
   * being able to see the regression it exists for.
   */

  // A chart in an unmeasured box draws nothing but "Chart too small to render",
  // and every plot on this widget is a chart now. jsdom lays nothing out, so the
  // observer has to be told a size. Same helper the snapshot harness uses.
  let restoreResizeObserver: () => void;
  afterEach(() => {
    restoreResizeObserver();
  });
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget(size?: { w: number; h: number }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "landing-stream" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent
              id="landing-stream"
              w={size?.w ?? 8}
              h={size?.h ?? 10}
            />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emitMunDescent() {
    stream.emit("system.bodies", {
      bodies: [
        {
          name: MUN.name,
          index: MUN.index,
          parentIndex: 0,
          radius: MUN.radius,
          orbit: null,
        },
      ],
    });
    stream.emit("vessel.identity", {
      vesselId: "test-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: MUN.index,
      launchUt: null,
    });
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: MUN.index,
        sma: 250_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: MUN.mu,
      },
      { quality: Quality.Loaded },
    );
    // h=5km, descending 50 m/s but carrying 540 m/s of (mostly horizontal)
    // surface speed: the whole point of the full-vector solve.
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 0,
      altitudeTerrain: 5000,
      verticalSpeed: -50,
      surfaceSpeed: 540,
      orbitalSpeed: 540,
      atmDensity: 0,
    });
    // aMax = availableThrust/totalMass = 20 m/s^2.
    stream.emit("vessel.propulsion", {
      totalMass: 1,
      dryMass: 0.5,
      currentThrust: 0,
      availableThrust: 20,
    });
  }

  it("renders the Mun descent board off the derived vessel.state + streamed flight/propulsion", async () => {
    const { container } = renderWidget();

    // Nothing arrived yet: the empty state shows.
    expect(visibleText(container)).toContain("No landing in progress");
    // A real subscription must have happened for StubTransport (which is
    // subscription-gated) to deliver at all.
    expect(stream.transport.isSubscribed("vessel.flight")).toBe(true);

    act(() => {
      emitMunDescent();
    });

    // The altitude rail surfaces the streamed AGL datum (5000 m). It is a gauge
    // rather than a plot, so the reading is an `aria-valuenow` on a meter, and
    // nothing on the plots board draws height against a scale beside it.
    await waitFor(() =>
      expect(
        screen.getByRole("meter", { name: /altitude above terrain/i }),
      ).toHaveAttribute("aria-valuenow", "5000"),
    );
    // The velocity split is a readout, not a plot label: this scenario carries
    // no terrain patch, so the cross-section has no ground to slice and
    // contributes nothing rather than an empty box with the numbers on it.
    expect(container.textContent).toMatch(/538/);
    // The subtitle resolves the body off the derived vessel.state channel.
    expect(screen.getByText(/mun · vacuum/i)).toBeInTheDocument();
    // Empty state is gone once the descent is streaming.
    expect(container.textContent).not.toContain("No landing in progress");
  });

  // L2 (producer-consumer disagreement): the health badge must track the datum
  // the widget actually displays: vessel.surface (the lowest-point burn
  // height): not vessel.flight. vessel.surface is independently gated (withheld
  // while Orbiting/Escaping and under signal delay), so a badge bound to
  // vessel.flight read healthy even when the shown height had silently dropped
  // to the CoM fallback.
  it("badges on the withheld vessel.surface datum, not the live vessel.flight fallback (L2)", async () => {
    // Small size renders the plain AGL readout (at wide sizes altitude is the
    // full-height rail, which carries no "AGL" text).
    const { container } = renderWidget({ w: 4, h: 10 });

    // A full descent WITH flight flowing but vessel.surface WITHHELD: the
    // widget falls back to the CoM datum (usingComDatum) and keeps rendering.
    act(() => {
      emitMunDescent(); // emits vessel.flight, NOT vessel.surface
    });
    await screen.findByText("AGL");

    // The declaration is still asserted, because it still drives alarm
    // attribution: an alarm on the withheld datum has to reach this widget.
    expect(getComponent("landing-status")?.dataRequirements).toContain(
      "vessel.surface",
    );

    // NOT ASSERTED ANY MORE, and named rather than quietly dropped: that the
    // withheld datum is SURFACED to the operator. It used to be, by the
    // host-derived panel badge reading SYNCING while the fallback channel was
    // live. That badge is gone (one worst-of pill across every declared topic
    // could not say which topic was degraded, and read as a fault when there
    // was none), and nothing has replaced it here yet.
    //
    // So this widget currently degrades to the CoM fallback in silence. The
    // remaining assertions still prove the DERIVATION is right, which is the
    // half this file can prove; showing the operator it happened is the
    // widget's own job now and is not yet built.

    // Once vessel.surface arrives the shown AGL switches to the lowest-point
    // datum.
    act(() => {
      stream.emit("vessel.surface", { heightFromTerrain: 4800 });
    });
    await waitFor(() => expect(visibleText(container)).toContain("4.80 km"));
  });

  it("surfaces the round trip in the header, which is what replaced the warnings", async () => {
    // UNCOMMANDABLE and PAST COMMIT POINT were removed as two readings of one
    // fact. The round trip is the instrument datum underneath both, so it has
    // to be on screen for that removal to be a simplification rather than a
    // loss. It lives in the panel header beside the regime.
    renderWidget({ w: 12, h: 16 });
    act(() => {
      emitMunDescent();
      stream.emit("comms.delay", { source: 1, oneWaySeconds: 4 });
    });
    await waitFor(() => expect(screen.getByText(/^RT /)).toBeInTheDocument());
  });
});
