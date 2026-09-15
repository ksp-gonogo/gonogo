/**
 * The browser half of `render-unit-currency.ts`: the not-current mark on
 * `<Unit>`, drawn in the place it is actually at risk.
 *
 * `?sheet=<id>` picks one of {@link SHEETS}, so every PNG comes out of one
 * bundle and one page.
 *
 * The `ruler` sheet is the load-bearing one. It stacks three CONTENT-SIZED
 * tables of the same figures (nothing marked, marked, and marked with a
 * deliberate in-flow dot beside the mark) and measures all three after layout,
 * because the objection this mark had to answer is that a glyph beside a value
 * reflows the column under it. The third table is the CONTROL: a ruler that
 * cannot see a reflow reports none, so the sheet plants one and shows the
 * ruler catching it.
 *
 * Nothing here reaches into `Unit`'s own markup beyond `[data-not-current]`,
 * which both treatments of this component have carried, so the same harness
 * renders the tree before this change and the tree after it.
 */
import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable, type DataTableColumn } from "../src/DataTable";
import { BigReadout, Readout, ReadoutCaption } from "../src/Readout";
import { Unit } from "../src/Unit";

/** An arbitrary but fixed instant, so the hover text is reproducible. */
const AT = value("ut", 1_000);

/*
 * Plain `Reading` literals rather than `topicReading(...)`.
 *
 * `Unit` takes the per-value reading, so there is no payload here to project
 * field properties from and the proxy a topic reading is built on has nothing
 * to do. A literal is also what a fixture SHOULD mint: it is the whole of what
 * the primitive reads.
 */
function observed<U extends string>(v: Value<U>): Reading<Value<U>> {
  return {
    state: "observed",
    reckoning: { status: "none" },
    value: v,
    atUt: AT,
  };
}

function held<U extends string>(v: Value<U>): Reading<Value<U>> {
  return {
    state: "stale",
    reckoning: { status: "none" },
    value: v,
    asOfUt: AT,
    grade: "held-stale",
  };
}

interface Craft {
  id: string;
  name: string;
  altitude: Value<"m">;
  speed: Value<"m/s">;
  temp: Value<"K">;
  /** Which of the three numeric columns are no longer readings of now. */
  stale: ReadonlyArray<"altitude" | "speed" | "temp">;
}

/**
 * Eight craft and three numeric columns: 24 cells, which is the density a
 * traffic or fleet table actually runs at. The magnitudes are deliberately
 * spread across the ladder so the columns are the widths a real one has.
 */
const FLEET: readonly Omit<Craft, "stale">[] = [
  {
    id: "a",
    name: "Kerbal-1",
    altitude: v("m", 82_400),
    speed: v("m/s", 2_284),
    temp: v("K", 291),
  },
  {
    id: "b",
    name: "Mun Relay",
    altitude: v("m", 1_204_000),
    speed: v("m/s", 542.8),
    temp: v("K", 178),
  },
  {
    id: "c",
    name: "Minmus Probe",
    altitude: v("m", 47_200_000),
    speed: v("m/s", 274.05),
    temp: v("K", 94.2),
  },
  {
    id: "d",
    name: "Station Core",
    altitude: v("m", 312_500),
    speed: v("m/s", 2_246.6),
    temp: v("K", 302.4),
  },
  {
    id: "e",
    name: "Lander 4",
    altitude: v("m", 1_820),
    speed: v("m/s", 48.4),
    temp: v("K", 318),
  },
  {
    id: "f",
    name: "Surveyor",
    altitude: v("m", 9_450_000),
    speed: v("m/s", 1_012.7),
    temp: v("K", 121.8),
  },
  {
    id: "g",
    name: "Tug Bravo",
    altitude: v("m", 640_000),
    speed: v("m/s", 1_890.2),
    temp: v("K", 265),
  },
  {
    id: "h",
    name: "Sounding-7",
    altitude: v("m", 138_600),
    speed: v("m/s", 3_402.9),
    temp: v("K", 344.1),
  },
];

function v<U extends string>(unit: U, magnitude: number): Value<U> {
  return value(unit, magnitude);
}

/** Which cells are held, per scene. Indexed by row, then column. */
type StaleMap = ReadonlyArray<Craft["stale"]>;

