import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import circularLko from "./__fixtures__/circular-lko.json";
import { CurrentOrbitComponent } from "./index";

/**
 * CurrentOrbit's M3 batch-2 behavior-preservation golden dual-run (mirrors
 * `ThermalStatus/dual-run.test.tsx`, batch 1): the SAME orbit state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`.
 *
 * `circular-lko` is chosen because it populates every field the widget
 * reads, including `showDiagram`'s default-true mini orbit diagram
 * (`hasOrbit` needs `o.ApR`/`o.PeR`, both GAPPED) — the widest MIXED-source
 * shape: 6 MAPPED fields (sma/eccentricity/inclination/argumentOfPeriapsis
 * raw off `vessel.orbit`, plus period/trueAnomaly/timeToAp/timeToPe/ApA/PeA
 * derived off `vessel.state` — M3 vessel-state-extend un-gapped all six)
 * coexisting with 4 GAPPED legacy-AUX fields (ApR/PeR/referenceBody/v.body)
 * feeding the SAME diagram and grid on one render.
 *
 * ApA/PeA/period/trueAnomaly/timeToAp/timeToPe are all DERIVED from the same
 * `vessel.orbit` elements (plus `system.bodies`' reference-body radius for
 * the two apsides) at the pinned `viewUt` — computed here with the exact
 * same formulas `vessel-state.ts` uses (never hand-picked magic numbers)
 * so the LEGACY leg's static `circular-lko` fixture values can be
 * overridden to match EXACTLY what the STREAM leg will independently
 * derive, keeping the dual-run byte-identical without relying on
 * coincidental rounding.
 */
afterEach(() => {
  cleanup();
});

// o.ApR/o.PeR migrated onto vessel.state (apoapsisRadius/periapsisRadius =
// sma·(1±ecc), the true apsis radius real Telemachus also returns) — so the
// stream leg now DERIVES them and the legacy leg reads element-consistent
// values (see the fixture overrides below). referenceBody/v.body stay here as
// still-legacy-AUX (string values, exact-match either way).
const GAPPED_KEYS = ["o.referenceBody", "v.body"] as const;

// The one orbit state driving BOTH legs. meanAnomalyAtEpoch: 0, epoch:
// PINNED_UT means meanAnomaly is exactly 0 (periapsis) at the pinned view
// time, so trueAnomaly is a clean 0° and timeToPe a clean 0s — no
// inverse-Kepler reconstruction needed to hit a specific legacy fixture
// angle. The reference body radius (600,000 m) is chosen to land ApA/PeA
// close to the original fixture's illustrative 85/80 km (implied by its own
// ApR - ApA / PeR - PeA = 600,000 m).
const PINNED_UT = 10;
const SMA = 682500;
const ECC = 0.00367;
const MU = 3.5316e12; // Kerbin's GM
const BODY_RADIUS = 600_000;
const PERIOD = 2 * Math.PI * Math.sqrt(SMA ** 3 / MU);
const MEAN_MOTION = Math.sqrt(MU / SMA ** 3);
const TIME_TO_AP = Math.PI / MEAN_MOTION; // meanAnomaly 0 -> π is half the period
const APOAPSIS_ALT = SMA * (1 + ECC) - BODY_RADIUS;
const PERIAPSIS_ALT = SMA * (1 - ECC) - BODY_RADIUS;

describe("CurrentOrbit — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same orbit state", async () => {
    const mode = { name: "default-9x18", w: 9, h: 18 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: CurrentOrbitComponent,
      fixture: {
        ...circularLko,
        "o.trueAnomaly": 0,
        "o.period": PERIOD,
        "o.timeToAp": TIME_TO_AP,
        "o.timeToPe": 0,
        "o.ApA": APOAPSIS_ALT,
        "o.PeA": PERIAPSIS_ALT,
        // ApR/PeR now migrated + derived (sma·(1±ecc)); feed the legacy leg
        // the same element-consistent radii so both legs render one geometry.
        "o.ApR": SMA * (1 + ECC),
        "o.PeR": SMA * (1 - ECC),
      },
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      // vessel.identity/system.bodies: vessel.state's carried-channels gate
      // is parent-channel-scoped (M3 vessel-state-extend grew
      // vesselStateChannel.inputs to four) — every field this widget now
      // reads off vessel.state needs all four carried, even the ones (like
      // period/timeToAp/timeToPe) that don't themselves consult
      // vessel.identity/system.bodies.
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
      ],
      pinnedUt: PINNED_UT,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-dual" }}>
          <CurrentOrbitComponent id="orbit-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          circularLko[key as keyof typeof circularLko],
        );
      }
      streamFixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: circularLko["o.sma"],
        ecc: circularLko["o.eccentricity"],
        inc: circularLko["o.inclination"],
        argPe: circularLko["o.argumentOfPeriapsis"],
        mu: MU,
        meanAnomalyAtEpoch: 0,
        epoch: PINNED_UT,
      });
      streamFixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: BODY_RADIUS,
            orbit: null,
          },
        ],
      });
    });

    // "Kerbin" alone isn't sufficient — that text comes from the legacy AUX
    // source's o.referenceBody, which can land before the STREAM leg's
    // mapped vessel.orbit/system.bodies emissions have actually propagated
    // through the store. Wait on a value the stream leg alone produces (the
    // inclination readout) so the race can't produce a false green.
    await waitFor(() => {
      if (!container.textContent?.includes("0.3°")) {
        throw new Error("stream leg has not rendered inclination yet");
      }
    });
    // Also wait on the period readout specifically — it's the field this
    // task un-gapped, and it only resolves once BOTH the emit above AND a
    // frame tick have landed (TelemetryProvider coalesces beginFrame() to
    // the next animation frame rather than firing synchronously).
    await waitFor(() => {
      if (!container.textContent?.includes("31m 25s")) {
        throw new Error("stream leg has not rendered period yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
