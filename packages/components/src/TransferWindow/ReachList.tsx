import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  NULL_DISPLAY,
  type ReckoningMarking,
  ToggleButton,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { type HeldSince, heldFigure } from "../shared/heldFigure";
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
  ReachScroll,
  ReachTable,
  ReachTd,
  ReachTdNum,
  ReachTh,
} from "./styles";
import { type ReachEntry, reachVerdict } from "./transferData";

/** Why a budget figure is missing: the game confirmed it has none, none has arrived yet, or what arrived is not a number. */
export type BudgetGap = "absent" | "pending" | "unusable";

const BUDGET_GAP_TIP: Record<BudgetGap, string> = {
  absent:
    "The game has no delta-v figure for this craft right now, so destinations show cost only",
  pending: "Waiting for the craft's delta-v",
  unusable:
    "The game returned a delta-v figure that cannot be used, so destinations show cost only",
};

/**
 * The reach list: which destinations this craft can get to on its current
 * budget, cheapest first. The verdict column is dropped when there is no budget:
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
  budgetGap,
  orbitMarking,
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
  /** Why there is no budget figure, or null when there is one. */
  budgetGap: BudgetGap | null;
  /** Each destination's Δv is costed from the parking orbit, so it takes the orbit's mark. */
  orbitMarking: ReckoningMarking | null;
}) {
  if (entries.length === 0) return null;
  const haveBudget = budgetDeltaV != null;

  return (
    <ListWrap>
      <ReachHead>
        <ListTitle id="reach-caption">Reach from {originName}</ListTitle>
        {/* The budget sits directly above the verdicts it produced, the funds-readout rule; `vac` stays because the ISP assumption is part of the figure. */}
        {budgetGap !== null && (
          <BudgetReadout>
            <Muted>Budget</Muted>{" "}
            <Tooltip text={BUDGET_GAP_TIP[budgetGap]}>
              <Muted tabIndex={0}>{NULL_DISPLAY}</Muted>
            </Tooltip>
          </BudgetReadout>
        )}
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
                    <ToggleButton
                      size="sm"
                      pressed={entry.body.index === selectedIndex}
                      onClick={() => onSelect(entry.body.index)}
                    >
                      {bodyLabel(entry.body)}
                    </ToggleButton>
                  </ReachTd>
                  <ReachTdNum>
                    {entry.totalDeltaV != null ? (
                      <Unit
                        value={value("m/s", entry.totalDeltaV)}
                        marked={orbitMarking}
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
                          tone={
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
