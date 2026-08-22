import type { ComponentProps } from "@ksp-gonogo/core";
import { PerfBudget, registerComponent } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  Card,
  EmptyState,
  Panel,
  ReadoutCaption,
  type ReadoutTone,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

type PerfBudgetsConfig = Record<string, never>;

interface BudgetSnapshot {
  name: string;
  rate: number;
  threshold: number;
  windowMs: number;
  unit: string;
  exceedanceCount: number;
}

/**
 * Live view of every registered `PerfBudget`. Polls 1 Hz so it doesn't
 * compete with the metrics it's measuring; each row colour-codes under
 * (green) / approaching (amber) / over (red) the threshold so a glance
 * tells you whether anything has regressed.
 *
 * Useful as a permanent fixture on the main screen during development
 * and load testing, and during real flights when you want to spot-check
 * that you're inside the soft caps.
 */
function PerfBudgetsComponent({
  w,
  h,
}: Readonly<ComponentProps<PerfBudgetsConfig>>) {
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>(() =>
    readSnapshots(),
  );

  useEffect(() => {
    const id = setInterval(() => setSnapshots(readSnapshots()), 1000);
    return () => clearInterval(id);
  }, []);

  // Selective rendering: at small sizes the bars are unreadable; collapse
  // to a healthy-vs-over count.
  const cols = w ?? 6;
  const rows = h ?? 6;
  const showFullRows = rows >= 6 && cols >= 5;
  const showDots = !showFullRows && rows >= 4;

  if (snapshots.length === 0) {
    return (
      <Panel panelTitle="PERF BUDGETS">
        <EmptyState>
          No budgets registered yet. Budgets self-register at module load; make
          sure the relevant services are imported.
        </EmptyState>
      </Panel>
    );
  }

  const overCount = snapshots.filter((s) => {
    const ratio = s.threshold > 0 ? s.rate / s.threshold : 0;
    return ratio >= 1;
  }).length;
  const tone: Tone = overCount > 0 ? "over" : "under";

  if (!showFullRows && !showDots) {
    return (
      <Panel panelTitle="PERF">
        <BigReadout $tone={overCount > 0 ? "alert" : "go"}>
          {overCount > 0 ? `${overCount} OVER` : `${snapshots.length} OK`}
          <ReadoutCaption>
            of {snapshots.length} budget{snapshots.length === 1 ? "" : "s"}
          </ReadoutCaption>
        </BigReadout>
      </Panel>
    );
  }

  if (showDots) {
    return (
      <Panel panelTitle="PERF">
        <div style={DOT_SUMMARY}>
          <div style={{ ...DOT_HEADLINE, color: TONE_COLOR[tone] }}>
            {overCount > 0
              ? `${overCount} of ${snapshots.length} OVER`
              : `${snapshots.length} OK`}
          </div>
          <div style={DOT_ROW}>
            {snapshots.map((s) => {
              const ratio = s.threshold > 0 ? s.rate / s.threshold : 0;
              const t: Tone =
                ratio >= 1 ? "over" : ratio >= 0.75 ? "near" : "under";
              return (
                <span
                  key={s.name}
                  title={s.name}
                  style={{ ...DOT, background: TONE_COLOR[t] }}
                />
              );
            })}
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel panelTitle="PERF BUDGETS">
      <ul style={LIST}>
        {snapshots.map((s) => {
          const ratio = s.threshold > 0 ? s.rate / s.threshold : 0;
          const t: Tone =
            ratio >= 1 ? "over" : ratio >= 0.75 ? "near" : "under";
          return (
            <Card as="li" key={s.name} tone={KIT_TONE[t]} style={BUDGET_CARD}>
              <div style={ROW_HEADER}>
                <span style={NAME}>{s.name}</span>
                <span style={{ ...RATE, color: TONE_COLOR[t] }}>
                  {formatRate(s.rate)} / {formatRate(s.threshold)} {s.unit}/
                  <Unit value={value("s", s.windowMs / 1000)} decimals={0} />
                </span>
              </div>
              <div style={BAR}>
                <div
                  style={{
                    ...BAR_FILL,
                    background: TONE_COLOR[t],
                    width: `${Math.min(100, ratio * 100).toFixed(1)}%`,
                  }}
                />
              </div>
              {s.exceedanceCount > 0 && (
                <div style={FOOTER}>
                  {s.exceedanceCount} exceedance
                  {s.exceedanceCount === 1 ? "" : "s"} since startup
                </div>
              )}
            </Card>
          );
        })}
      </ul>
    </Panel>
  );
}

function readSnapshots(): BudgetSnapshot[] {
  return PerfBudget.getAll().map((b) => ({
    name: b.name,
    rate: b.rate(),
    threshold: b.threshold,
    windowMs: b.windowMs,
    unit: b.unit,
    exceedanceCount: b.getExceedanceCount(),
  }));
}

function formatRate(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

type Tone = "under" | "near" | "over";

/** This widget's budget tones, mapped onto the kit's tone vocabulary. */
const KIT_TONE: Record<Tone, ReadoutTone> = {
  under: "go",
  near: "warning",
  over: "alert",
};

const TONE_COLOR: Record<Tone, string> = {
  under: "var(--color-accent-fg)",
  near: "var(--color-status-warning-bg)",
  over: "var(--color-status-nogo-bg)",
};

// Structural inline styles (CSS-var tokens): a bespoke budget list + dot
// summary, no reusable ui-kit primitive fits the layout, so it stays local.
// The one kit piece it reuses (Card) takes only this widget's column layout
// inline. Per-tone colour (text + fills) is applied inline at the call site
// from TONE_COLOR.

const LIST: CSSProperties = {
  listStyle: "none",
  // No top margin: Panel.Body supplies the inset and the gap between the title
  // and the first row.
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-8)",
};

// The card and its accent rule are the kit's; only the column this budget lays
// its header and bar out in is local.
const BUDGET_CARD: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

const ROW_HEADER: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--space-8)",
};

