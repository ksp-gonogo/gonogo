/**
 * The browser half of `render-meter-bands.ts`: mounts one sheet at a time and
 * marks it ready once React has committed it.
 *
 * `?sheet=<id>` picks which of `SHEETS` to draw, so the four PNGs come out of
 * one bundle and one page rather than four scripts.
 */
import {
  type MeterQuantity,
  type Reading,
  type ReckonedBands,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { createRoot } from "react-dom/client";
import { Meter, MeterStack } from "../src/Meter";
import { type MeterCase, type MeterSheet, SHEETS } from "./meterBandScenarios";

const AT = value("ut", 42_000);

/** The tank pair for a case that has one, else `null`. */
function tankOf(c: MeterCase): MeterQuantity<"units"> | null {
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
 * business, so it is minted here at the last moment: `ratio` at the root for a
 * fraction, the tank's own unit at `amount` for a pair.
 */
function readingOfCase<T>(
  c: MeterCase,
  drawn: T,
  bands: ReckonedBands | undefined,
): Reading<T> {
  const base = c.stale
    ? ({
        state: "stale",
        value: drawn,
        asOfUt: AT,
        grade: "held-stale",
      } as const)
    : ({ state: "observed", value: drawn, atUt: AT } as const);
  if (!bands) return { ...base, reckoning: "none" } as Reading<T>;
  return {
    ...base,
    reckoning: "available",
    reckoned: {
      value: drawn,
      atUt: AT,
      basis: "linear-dead-reckoning",
      modelled: [{ path: "", basis: "linear-dead-reckoning" }],
      owner: "core",
      bands,
    },
  } as Reading<T>;
}

function bandsAt(
  c: MeterCase,
  path: string,
  mint: (fraction: number) => Value<string>,
): ReckonedBands | undefined {
  if (!c.band) return undefined;
  return {
    [path]: {
      value: mint(c.band.at ?? c.fraction),
      lo: mint(c.band.lo),
      hi: mint(c.band.hi),
      kind: c.band.kind,
    },
  };
}

function Case({ c, size }: { c: MeterCase; size: "sm" | "md" }) {
  const tank = tankOf(c);
  return (
    <figure style={{ margin: 0, display: "grid", gap: 4 }}>
      {tank ? (
        <Meter
          label={c.label}
          size={size}
          quantity={readingOfCase(
            c,
            tank,
            bandsAt(c, "amount", (f) => tank.capacity.scaled(f)),
          )}
          tone={c.tone}
          fillColor={c.fillColor}
        />
      ) : (
        <Meter
          label={c.label}
          size={size}
          value={readingOfCase(
            c,
            c.fraction,
            bandsAt(c, "", (f) => value("ratio", f)),
          )}
          tone={c.tone}
          fillColor={c.fillColor}
        />
      )}
      <figcaption
        style={{
          fontSize: 10,
          lineHeight: 1.4,
          color: "var(--color-text-faint, #777)",
          minHeight: 14,
        }}
      >
        {c.note ?? ""}
      </figcaption>
    </figure>
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
      <MeterStack style={{ gap: 14 }}>
        {sheet.cases.map((c) => (
          <Case key={c.label} c={c} size={sheet.size} />
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
