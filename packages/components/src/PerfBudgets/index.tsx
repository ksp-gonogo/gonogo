import type { ComponentProps } from "@gonogo/core";
import { PerfBudget, registerComponent } from "@gonogo/core";
import { BigReadout, Panel, PanelTitle, ReadoutCaption } from "@gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";

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

  // Selective rendering — at small sizes the bars are unreadable; collapse
  // to a healthy-vs-over count.
  const cols = w ?? 6;
  const rows = h ?? 6;
  const showFullRows = rows >= 6 && cols >= 5;
  const showDots = !showFullRows && rows >= 4;

  if (snapshots.length === 0) {
    return (
      <Panel>
        <PanelTitle>PERF BUDGETS</PanelTitle>
        <Empty>
          No budgets registered yet. Budgets self-register at module load — make
          sure the relevant services are imported.
        </Empty>
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
      <Panel>
        <PanelTitle>PERF</PanelTitle>
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
      <Panel>
        <PanelTitle>PERF</PanelTitle>
        <DotSummary>
          <DotHeadline $tone={tone}>
            {overCount > 0
              ? `${overCount} of ${snapshots.length} OVER`
              : `${snapshots.length} OK`}
          </DotHeadline>
          <DotRow>
            {snapshots.map((s) => {
              const ratio = s.threshold > 0 ? s.rate / s.threshold : 0;
              const t: Tone =
                ratio >= 1 ? "over" : ratio >= 0.75 ? "near" : "under";
              return <Dot key={s.name} title={s.name} $tone={t} />;
            })}
          </DotRow>
        </DotSummary>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>PERF BUDGETS</PanelTitle>
      <List>
        {snapshots.map((s) => {
          const ratio = s.threshold > 0 ? s.rate / s.threshold : 0;
          const t: Tone =
            ratio >= 1 ? "over" : ratio >= 0.75 ? "near" : "under";
          return (
            <Row key={s.name} $tone={t}>
              <RowHeader>
                <Name>{s.name}</Name>
                <Rate $tone={t}>
                  {formatRate(s.rate)} / {formatRate(s.threshold)} {s.unit}/
                  {(s.windowMs / 1000).toFixed(0)}s
                </Rate>
              </RowHeader>
              <Bar>
                <BarFill
                  $tone={t}
                  style={{
                    width: `${Math.min(100, ratio * 100).toFixed(1)}%`,
                  }}
                />
              </Bar>
              {s.exceedanceCount > 0 && (
                <Footer>
                  {s.exceedanceCount} exceedance
                  {s.exceedanceCount === 1 ? "" : "s"} since startup
                </Footer>
              )}
            </Row>
          );
        })}
      </List>
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

const TONE_COLOR: Record<Tone, string> = {
  under: "var(--color-accent-fg)",
  near: "var(--color-status-warning-bg)",
  over: "var(--color-status-nogo-bg)",
};

// ── Styles ────────────────────────────────────────────────────────────────────

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-sm);
  padding: 8px 0;
`;

const List = styled.ul`
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Row = styled.li<{ $tone: Tone }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border-left: 2px solid ${(p) => TONE_COLOR[p.$tone]};
  border-radius: 2px;
`;

const RowHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
`;

const Name = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-status-go-fg);
  word-break: break-word;
`;

const Rate = styled.span<{ $tone: Tone }>`
  font-size: var(--font-size-xs);
  color: ${(p) => TONE_COLOR[p.$tone]};
  flex-shrink: 0;
`;

const Bar = styled.div`
  height: 4px;
  background: var(--color-surface-raised);
  border-radius: 2px;
  overflow: hidden;
`;

const BarFill = styled.div<{ $tone: Tone }>`
  height: 100%;
  background: ${(p) => TONE_COLOR[p.$tone]};
  transition: width 0.5s ease-out;
`;

const Footer = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-status-nogo-bg);
`;

const DotSummary = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
`;

const DotHeadline = styled.div<{ $tone: Tone }>`
  font-size: 13px;
  font-weight: 700;
  color: ${(p) => TONE_COLOR[p.$tone]};
  letter-spacing: 0.04em;
`;

const DotRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const Dot = styled.span<{ $tone: Tone }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${(p) => TONE_COLOR[p.$tone]};
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<PerfBudgetsConfig>({
  id: "perf-budgets",
  name: "Perf Budgets",
  description:
    "Live view of every registered PerfBudget — current rate vs soft cap, with exceedance counts. Updates 1 Hz. Useful for spotting performance regressions at a glance during development or real flights.",
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
