import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  ExpandableText,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { parseEffectLines } from "./parsing";
import {
  BlockedNote,
  CardDept,
  CostChip,
  CostRow,
  Description,
  EffectLine,
  EffectList,
  ExpandToggle,
  FactorLabel,
  FactorRow,
  FactorValue,
  Slider,
  StrategyCard,
} from "./styles";
import type { Strategy } from "./types";

/** A strategy's own blurb, cut to a couple of lines with the rest a press away: RP-1's run past 1,500 characters. */
export function StrategyDescription({ of: s }: Readonly<{ of: Strategy }>) {
  if (!s.description) return null;
  return (
    <Description>
      <ExpandableText subject={s.title}>{s.description}</ExpandableText>
    </Description>
  );
}

/**
 * What the Activate control says to a pointer resting on it. A refusal names
 * which kind it is, because the operator does something different about each:
 * a stale balance wants the link looked at, a short one wants funds.
 */
function activateTitle(
  s: Strategy,
  commitsUnanswered: boolean,
  balancesHeld: boolean,
  cantAfford: boolean,
): string {
  const unanswered = s.canActivate === null && commitsUnanswered;
  if (!unanswered) {
    if (s.canActivate !== true) {
      return s.activateBlockedReason || "Cannot activate";
    }
    if (s.activateVerdictSource !== "screened") {
      return "Nobody screened this answer, so it cannot be committed from here.";
    }
  }
  if (balancesHeld) {
    return "Affordability cannot be checked against a held balance";
  }
  if (cantAfford) {
    return "Insufficient funds / science / reputation at this factor";
  }
  return unanswered
    ? "Set the factor, then confirm. The checks that could not be made here are made when you confirm."
    : "Set the factor, then confirm";
}

export function AvailableRow({
  strategy: s,
  showDepartment,
  commitsUnanswered,
  funds,
  reputation,
  science,
  balancesHeld,
  factor,
  onFactorChange,
  activateCmd,
  expanded,
  onToggleExpanded,
  note,
}: {
  strategy: Strategy;
  showDepartment: boolean;
  /**
   * The career's activation is the game's own, so the command commits a
   * strategy with no verdict by putting every check itself when it runs.
   */
  commitsUnanswered: boolean;
  funds: number | null;
  reputation: number | null;
  science: number | null;
  /** Withheld because the balances went stale, rather than never having arrived. */
  balancesHeld: boolean;
  factor: number;
  onFactorChange: (v: number) => void;
  /** The shared activate handle; each row's `CommandButton` holds its own arm and in-flight state. */
  activateCmd: CommandButtonHandle;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** A standing account of this card's own state, on screen above the price. */
  note?: string;
}) {
  // KSP costs scale linearly with the commitment factor; a zero default falls back to unscaled rather than divide by zero.
  const factorScale =
    s.factorSliderDefault > 0 ? factor / s.factorSliderDefault : 1;
  const scaledFunds = s.initialCostFunds * factorScale;
  const scaledScience = s.initialCostScience * factorScale;
  const scaledRep = s.effectiveCostReputation * factorScale;

  // Fails closed: a non-finite cost and an absent or withheld balance are all unaffordable.
  const overBudget = (cost: number, balance: number | null) =>
    !Number.isFinite(cost) || balance === null || balance < cost;
  // The verdict a price draws: none without a current balance, since a held or absent one can say neither yes nor no.
  const affordVerdict = (
    cost: number,
    balance: number | null,
  ): "yes" | "no" | undefined => {
    if (balance === null) return undefined;
    return overBudget(cost, balance) ? "no" : "yes";
  };

  const cantAfford =
    (s.initialCostFunds > 0 && overBudget(scaledFunds, funds)) ||
    (s.initialCostScience > 0 && overBudget(scaledScience, science)) ||
    (s.initialCostReputation > 0 && overBudget(scaledRep, reputation));

  return (
    <StrategyCard
      title={
        <ExpandToggle
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          {s.title}
        </ExpandToggle>
      }
      titleRight={
        showDepartment ? <CardDept>{s.departmentName}</CardDept> : undefined
      }
      footer={
        <CommandButton
          handle={activateCmd}
          args={{ strategyId: s.id, factor }}
          commandLabel={`Activate ${s.title}`}
          label="Activate"
          confirmLabel="Confirm activate"
          pendingLabel="Activating..."
          /*
           * Arms on a screened yes, or on no verdict where the command re-runs
           * every check itself. A derived verdict never arms, yes or no.
           */
          disabled={
            !(
              (s.canActivate === true &&
                s.activateVerdictSource === "screened") ||
              (s.canActivate === null && commitsUnanswered)
            ) || cantAfford
          }
          title={activateTitle(s, commitsUnanswered, balancesHeld, cantAfford)}
        />
      }
    >
      <StrategyDescription of={s} />
      {expanded && (
        <EffectList>
          {parseEffectLines(s.effect).map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static effect text, never reordered
            <EffectLine key={`${i}:${line}`}>{line}</EffectLine>
          ))}
        </EffectList>
      )}
      {note && <BlockedNote>{note}</BlockedNote>}
      <CostRow>
        {s.initialCostFunds > 0 && (
          <CostChip
            $insufficient={affordVerdict(scaledFunds, funds) === "no"}
            data-afford={affordVerdict(scaledFunds, funds)}
          >
            <Unit value={value("funds", scaledFunds)} />
          </CostChip>
        )}
        {s.initialCostScience > 0 && (
          <CostChip
            $insufficient={affordVerdict(scaledScience, science) === "no"}
            data-afford={affordVerdict(scaledScience, science)}
          >
            <Unit value={value("science", scaledScience)} />
          </CostChip>
        )}
        {s.initialCostReputation > 0 && (
          <CostChip
            $insufficient={affordVerdict(scaledRep, reputation) === "no"}
            data-afford={affordVerdict(scaledRep, reputation)}
            title={`Nominal ${writeQuantity(value("rep", s.initialCostReputation * factorScale))}; the rep curve bumps the real charge to ${writeQuantity(value("rep", scaledRep))}.`}
          >
            <Unit value={value("rep", scaledRep)} />
          </CostChip>
        )}
        {s.initialCostFunds === 0 &&
          s.initialCostScience === 0 &&
          s.initialCostReputation === 0 && (
            // Three zeros say nothing about a currency this record has no field for, such as RP-1's Confidence.
            <CostChip>No funds, science or rep cost on this record</CostChip>
          )}
      </CostRow>
      {s.hasFactorSlider && (
        <FactorRow>
          <FactorLabel>Factor</FactorLabel>
          <Slider
            type="range"
            min={s.factorSliderDefault}
            max={1}
            step={
              (1 - s.factorSliderDefault) / Math.max(s.factorSliderSteps, 1)
            }
            value={factor}
            onChange={(e) => onFactorChange(Number.parseFloat(e.target.value))}
            aria-label={`Commitment factor for ${s.title}`}
          />
          <FactorValue>
            <Unit value={value("%", factor * 100)} decimals={0} />
          </FactorValue>
        </FactorRow>
      )}
    </StrategyCard>
  );
}
