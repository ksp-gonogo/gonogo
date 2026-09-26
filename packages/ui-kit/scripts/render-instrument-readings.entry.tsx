/**
 * The browser half of `render-instrument-readings.ts`: mounts one sheet at a
 * time and marks it ready once React has committed it.
 *
 * `?sheet=<id>` picks which of `SHEETS` to draw, so the PNGs come out of one
 * bundle and one page rather than one script each.
 *
 * `?bare=1` is the BEFORE side: every case is handed its plain quantity, which
 * is all the instruments could take before this change. The control sheet must
 * come out identical either way, and the other sheets show what the widening
 * made drawable.
 */
import {
  type Reading,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { createRoot } from "react-dom/client";
import { Dial } from "../src/Dial";
import { DivergingBar } from "../src/DivergingBar";
import { Gauge } from "../src/Gauge";
import { Tape } from "../src/Tape";
import {
  type InstrumentCase,
  type InstrumentSheet,
  SHEETS,
} from "./instrumentReadingScenarios";

const AT = value("ut", 42_000);

const bare = new URLSearchParams(location.search).get("bare") === "1";

function bandOf(c: InstrumentCase): UncertaintyBand | undefined {
  if (!c.band) return undefined;
  return {
    value: value(c.unit, c.at),
    lo: value(c.unit, c.band.lo),
    hi: value(c.unit, c.band.hi),
    kind: c.band.kind,
  };
}

/**
 * The case as it reaches the app: the figure on its own on the before side, and
 * the reading it arrived in on the after side.
 */
function figureOf(c: InstrumentCase): Value<string> | Reading<Value<string>> {
  const drawn = value(c.unit, c.at);
  if (bare) return drawn;
  const band = bandOf(c);
  const reckoning: Reading<Value<string>>["reckoning"] =
    band === undefined
      ? { status: "none" }
      : {
          status: "available",
          modelled: drawn,
          basis: "linear-dead-reckoning",
          band,
        };
  if (c.empty) return { state: "pending", reckoning: { status: "none" } };
  return c.stale
    ? {
        state: "stale",
        value: drawn,
        asOfUt: AT,
        grade: "held-stale",
        reckoning,
      }
    : { state: "observed", value: drawn, atUt: AT, reckoning };
}

function Instrument({ c }: { c: InstrumentCase }) {
  const figure = figureOf(c);
  const min = value(c.unit, c.min);
  const max = value(c.unit, c.max);
  if (c.instrument === "gauge") {
    return (
      <Gauge
        value={figure}
        min={min}
        max={max}
        width={140}
        height={80}
        ariaLabel={c.label}
      />
    );
  }
  if (c.instrument === "tape") {
    return (
      <Tape
        value={figure}
        min={min}
        max={max}
        width={92}
        height={150}
        tickStep={value(c.unit, (c.max - c.min) / 4)}
        ariaLabel={c.label}
      />
    );
  }
  if (c.instrument === "dial") {
    return (
      <Dial
        value={figure}
        min={min}
        max={max}
        width={110}
        height={110}
        ariaLabel={c.label}
      />
    );
  }
  return (
    <div style={{ containerType: "inline-size", width: 320 }}>
      <DivergingBar value={figure} maxAbs={value(c.unit, c.max)} />
    </div>
  );
}

function Case({ c }: { c: InstrumentCase }) {
  return (
    <figure
      style={{ margin: 0, display: "grid", gap: 4, justifyItems: "start" }}
    >
      <figcaption
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {c.label}
      </figcaption>
      <Instrument c={c} />
      <span
        style={{
          fontSize: 10,
          lineHeight: 1.4,
          color: "var(--color-text-faint)",
          minHeight: 14,
        }}
      >
        {c.note ?? ""}
      </span>
    </figure>
  );
}

function Sheet({ sheet }: { sheet: InstrumentSheet }) {
  return (
    <div
      data-sheet=""
      style={{
        width: sheet.width,
        padding: 20,
        background: "var(--color-surface-base, #0d0d0d)",
        color: "var(--color-text-primary)",
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
          color: "var(--color-text-muted)",
        }}
      >
        {sheet.blurb}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 18,
          alignItems: "end",
        }}
      >
        {sheet.cases.map((c) => (
          <Case key={c.label} c={c} />
        ))}
      </div>
    </div>
  );
}

const wanted = new URLSearchParams(location.search).get("sheet");
const sheet = SHEETS.find((s) => s.id === wanted);
if (!sheet) throw new Error(`no sheet "${wanted}"`);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
createRoot(rootEl).render(<Sheet sheet={sheet} />);
requestAnimationFrame(() =>
  requestAnimationFrame(() => rootEl.setAttribute("data-sheet-ready", "1")),
);
