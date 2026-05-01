import type { ComponentProps } from "@gonogo/core";
import { PerfBudget, registerComponent } from "@gonogo/core";
import { Panel, PanelTitle } from "@gonogo/ui";
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
function PerfBudgetsComponent(_: Readonly<ComponentProps<PerfBudgetsConfig>>) {
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>(() =>
    readSnapshots(),
  );

  useEffect(() => {
    const id = setInterval(() => setSnapshots(readSnapshots()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Panel>
      <PanelTitle>PERF BUDGETS</PanelTitle>
      {snapshots.length === 0 ? (
        <Empty>
          No budgets registered yet. Budgets self-register at module load — make
          sure the relevant services are imported.
        </Empty>
      ) : (
        <List>
          {snapshots.map((s) => {
            const ratio = s.threshold > 0 ? s.rate / s.threshold : 0;
            const tone: Tone =
              ratio >= 1 ? "over" : ratio >= 0.75 ? "near" : "under";
            return (
              <Row key={s.name} $tone={tone}>
                <RowHeader>
                  <Name>{s.name}</Name>
                  <Rate $tone={tone}>
                    {formatRate(s.rate)} / {formatRate(s.threshold)} {s.unit}/
                    {(s.windowMs / 1000).toFixed(0)}s
                  </Rate>
                </RowHeader>
                <Bar>
                  <BarFill
                    $tone={tone}
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
      )}
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

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<PerfBudgetsConfig>({
  id: "perf-budgets",
  name: "Perf Budgets",
  description:
    "Live view of every registered PerfBudget — current rate vs soft cap, with exceedance counts. Updates 1 Hz. Useful for spotting performance regressions at a glance during development or real flights.",
  tags: ["debug", "perf"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 3 },
  component: PerfBudgetsComponent,
  dataRequirements: [],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { PerfBudgetsComponent };
