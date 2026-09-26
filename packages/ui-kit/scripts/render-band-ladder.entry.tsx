/**
 * The browser half of `render-band-ladder.ts`: `<Band>` drawn at four
 * separations of its two ends.
 *
 * `?sheet=<id>` picks one of {@link SHEETS}, so every PNG comes out of one
 * bundle and one page, the same arrangement the meter-band and unit-currency
 * sheets use.
 */
import { value } from "@ksp-gonogo/sitrep-sdk";
import { createRoot } from "react-dom/client";
import { Band } from "../src/Band";
import { type BandLadderRow, SHEETS, type Sheet } from "./bandLadderScenarios";

function Row({ row }: { row: BandLadderRow }) {
  return (
    <figure style={{ margin: 0, display: "grid", gap: 2 }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--color-text-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {row.label}
      </div>
      <div style={{ fontSize: 20 }}>
        <Band min={value("m", row.lowM)} max={value("m", row.highM)} />
      </div>
      <figcaption
        style={{
          fontSize: 10,
          lineHeight: 1.5,
          color: "var(--color-text-muted)",
        }}
      >
        {row.note}
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
        display: "grid",
        gap: 18,
        background: "var(--color-surface-base, #0d0d0d)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-sans, ui-sans-serif, system-ui)",
      }}
    >
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 15 }}>{sheet.title}</h1>
        <p
          style={{
            margin: 0,
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--color-text-muted)",
          }}
        >
          {sheet.blurb}
        </p>
      </header>
      {sheet.rows.map((row) => (
        <Row key={row.label} row={row} />
      ))}
    </div>
  );
}

const id = new URLSearchParams(location.search).get("sheet") ?? SHEETS[0].id;
const sheet = SHEETS.find((s) => s.id === id);
if (!sheet) throw new Error(`no sheet ${id}`);

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(<SheetView sheet={sheet} />);
/*
 * Marks the sheet painted, which is what the driver waits on. Two frames
 * rather than one: the shared-format pass settles the group's digit count in a
 * layout effect, so a screenshot taken on the first frame catches the ends
 * before the ladder has spoken, which is the one thing this sheet is about.
 */
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.body.setAttribute("data-sheet-ready", "");
  });
});
