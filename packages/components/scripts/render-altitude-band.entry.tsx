/**
 * The browser half of `render-altitude-band.ts`: one sheet of meters, each one
 * a REAL `TimelineStore` reading of `vessel.flight` taken on a descent below
 * the atmosphere interface.
 *
 * Nothing here hand-feeds a band. The rows differ only in their samples and in
 * how far past the anchor the frame is drawn, and whatever `Meter` marks on the
 * track came out of `core-reckoners.ts` asking `atmosphericAltitudeBandAt` for
 * the fit's own standard error. Run against an sdk without that, the same rows
 * draw the same bars with no marks, which is the whole of the comparison.
 *
 * ## There is no longer an adaptation
 *
 * This scene used to re-key each reading onto a tank spelling, because `Meter`
 * looked a band up at the payload root or at `"amount"` and the flight reckoner
 * keys this one at `"altitudeAsl"`. It takes a per-value `Reading` now, so the
 * row hands over `flight.altitudeAsl` and the band is the entry the model wrote
 * at that path, reached by the primitive with no re-addressing anywhere.
 *
 * The capacity the scene names is still the scene's: an altitude has no tank,
 * and the axis exists so a length can be drawn as a bar at all.
 */

import {
  TimelineStore,
  type TopicReading,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { Quality, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { Meter, MeterStack, writeQuantity } from "@ksp-gonogo/ui-kit";
import { createRoot } from "react-dom/client";
import { type Row, SHEETS, type Sheet } from "./altitudeBandScenarios";

const KERBIN_INDEX = 1;
const KERBIN_RADIUS = 600_000;
const KERBIN_MU = 3.5316e12;

const SYSTEM = {
  bodies: [
    {
      name: "Kerbin",
      index: KERBIN_INDEX,
      parentIndex: 0,
      radius: KERBIN_RADIUS,
      orbit: null,
      atmosphere: { depth: 70_000 },
    },
  ],
};

/**
 * A circular orbit well above the interface, so the conic is admissible on
 * every frame and the atmospheric branch is chosen by the observed altitude
 * rather than by the conic having quietly run out.
 */
const ORBIT = {
  referenceBodyIndex: KERBIN_INDEX,
  sma: value("m", 700_000),
  ecc: value("1", 0),
  inc: value("°", 0),
  lan: value("°", 0),
  argPe: value("°", 0),
  meanAnomalyAtEpoch: value("rad", 0),
  epoch: value("ut", 0),
  mu: value("m³/s²", KERBIN_MU),
  horizon: { kind: 1, trajectoryKind: 1 },
};

interface FlightSample {
  altitudeAsl: Value<"m">;
  verticalSpeed: Value<"m/s">;
  orbitalSpeed: Value<"m/s">;
  gForce: Value<"g">;
}

function point<T>(validAt: number, payload: T) {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      quality: Quality.OnRails,
      source: "vessel:descent",
    }),
    epoch: 0,
  };
}

/**
 * The store's reading of `vessel.flight` at `viewUt`, after the row's samples.
 *
 * The wall clock is advanced to each sample's own instant before it is
 * ingested: `ViewClock.observeSample` anchors the UT/wall fit where the packet
 * landed, so a run ingested without moving the wall reads every later frame
 * further ahead than the dial says.
 */
function read(row: Row): TopicReading<FlightSample> {
  let wall = 0;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.setMode("predicted");
  const store = new TimelineStore(clock);
  store.setTransportConnected(false);
  store.ingest("system.bodies", point(0, SYSTEM));
  store.ingest("vessel.orbit", point(0, ORBIT));
  for (const s of row.samples) {
    wall = s.at;
    store.ingest(
      "vessel.flight",
      point<FlightSample>(s.at, {
        altitudeAsl: value("m", s.altitudeAsl),
        verticalSpeed: value("m/s", s.verticalSpeed),
        orbitalSpeed: value("m/s", 2200),
        gForce: value("g", 2),
      }),
    );
  }
  wall = row.viewUt;
  store.beginFrame();
  return store.sampleReading<FlightSample>("vessel.flight");
}

/** What the model said about this row, in one line under its meter. */
function verdict(reading: TopicReading<FlightSample>): string {
  if (reading.reckoning.status !== "available") return "model declined";
  const band = reading.reckoning.bands?.altitudeAsl;
  if (!band) return "carried, no band offered";
  const halfWidth = band.hi.minus(band.lo).scaled(0.5);
  return `${band.kind}, ±${writeQuantity(halfWidth, { decimals: 2 })}`;
}

function RowView({ row }: { row: Row }) {
  const reading = read(row);
  return (
    <figure style={{ margin: 0, display: "grid", gap: 4 }}>
      {/* The FIELD reading, handed straight over. There is no longer a tank
          shape to fold the altitude into so the primitive can find its band:
          `flight.altitudeAsl` is a `Reading<Value<"m">>` carrying the model's
          entry at that exact path, and the capacity is the second prop it
          always wanted to be. */}
      <Meter
        label={row.label}
        value={reading.altitudeAsl}
        capacity={value("m", row.capacityM)}
      />
      <figcaption
        style={{
          fontSize: 10,
          lineHeight: 1.5,
          color: "var(--color-text-muted, #999)",
        }}
      >
        {row.note}: {verdict(reading)}
      </figcaption>
    </figure>
  );
}

function SheetView({ sheet }: { sheet: Sheet }) {
  return (
    <div
      data-sheet=""
      style={{
        width: 520,
        padding: 20,
        background: "var(--color-surface-base, #0d0d0d)",
        color: "var(--color-text-primary, #ddd)",
        fontFamily: "var(--font-family-sans, ui-sans-serif, system-ui)",
      }}
    >
      <h2
        style={{
          margin: "0 0 4px",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {sheet.title}
      </h2>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 10,
          lineHeight: 1.5,
          color: "var(--color-text-muted, #999)",
        }}
      >
        {sheet.blurb}
      </p>
      <MeterStack style={{ gap: 18 }}>
        {sheet.rows.map((row) => (
          <RowView key={row.label} row={row} />
        ))}
      </MeterStack>
    </div>
  );
}

const wanted = new URLSearchParams(location.search).get("sheet");
const sheet = SHEETS.find((s) => s.id === wanted);
if (!sheet) throw new Error(`no sheet "${wanted}"`);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
createRoot(rootEl).render(<SheetView sheet={sheet} />);
requestAnimationFrame(() =>
  requestAnimationFrame(() => rootEl.setAttribute("data-sheet-ready", "1")),
);
