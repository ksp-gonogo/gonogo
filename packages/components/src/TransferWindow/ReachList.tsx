import { value } from "@ksp-gonogo/sitrep-sdk";
import { Badge, NULL_DISPLAY, Text, Unit } from "@ksp-gonogo/ui-kit";
import { type HeldSince, heldFigure } from "./heldFigure";
import {
  bodyLabel,
  fmtCountdown,
  fmtDays,
  VERDICT_LABEL,
  VERDICT_SEVERITY,
} from "./labels";
import {
  BudgetReadout,
  ListTitle,
  ListWrap,
  Muted,
  ReachFooter,
  ReachHead,
  ReachPick,
  ReachScroll,
  ReachTable,
  ReachTd,
  ReachTdNum,
  ReachTh,
} from "./styles";
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
  budgetHeld,
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
  budgetHeld: boolean;
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
                        // A held budget can only over-state reach, so dated verdicts do not wear the live GO colour.
                        <Badge
                          severity={
                            budgetHeld ? undefined : VERDICT_SEVERITY[verdict]
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
