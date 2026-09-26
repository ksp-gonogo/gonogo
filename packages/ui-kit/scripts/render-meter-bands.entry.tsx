/**
 * The browser half of `render-meter-bands.ts`: mounts one sheet at a time and
 * marks it ready once React has committed it.
 *
 * `?sheet=<id>` picks which of `SHEETS` to draw, so the four PNGs come out of
 * one bundle and one page rather than four scripts.
 */
import {
  type Reading,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { createRoot } from "react-dom/client";
import { Meter, MeterRowGroup, MeterStack } from "../src/Meter";
import { type MeterCase, type MeterSheet, SHEETS } from "./meterBandScenarios";

const AT = value("ut", 42_000);

/** The two halves of a case drawn from a tank, else `null`. */
function tankOf(
  c: MeterCase,
): { amount: Value<"units">; capacity: Value<"units"> } | null {
  if (!c.tank) return null;
  return {
    amount: value(c.tank.unit, c.tank.amount),
    capacity: value(c.tank.unit, c.tank.capacity),
  };
}

/**
 * The case as it reaches the app: a reading of the figure, with whatever band
 * a model would offer about it.
 *
 * The band the sheet DESCRIBES is a pair of fractions, because that is the axis
 * a reader judges it on. Which unit it has to arrive in is the primitive's
 * business, so it is minted here at the last moment: `ratio` for a fraction,
 * the tank's own unit for an amount.
 */
function readingOfCase<U extends string>(
  c: MeterCase,
  drawn: Value<U>,
  band: UncertaintyBand | undefined,
): Reading<Value<U>> {
  const reckoning: Reading<Value<U>>["reckoning"] =
    band === undefined
      ? { status: "none" }
      : {
          status: "available",
          modelled: drawn,
          basis: "linear-dead-reckoning",
          band,
        };
  if (!c.stale) return { state: "observed", value: drawn, atUt: AT, reckoning };
  // A gradeless stale reading omits `grade` rather than carrying a falsy one
  return c.gradeless
    ? { state: "stale", value: drawn, asOfUt: AT, reckoning }
    : {
        state: "stale",
        value: drawn,
        asOfUt: AT,
        grade: "held-stale",
        reckoning,
      };
}

function bandOf(
  c: MeterCase,
  mint: (fraction: number) => Value<string>,
): UncertaintyBand | undefined {
  if (!c.band) return undefined;
  return {
    value: mint(c.band.at ?? c.fraction),
    lo: mint(c.band.lo),
    hi: mint(c.band.hi),
    kind: c.band.kind,
  };
}

function Case({ c, layout }: { c: MeterCase; layout: MeterSheet["layout"] }) {
  const tank = tankOf(c);
  // A row case keeps the stack's columns through its caption box, so the
  // sheet's bars line up the way a widget's do.
  const Box = layout === "row" ? MeterRowGroup : "figure";
  return (
    <Box
      {...(layout === "row" ? { as: "figure" } : {})}
      style={
        layout === "row"
          ? { margin: 0, rowGap: 4 }
          : { margin: 0, display: "grid", gap: 4 }
      }
    >
      {tank ? (
        <Meter
          label={c.label}
          value={readingOfCase(
            c,
            tank.amount,
            bandOf(c, (f) => tank.capacity.scaled(f)),
          )}
          capacity={tank.capacity}
          tone={c.tone}
          fillColor={c.fillColor}
          layout={layout}
        />
      ) : (
        <Meter
          label={c.label}
          value={readingOfCase(
            c,
            value("ratio", c.fraction),
            bandOf(c, (f) => value("ratio", f)),
          )}
          tone={c.tone}
          fillColor={c.fillColor}
          layout={layout}
        />
      )}
      <figcaption
        style={{
          fontSize: 10,
          lineHeight: 1.4,
          color: "var(--color-text-faint)",
          minHeight: 14,
        }}
      >
        {c.note ?? ""}
      </figcaption>
    </Box>
  );
}

function Sheet({ sheet }: { sheet: MeterSheet }) {
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
      <MeterStack style={{ gap: 14 }}>
        {sheet.cases.map((c) => (
          <Case key={c.label} c={c} layout={sheet.layout} />
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
createRoot(rootEl).render(<Sheet sheet={sheet} />);
requestAnimationFrame(() =>
  requestAnimationFrame(() => rootEl.setAttribute("data-sheet-ready", "1")),
);