const NONE_STALE: StaleMap = FLEET.map(() => []);

/** Nine of the 24 numeric cells, spread so no column is wholly one thing. */
const SOME_STALE: StaleMap = [
  ["speed"],
  [],
  ["altitude", "speed", "temp"],
  ["temp"],
  [],
  ["altitude", "temp"],
  [],
  ["speed", "altitude"],
];

/** Nearly all of them: the "does a wall of dots read as noise" question. */
const MOST_STALE: StaleMap = [
  ["altitude", "speed", "temp"],
  ["altitude", "speed"],
  ["altitude", "speed", "temp"],
  ["altitude", "temp"],
  ["altitude", "speed", "temp"],
  ["altitude", "speed", "temp"],
  ["speed", "temp"],
  ["altitude", "speed", "temp"],
];

function rowsWith(map: StaleMap): Craft[] {
  return FLEET.map((c, i) => ({ ...c, stale: map[i] ?? [] }));
}

/**
 * A deliberate IN-FLOW dot, for the control table only.
 *
 * Same size and spacing as the real mark, rendered as an inline-block so it
 * takes part in the line box. This is what a suffix glyph does to a column,
 * and the number it produces is what makes the other two columns' numbers
 * mean something.
 */
function InFlowControlDot() {
  return (
    <span
      data-inflow-control-dot=""
      style={{
        display: "inline-block",
        width: "max(0.3em, 4px)",
        height: "max(0.3em, 4px)",
        marginLeft: "0.14em",
        borderRadius: "var(--radius-circle)",
        background: "var(--color-status-warning-bg)",
        verticalAlign: "super",
      }}
    />
  );
}

function cell<U extends string>(
  quantity: Value<U>,
  isStale: boolean,
  control: boolean,
) {
  return (
    <>
      <Unit value={isStale ? held(quantity) : observed(quantity)} />
      {control && isStale ? <InFlowControlDot /> : null}
    </>
  );
}

function columnsFor(control: boolean): DataTableColumn<Craft>[] {
  return [
    { key: "name", header: "Craft", render: (r) => r.name },
    {
      key: "altitude",
      header: "Altitude",
      align: "end",
      render: (r) => cell(r.altitude, r.stale.includes("altitude"), control),
    },
    {
      key: "speed",
      header: "Speed",
      align: "end",
      render: (r) => cell(r.speed, r.stale.includes("speed"), control),
    },
    {
      key: "temp",
      header: "Skin temp",
      align: "end",
      render: (r) => cell(r.temp, r.stale.includes("temp"), control),
    },
  ];
}

function FleetTable({
  map,
  control = false,
  className,
}: {
  map: StaleMap;
  control?: boolean;
  className?: string;
}) {
  return (
    <DataTable
      className={className}
      caption="Fleet telemetry"
      columns={columnsFor(control)}
      rows={rowsWith(map)}
      rowKey={(r) => r.id}
    />
  );
}

/** What one measured table came back as. Widths are CSS px, two decimals. */
interface TableMeasurement {
  variant: string;
  table: number;
  columns: Record<string, number>;
}

/**
 * Measure a content-sized table: the table's own border box, and each column's
 * body cell in the first row.
 *
 * `getBoundingClientRect` rather than `offsetWidth`, which rounds to an
 * integer and so would report "no change" for any reflow under half a pixel.
 */