const NAME: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-status-go-fg)",
  wordBreak: "break-word",
};

// Per-tone `color` is applied inline at the call site.
const RATE: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  flexShrink: 0,
};

const BAR: CSSProperties = {
  height: "4px",
  background: "var(--color-surface-raised)",
  // A stadium, not a corner: the old 2px was exactly half the 4px height.
  // --radius-pill clamps to half the shorter side, so it renders the same and
  // keeps tracking the height instead of freezing at 2px.
  borderRadius: "var(--radius-pill)",
  overflow: "hidden",
};

// Per-tone `background` + `width` are applied inline at the call site. Off the
// motion scale on purpose: 0.5s is 2.5x the top of the UI band the tokens
// cover, and at that length ease-out and ease are plainly different curves, so
// the ease-out -> --ease-standard snap does not reach here. This is a
// determinate rate meter, the same class as ui-kit ProgressBar's fill.
const BAR_FILL: CSSProperties = {
  height: "100%",
  transition: "width 0.5s ease-out",
};

const FOOTER: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-status-nogo-bg)",
};

const DOT_SUMMARY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
  justifyContent: "center",
};

// Per-tone `color` is applied inline at the call site.
const DOT_HEADLINE: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: 700,
  letterSpacing: "0.04em",
};

const DOT_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-4)",
};

// Per-tone `background` is applied inline at the call site.
const DOT: CSSProperties = {
  width: "10px",
  height: "10px",
  borderRadius: "var(--radius-circle)",
};

registerComponent<PerfBudgetsConfig>({
  id: "perf-budgets",
  name: "Perf Budgets",
  description:
    "Live view of every registered PerfBudget: current rate vs soft cap, with exceedance counts. Updates 1 Hz. Useful for spotting performance regressions at a glance during development or real flights.",
  tags: ["debug", "perf"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
  component: PerfBudgetsComponent,
  dataRequirements: [],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { PerfBudgetsComponent };
