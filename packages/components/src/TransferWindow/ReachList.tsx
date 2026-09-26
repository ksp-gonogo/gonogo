import { value } from "@ksp-gonogo/sitrep-sdk";
import { Badge, NULL_DISPLAY, Text, Unit } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { type HeldSince, heldFigure } from "./heldFigure";
import {
  bodyLabel,
  fmtCountdown,
  fmtDays,
  VERDICT_LABEL,
  VERDICT_SEVERITY,
} from "./labels";
import { ListTitle, ListWrap, Muted } from "./layout";
import { type ReachEntry, reachVerdict } from "./transferData";

/**
 * The reach list: which destinations this craft can get to on its current
 * budget, cheapest first. The verdict column is DROPPED when there is no budget:
 * an empty column invites a verdict nobody can supply.
 */
export function ReachList({
  entries,
  originName,
  budgetDeltaV,
  reserveDeltaV,
  budgetNotCurrent,
  selectedIndex,
  onSelect,
  budgetHeldSince,
  budgetConfirmedAbsent,
  orbitHeldSince,
}: {
  entries: ReachEntry[];
  originName: string;
  budgetDeltaV: number | null;
  reserveDeltaV: number;
  budgetNotCurrent: boolean;
  /** Body index of the destination the windows list is currently scoped to. */
  selectedIndex: number;
  onSelect: (bodyIndex: number) => void;
  budgetHeldSince: HeldSince;
  budgetConfirmedAbsent: boolean;
  /** Each destination's Δv is costed from the parking orbit, so it holds with it. */
  orbitHeldSince: HeldSince;
}) {
  if (entries.length === 0) return null;
  const haveBudget = budgetDeltaV != null;

  return (
    <ListWrap>
      <ReachHead>
        <ListTitle id="reach-caption">Reach from {originName}</ListTitle>
        {/* The budget sits directly above the verdicts it produced, the funds-readout rule; `vac` stays because the ISP assumption is part of the figure. */}
        {budgetDeltaV != null && (
          <BudgetReadout>
            <Muted>Budget</Muted>{" "}
            <Unit
              value={heldFigure(value("m/s", budgetDeltaV), budgetHeldSince)}
              decimals={0}
            />{" "}
            vac
            {reserveDeltaV > 0 && (
              <Muted>
                {" reserve "}
                <Unit value={value("m/s", reserveDeltaV)} decimals={0} />
              </Muted>
            )}
          </BudgetReadout>
        )}
      </ReachHead>
      {/* Confirmed-absent means the stock sim has nothing, which is not the same as nothing heard. */}
      {budgetConfirmedAbsent && (
        <Text tone="warn" size="xs" role="status" aria-live="polite">
          No Δv figure for this craft: the stock simulation reports none, so
          costs are shown without a verdict.
        </Text>
      )}
      <ReachScroll>
        <ReachTable aria-describedby="reach-caption">
          <thead>
            <tr>
              <ReachTh scope="col">Destination</ReachTh>
              <ReachTh scope="col">Δv needed</ReachTh>
              {haveBudget && <ReachTh scope="col">Affords</ReachTh>}
              <ReachTh scope="col">Window</ReachTh>
              <ReachTh scope="col">Transit</ReachTh>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const verdict = reachVerdict(entry, budgetDeltaV, reserveDeltaV);
              return (
                <tr key={entry.body.index}>
                  <ReachTd>
                    <ReachPick
                      type="button"
                      $selected={entry.body.index === selectedIndex}
                      aria-pressed={entry.body.index === selectedIndex}
                      onClick={() => onSelect(entry.body.index)}
                    >
                      {bodyLabel(entry.body)}
                    </ReachPick>
                  </ReachTd>
                  <ReachTdNum>
                    {entry.totalDeltaV != null ? (
                      <Unit
                        value={heldFigure(
                          value("m/s", entry.totalDeltaV),
                          orbitHeldSince,
                        )}
                        decimals={0}
                      />
                    ) : (
                      NULL_DISPLAY
                    )}
                  </ReachTdNum>
                  {haveBudget && (
                    <ReachTd>
                      {verdict ? (
                        // A stale budget can only over-state reach, so dated verdicts do not wear the live GO colour.
                        <Badge
                          severity={
                            budgetNotCurrent
                              ? undefined
                              : VERDICT_SEVERITY[verdict]
                          }
                        >
                          {VERDICT_LABEL[verdict]}
                        </Badge>
                      ) : (
                        NULL_DISPLAY
                      )}
                    </ReachTd>
                  )}
                  <ReachTdNum>
                    {entry.waitSeconds != null
                      ? fmtCountdown(entry.waitSeconds)
                      : NULL_DISPLAY}
                  </ReachTdNum>
                  <ReachTdNum>
                    {entry.transferTimeSec != null
                      ? fmtDays(entry.transferTimeSec)
                      : NULL_DISPLAY}
                  </ReachTdNum>
                </tr>
              );
            })}
          </tbody>
        </ReachTable>
      </ReachScroll>
      <ReachFooter>
        Coplanar circular model, plane change not included. Capture circularises
        10 km above the destination's atmosphere.
      </ReachFooter>
    </ListWrap>
  );
}

/**
 * The destination cell as a `<button>`, so the row stays a row for a screen
 * reader and picking is keyboard-reachable. `aria-pressed` carries the scope,
 * since the visual cue is a colour.
 */
const ReachPick = styled.button<{ $selected: boolean }>`
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-align: left;
  color: ${(p) => (p.$selected ? "var(--color-accent-fg)" : "inherit")};

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ReachHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const BudgetReadout = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
`;

// Scrolls rather than clipping at narrow placements, so no column is lost silently; `min-width` keeps columns from collapsing.
const ReachScroll = styled.div`
  overflow-x: auto;
  max-width: 100%;
`;

const ReachTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-compact);
`;

const ReachTh = styled.th`
  text-align: left;
  /* Shared with ReachTd below, which has to match it. */
  padding: var(--inset-reach-cell);
  color: var(--color-text-muted);
  font-weight: normal;
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--color-border-subtle);

  &:not(:first-child) {
    text-align: right;
  }
`;

const ReachTd = styled.td`
  /* Matches ReachTh above. */
  padding: var(--inset-reach-cell);
  border-bottom: 1px solid var(--color-border-subtle);
  white-space: nowrap;
`;

const ReachTdNum = styled(ReachTd)`
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

const ReachFooter = styled.div`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;