function measure(root: HTMLElement, variant: string): TableMeasurement {
  const table = root.querySelector("table");
  if (!table) throw new Error(`${variant}: no table`);
  const headers = Array.from(table.querySelectorAll("thead th"));
  const firstRow = table.querySelector("tbody tr");
  if (!firstRow) throw new Error(`${variant}: no rows`);
  const cells = Array.from(firstRow.querySelectorAll("td"));
  const columns: Record<string, number> = {};
  headers.forEach((h, i) => {
    const td = cells[i];
    if (td)
      columns[h.textContent ?? String(i)] = round(
        td.getBoundingClientRect().width,
      );
  });
  return {
    variant,
    table: round(table.getBoundingClientRect().width),
    columns,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const RULER_VARIANTS = [
  {
    id: "none",
    title: "Every value current, nothing marked",
    map: NONE_STALE,
    control: false,
  },
  {
    id: "marked",
    title: "Nine of 24 held, marked with the out-of-flow dot",
    map: SOME_STALE,
    control: false,
  },
  {
    id: "marked+in-flow-control",
    title: "The same nine, plus a deliberate IN-FLOW dot (the ruler's control)",
    map: SOME_STALE,
    control: true,
  },
] as const;

/**
 * The reflow question, measured rather than argued.
 *
 * Content-sized (`width: max-content` on the wrapper, which beats the table's
 * own `width: 100%`), because that is where an intrinsic width change shows
 * up as a number instead of being absorbed by a fixed outer width.
 */
function Ruler() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [taken, setTaken] = useState<TableMeasurement[] | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setTaken(
      RULER_VARIANTS.map((v) => {
        const el = host.querySelector<HTMLElement>(`[data-variant="${v.id}"]`);
        if (!el) throw new Error(`${v.id}: not mounted`);
        return measure(el, v.id);
      }),
    );
  }, []);

  return (
    <div
      ref={hostRef}
      data-measurements={taken ? JSON.stringify(taken) : undefined}
      style={{ display: "grid", gap: 20 }}
    >
      {RULER_VARIANTS.map((v, i) => {
        const m = taken?.[i];
        return (
          <div key={v.id}>
            <div
              style={{
                color: "var(--color-text-faint)",
                font: "700 10px/1.6 ui-monospace, Menlo, monospace",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              {v.title}
            </div>
            <div data-variant={v.id} style={{ width: "max-content" }}>
              <FleetTable map={v.map} control={v.control} />
            </div>
            <div
              style={{
                color: "var(--color-text-muted)",
                font: "11px/1.7 ui-monospace, Menlo, monospace",
                marginTop: 4,
              }}
            >
              {m
                ? `table ${m.table.toFixed(2)}px  ${Object.entries(m.columns)
                    .map(([k, w]) => `${k} ${w.toFixed(2)}`)
                    .join("  ")}`
                : "measuring"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The mark across the type scale, which is the other thing a relative size can
 * get wrong: a dot sized in `em` has to stay a dot at 32px and still be a dot
 * rather than a smudge at 11px.
 */
function Sizes() {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {(["current", "held"] as const).map((which) => (
        <div key={which} style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              color: "var(--color-text-faint)",
              font: "700 10px/1.6 ui-monospace, Menlo, monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {which === "current" ? "A reading of now" : "The last real reading"}
          </div>
          <BigReadout>
            <Unit
              value={
                which === "held"
                  ? held(v("m/s", 2_284))
                  : observed(v("m/s", 2_284))
              }
            />
          </BigReadout>
          <Readout>
            <Unit
              value={
                which === "held"
                  ? held(v("m", 82_400))
                  : observed(v("m", 82_400))
              }
            />
          </Readout>
          <ReadoutCaption>
            skin&nbsp;
            <Unit
              value={
                which === "held" ? held(v("K", 291)) : observed(v("K", 291))
              }
            />
          </ReadoutCaption>
        </div>
      ))}
    </div>
  );
}

const SHEETS = [
  { id: "table-current", width: 560, node: <FleetTable map={NONE_STALE} /> },
  { id: "table-some-held", width: 560, node: <FleetTable map={SOME_STALE} /> },
  { id: "table-most-held", width: 560, node: <FleetTable map={MOST_STALE} /> },
  { id: "ruler", width: 640, node: <Ruler /> },
  { id: "sizes", width: 340, node: <Sizes /> },
] as const;

function Sheet({ id }: { id: string }) {
  const sheet = SHEETS.find((s) => s.id === id) ?? SHEETS[0];
  return (
    <div
      data-sheet={sheet.id}
      style={{
        width: sheet.width,
        padding: 16,
        background: "var(--color-surface-panel)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-mono)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      {sheet.node}
    </div>
  );
}

const id = new URLSearchParams(location.search).get("sheet") ?? SHEETS[0].id;
const host = document.getElementById("root");
if (!host) throw new Error("#root missing");
createRoot(host).render(<Sheet id={id} />);
/*
 * Two frames, not one: the ruler measures in a layout effect and writes the
 * numbers back as state, so a marker set on the first commit would let the
 * screenshot land on the "measuring" placeholder.
 */
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.body.setAttribute("data-sheet-ready", "");
  });
});
