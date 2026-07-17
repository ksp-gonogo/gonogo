import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";

import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/**
 * `bodyName` and the four ballistic `land.*` scalars all come off the real,
 * client-derived `vessel.state`/`vessel.state.landing*` channel now (see
 * `stream.test.tsx`) — no legacy fallback at all — so these fixtures'
 * legacy keys are replayed as REAL physics inputs (body radius/mu, descent
 * rate, thrust) through a genuine `TelemetryProvider`, rather than declared
 * directly. `land.slopeAngle` is the ONE key with no wire home at all
 * (`index.tsx`'s own comment) — it stays on a legacy AUX.
 *
 * Each scenario below is tuned (not literally copied from the fixture's old
 * `land.*` numbers, which were hand-authored independent of any real
 * physics) to reproduce the SAME qualitative story the fixture's own `_meta`
 * notes describe — see each entry's comment for the resulting values. Two
 * genuinely can't-both-happen deviations, both documented at the call site:
 * `met`/`altitudeAsl`-style basis exclusivity doesn't apply here (LandingStatus
 * never reads `met`), but a "no solution while descending" scenario
 * (`pre-burn-cruise`/`high-speed-no-solution`) is reproduced by giving the
 * body a `null` radius — `resolveBodyRadius` then fails, which is exactly
 * `deriveLanding`'s real "can't resolve, no solution" path, and `bodyName`
 * still resolves (name-only lookup) so the subtitle survives.
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };
const KERBIN = { index: 1, name: "Kerbin", radius: 600_000, mu: 3.5316e12 };

interface Scenario {
  body: { index: number; name: string; radius: number | null; mu: number };
  descent?: {
    heightFromTerrain: number;
    verticalSpeed: number;
    surfaceSpeed: number;
    atmDensity?: number;
    atmosphericTemperature?: number;
    externalTemperature?: number;
  };
  availableThrust?: number;
  slopeAngle?: number | null;
}

const SCENARIOS: Record<string, Scenario> = {
  // Descending but no radius resolves (`radius: null`) -> deriveLanding's
  // real "can't resolve reference body" path, same qualitative "waiting for
  // a landing prediction" empty state the old fixture's `land.timeToImpact:
  // null` sentinel meant to depict.
  "pre-burn-cruise": {
    body: { ...MUN, radius: null },
    descent: {
      heightFromTerrain: 45_000,
      verticalSpeed: 18.3,
      surfaceSpeed: 20,
    },
    slopeAngle: null,
  },
  // Mun, h=2800m/vDown=42.5 m/s/aMax=3 -> timeToImpact≈38.1s,
  // speedAtImpact≈107.8 m/s, bestSpeedAtImpact=0 (burn fits),
  // suicideBurnCountdown≈31.4s (not urgent).
  "suicide-burn-approaching": {
    body: MUN,
    descent: { heightFromTerrain: 2800, verticalSpeed: 42.5, surfaceSpeed: 50 },
    availableThrust: 3,
    slopeAngle: 4.2,
  },
  // Mun, h=180m/vDown=8.1 m/s/aMax=1.9 -> timeToImpact≈10.7s,
  // suicideBurnCountdown≈4.9s — inside the urgent (0,5] window (role=alert).
  "final-approach-mun": {
    body: MUN,
    descent: { heightFromTerrain: 180, verticalSpeed: 8.1, surfaceSpeed: 80 },
    availableThrust: 1.9,
    slopeAngle: 2.1,
  },
  // verticalSpeed=0 -> not descending -> LANDING_NONE regardless of radius;
  // "No landing in progress" (not the "waiting" variant).
  "landed-mun": {
    body: MUN,
    descent: { heightFromTerrain: 0.3, verticalSpeed: 0, surfaceSpeed: 0 },
    slopeAngle: null,
  },
  // Kerbin (atmospheric), h=28000m/vDown=210.4 m/s, no propulsion (a
  // passive reentry) -> timeToImpact≈57.1s, best/suicide stay null.
  // Ambient values are DIRECT vessel.flight reads, unchanged by migration.
  "kerbin-reentry-atmospheric": {
    body: KERBIN,
    descent: {
      heightFromTerrain: 28_000,
      verticalSpeed: 210.4,
      surfaceSpeed: 220,
      atmDensity: 0.087,
      atmosphericTemperature: 240.15,
      externalTemperature: 1850,
    },
    slopeAngle: 0.3,
  },
  // Same "radius doesn't resolve" trick as pre-burn-cruise, at a much
  // higher descent rate — "no landing prediction" while still descending.
  "high-speed-no-solution": {
    body: { ...MUN, radius: null },
    descent: {
      heightFromTerrain: 12_000,
      verticalSpeed: 350,
      surfaceSpeed: 350,
    },
    slopeAngle: null,
  },
};

async function snapshotLandingStatusFixture(
  scenario: Scenario,
  mode: { name: string; w: number; h: number },
): Promise<string> {
  registerStockBodies();
  const stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  const legacyAux = await setupMockDataSource({
    keys: [{ key: "land.slopeAngle" }],
  });

  const { container } = render(
    <stream.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <LandingStatusComponent id="snap" w={mode.w} h={mode.h} />
      </DashboardItemContext.Provider>
    </stream.Provider>,
  );

  act(() => {
    if (scenario.slopeAngle !== undefined) {
      legacyAux.source.emit("land.slopeAngle", scenario.slopeAngle);
    }
    stream.emit("system.bodies", {
      bodies: [
        {
          name: scenario.body.name,
          index: scenario.body.index,
          parentIndex: 0,
          radius: scenario.body.radius,
          orbit: null,
        },
      ],
    });
    stream.emit("vessel.identity", {
      vesselId: "test-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: scenario.body.index,
      launchUt: null,
    });
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: scenario.body.index,
        sma: 250_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: scenario.body.mu,
      },
      { quality: 1 },
    );
    if (scenario.descent) {
      stream.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 0,
        altitudeTerrain: scenario.descent.heightFromTerrain,
        verticalSpeed: -scenario.descent.verticalSpeed,
        surfaceSpeed: scenario.descent.surfaceSpeed,
        orbitalSpeed: scenario.descent.surfaceSpeed,
        atmDensity: scenario.descent.atmDensity ?? 0,
        atmosphericTemperature: scenario.descent.atmosphericTemperature ?? 0,
        externalTemperature: scenario.descent.externalTemperature ?? 0,
      });
    }
    if (scenario.availableThrust !== undefined) {
      stream.emit("vessel.propulsion", {
        totalMass: 1,
        dryMass: 0.5,
        currentThrust: 0,
        availableThrust: scenario.availableThrust,
      });
    }
  });

  // vessel.state (and its derived landing scalars) only resolve once the
  // provider's ingest->beginFrame() rAF tick has run (the pinned view-clock's
  // first frame). Flush two rAF ticks — deterministic and mode-independent,
  // unlike a text-based gate: the body name lives in the subtitle, which is
  // size-gated off (`rows >= 6`) in the compact/landscape h=5 modes, so a
  // `waitFor(body.name)` would time out there even though the widget rendered
  // fine. Mirrors `widgetDomSnapshot.tsx`'s `flushProviderFrame`.
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

  const html = stripVolatile(container.innerHTML);
  teardownMockDataSource(legacyAux);
  return html;
}

const config = getWidget("landing-status");
if (!config) throw new Error("landing-status missing from widgets.ts");

describe("LandingStatus DOM snapshots", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotLandingStatusFixture(scenario, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
