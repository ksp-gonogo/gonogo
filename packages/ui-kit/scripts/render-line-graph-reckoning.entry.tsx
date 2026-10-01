/**
 * The browser half of `render-line-graph-reckoning.ts`: one sheet holding every case.
 */
import type { SeriesReckonedSpan } from "@ksp-gonogo/sitrep-sdk";
import { createRoot } from "react-dom/client";
import { LineGraph, type LineGraphProps } from "../src/LineGraph";
import {
  CASES,
  RECKONED_FROM,
  RECKONED_TO,
  type ReckoningCase,
  seriesPoints,
  tailBand,
} from "./lineGraphReckoningScenarios";

function seriesOf(c: ReckoningCase): LineGraphProps["series"] {
  const points = seriesPoints();
  const base = {
    id: "alt",
    label: "Altitude",
    color: "var(--color-go-mark)",
    points,
  };
  if (c.tail === "none") return [base];
  const band = tailBand(points);
  const run: SeriesReckonedSpan = {
    from: RECKONED_FROM,
    to: RECKONED_TO,
    basis: "linear-dead-reckoning",
    bandLo: band.lo,
    bandHi: band.hi,
    bandKind: c.tail,
  };
  return [{ ...base, reckoned: [run] }];
}

function Sheet() {
  return (
    <div
      data-sheet=""
      style={{
        width: 460,
        padding: 20,
        background: "var(--color-surface-base, #0d0d0d)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-sans, ui-sans-serif, system-ui)",
      }}
    >
      {CASES.map((c) => (
        <figure key={c.id} style={{ margin: "0 0 18px" }}>
          <h2 style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 600 }}>
            {c.title}
          </h2>
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 10,
              color: "var(--color-text-muted)",
            }}
          >
            {c.note}
          </p>
          <LineGraph
            series={seriesOf(c)}
            variant={c.variant}
            height={c.variant === "sparkline" ? 56 : 110}
            ariaLabel={c.title}
          />
        </figure>
      ))}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
createRoot(rootEl).render(<Sheet />);
requestAnimationFrame(() =>
  requestAnimationFrame(() => rootEl.setAttribute("data-sheet-ready", "1")),
);
