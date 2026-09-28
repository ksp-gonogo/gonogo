import type { ComponentProps } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  Card,
  EmptyState,
  Meter,
  Panel,
  ReadoutCaption,
  Section,
  speakQuantity,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import {
  type BudgetSnapshot,
  formatRate,
  KIT_TONE,
  ratioOf,
  readSnapshots,
  TONE_COLOR,
  type Tone,
  toneOf,
} from "./budgets";
import {
  DOT,
  DOT_HEADLINE,
  DOT_ROW,
  DOT_SUMMARY,
  FOOTER,
  LIST,
} from "./styles";

export type PerfBudgetsConfig = Record<string, never>;

/** Live view of every registered `PerfBudget`, polled at 1 Hz so it does not compete with what it measures; each row reads under, approaching or over its threshold. */
export function PerfBudgetsComponent({
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

  // At small sizes the bars are unreadable, so collapse to a healthy-vs-over count.
  const cols = w ?? 6;
  const rows = h ?? 6;
  const showFullRows = rows >= 6 && cols >= 5;
  const showDots = !showFullRows && rows >= 4;

  if (snapshots.length === 0) {
    return (
      <Panel
        panelTitle="PERF BUDGETS"
        sections={
          <Section>
            <EmptyState>No budgets registered</EmptyState>
          </Section>
        }
      />
    );
  }

  const overCount = snapshots.filter((s) => toneOf(s) === "over").length;
  const tone: Tone = overCount > 0 ? "over" : "under";

  if (!showFullRows && !showDots) {
    return (
      <Panel
        panelTitle="PERF"
        sections={
          <Section>
            <BigReadout $tone={overCount > 0 ? "nogo" : "go"}>
              {overCount > 0 ? `${overCount} OVER` : `${snapshots.length} OK`}
              <ReadoutCaption>
                of {snapshots.length} budget{snapshots.length === 1 ? "" : "s"}
              </ReadoutCaption>
            </BigReadout>
          </Section>
        }
      />
    );
  }

  if (showDots) {
    return (
      <Panel
        panelTitle="PERF"
        sections={
          <Section>
            <div style={DOT_SUMMARY}>
              <div style={{ ...DOT_HEADLINE, color: TONE_COLOR[tone] }}>
                {overCount > 0
                  ? `${overCount} of ${snapshots.length} OVER`
                  : `${snapshots.length} OK`}
              </div>
              <div style={DOT_ROW}>
                {snapshots.map((s) => {
                  const t = toneOf(s);
                  return (
                    <span
                      key={s.name}
                      role="img"
                      aria-label={`${s.name}: ${t}`}
                      title={`${s.name}: ${t}`}
                      style={{ ...DOT, background: TONE_COLOR[t] }}
                    />
                  );
                })}
              </div>
            </div>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="PERF BUDGETS"
      sections={
        <Section>
          <ul style={LIST}>
            {snapshots.map((s) => {
              const ratio = ratioOf(s);
              const t = toneOf(s);
              return (
                <Card as="li" key={s.name} tone={KIT_TONE[t]}>
                  {/* A bare figure rather than a reading: the rate is measured in this tab, so it is always current. */}
                  <Meter
                    label={s.name}
                    value={value("ratio", ratio)}
                    fillColor={TONE_COLOR[t]}
                    valueLabelNode={
                      <span style={{ color: TONE_COLOR[t] }}>
                        {formatRate(s.rate)} / {formatRate(s.threshold)}{" "}
                        {s.unit}/
                        <Unit
                          value={value("s", s.windowMs / 1000)}
                          decimals={0}
                        />
                      </span>
                    }
                    valueLabel={`${formatRate(s.rate)} of ${formatRate(s.threshold)} ${s.unit} per ${speakQuantity(value("s", s.windowMs / 1000), { decimals: 0 })}`}
                  />
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
        </Section>
      }
    />
  );
}
