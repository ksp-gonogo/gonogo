/**
 * The browser half of `render-go-mark.ts`: mounts one sheet at a time and
 * marks it ready once React has committed it.
 *
 * `?sheet=<id>` picks which of `SHEETS` to draw, so all five PNGs come out of
 * one bundle and one page rather than five scripts.
 */
import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ComboboxListbox } from "../src/Combobox";
import { DivergingBar } from "../src/DivergingBar";
import { Meter } from "../src/Meter";
import { StatusPill } from "../src/Readout";
import { Switch } from "../src/Switch";
import { type GoMarkSheet, SHEETS } from "./goMarkScenarios";

const AT = value("ut", 42_000);

function live<U extends string>(v: Value<U>): Reading<Value<U>> {
  return {
    state: "observed",
    value: v,
    atUt: AT,
    reckoning: { status: "none" },
  };
}

function held<U extends string>(v: Value<U>): Reading<Value<U>> {
  return {
    state: "stale",
    value: v,
    asOfUt: AT,
    grade: "held-stale",
    reckoning: { status: "none" },
  };
}

const OPTIONS = [
  { key: "a", label: "Alpha" },
  { key: "b", label: "Bravo" },
  { key: "c", label: "Charlie" },
];

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure style={{ margin: 0, display: "grid", gap: 6 }}>
      <figcaption
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {label}
      </figcaption>
      {children}
    </figure>
  );
}

function Body({ id }: { id: string }) {
  switch (id) {
    case "combobox-selected":
      return (
        <>
          {/* A 30px band standing in for the owning input, with the dropdown
              positioned below it exactly as `DataKeyPicker` draws it. */}
          <div style={{ position: "relative", height: 30 }}>
            <ComboboxListbox
              id="probe"
              groups={[["Group", OPTIONS]]}
              flatOptions={OPTIONS}
              activeIndex={-1}
              selectedKey="b"
              getOptionId={(k) => `probe-${k}`}
              onHoverIndex={() => {}}
              onSelectKey={() => {}}
              ariaLabel="Probe combobox"
            />
          </div>
          {/* Reserves flow space for the dropdown above, which is
              position: absolute and so contributes nothing of its own to the
              sheet's height. */}
          <div style={{ height: 150 }} />
        </>
      );
    case "diverging-bar":
      return (
        <div style={{ display: "grid", gap: 16 }}>
          <Card label="live">
            <DivergingBar
              value={live(value("units/s", 4))}
              maxAbs={value("units/s", 10)}
            />
          </Card>
          <Card label="held">
            <DivergingBar
              value={held(value("units/s", 4))}
              maxAbs={value("units/s", 10)}
            />
          </Card>
        </div>
      );
    case "meter-go-fill":
      return (
        <div style={{ display: "grid", gap: 16 }}>
          <Card label="live">
            <Meter
              label="Battery"
              value={live(value("ratio", 0.7))}
              tone="go"
            />
          </Card>
          <Card label="held">
            <Meter
              label="Battery"
              value={held(value("ratio", 0.7))}
              tone="go"
            />
          </Card>
        </div>
      );
    case "readout-status-pill":
      return <StatusPill $tone="go">GO</StatusPill>;
    case "switch-checked":
      return <Switch checked onChange={() => {}} label="Armed" />;
    default:
      throw new Error(`no body for "${id}"`);
  }
}

function Sheet({ sheet }: { sheet: GoMarkSheet }) {
  return (
    <div
      data-sheet=""
      style={{
        width: sheet.width,
        padding: 20,
        background: "var(--color-surface-panel)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-mono)",
        display: "grid",
        gap: 16,
      }}
    >
      <h2
        style={{
          margin: 0,
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
          margin: 0,
          fontSize: 10,
          lineHeight: 1.5,
          color: "var(--color-text-muted)",
        }}
      >
        {sheet.blurb}
      </p>
      <Body id={sheet.id} />
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
