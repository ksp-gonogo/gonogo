/**
 * The browser half of `render-orbit-spread.ts`: the real `OrbitDiagram` fed from
 * a real `TimelineStore` reading of `vessel.orbit` that carries a departure
 * envelope, so the band it draws came out of the orbit reckoner.
 *
 * `?mode=before` leaves the spread out, which is the diagram as it draws
 * without the change; `?mode=after` hands it over.
 */

import {
  solveSelfOrbit,
  TimelineStore,
  type TopicReading,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { createRoot } from "react-dom/client";
import { craftOnOrbit } from "../src/shared/craftOnOrbit";
import { OrbitDiagram } from "../src/shared/OrbitDiagram";
import { orbitSpread } from "../src/shared/orbitSpread";
import { SCENE_PERIOD, SCENES } from "./orbitSpreadScenarios";

const MU = 3.5316e12;
const SMA = 1_200_000;
const ECC = 0.3;
const LIGHT_TIME = 10;
const BODIES = {
  bodies: [{ index: 1, radius: value("m", 600_000) }],
};

function orbitPayload(driftMetres: number | null) {
  return {
    referenceBodyIndex: 1,
    sma: value("m", SMA),
    ecc: value("1", ECC),
    inc: value("°", 0),
    lan: value("°", 0),
    argPe: value("°", 40),
    meanAnomalyAtEpoch: value("rad", 0.4),
    epoch: value("ut", 0),
    mu: value("m³/s²", MU),
    horizon: {
      kind: 2,
      trajectoryKind: 2,
      untilUt: value("ut", SCENE_PERIOD),
      departure:
        driftMetres === null
          ? null
          : [
              {
                untilUt: value("ut", SCENE_PERIOD),
                metres: value("m", driftMetres),
                metresPerSecond: value("m/s", 0.01),
              },
            ],
    },
  };
}

function point<Payload>(validAt: number, payload: Payload) {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt + LIGHT_TIME,
      quality: Quality.OnRails,
      source: "vessel:probe",
    }),
    epoch: 0,
  };
}

const params = new URLSearchParams(location.search);
const scene = SCENES.find((s) => s.id === params.get("scene"));
if (!scene) throw new Error(`no scene "${params.get("scene")}"`);
const mode = params.get("mode") === "before" ? "before" : "after";

let wall = LIGHT_TIME;
const clock = new ViewClock({
  nowWall: () => wall,
  warpRate: () => 1,
  delaySeconds: () => LIGHT_TIME,
});
const store = new TimelineStore(clock);
store.setTransportConnected(false);
store.ingest("system.bodies", point(0, BODIES));
store.ingest("vessel.orbit", point(0, orbitPayload(scene.driftMetres)));
wall = scene.viewAfter;
store.beginFrame();
const reading: TopicReading<ReturnType<typeof orbitPayload>> =
  store.sampleReading("vessel.orbit");

const observed =
  reading.state === "observed" || reading.state === "held"
    ? reading.value
    : undefined;
const viewUt = value("ut", scene.viewAfter);
const solve = solveSelfOrbit(
  observed,
  reading.reckoning,
  BODIES,
  viewUt,
  undefined,
);
const merged =
  observed && reading.reckoning.status === "available"
    ? { ...observed, ...reading.reckoning.value }
    : observed;

function Tile() {
  return (
    <div
      data-sheet=""
      style={{
        width: 420,
        padding: 12,
        background: "var(--color-surface-base, #0d0d0d)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-sans, ui-sans-serif, system-ui)",
        fontSize: 11,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        {scene?.title} ({mode})
      </div>
      <div style={{ width: 396, height: 396 }}>
        {merged && (
          <OrbitDiagram
            variant="mini"
            sma={SMA}
            ecc={ECC}
            apoapsis={SMA * (1 + ECC)}
            periapsis={SMA * (1 - ECC)}
            craft={craftOnOrbit(reading, observed, solve)}
            spread={
              mode === "after" ? (orbitSpread(reading, observed) ?? null) : null
            }
            argPe={40}
            bodyRadius={600_000}
            held={
              reading.state === "held" &&
              reading.reckoning.status !== "available"
            }
          />
        )}
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
createRoot(rootEl).render(<Tile />);
requestAnimationFrame(() =>
  requestAnimationFrame(() => rootEl.setAttribute("data-sheet-ready", "1")),
);
