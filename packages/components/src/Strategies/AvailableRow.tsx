import {
  type CarriedCurrency,
  datedFrom,
  staticValue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  CommandButton,
  type CommandButtonHandle,
  ExpandableText,
  Notice,
  Slider,
  Tooltip,
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
  FactorLabel,
  FactorRow,
  FactorValue,
  StrategyCard,
} from "./styles";
import type { Strategy } from "./types";

/** A strategy's own blurb, cut to a couple of lines with the rest a press away: a career mod's can run past 1,500 characters. */
export function StrategyDescription({ of: s }: Readonly<{ of: Strategy }>) {
  if (!s.description) return null;
  return (
    <Description>
      <ExpandableText subject={s.title}>{s.description}</ExpandableText>
    </Description>
  );
}

export function AvailableRow({
  strategy: s,
  showDepartment,
  funds,
  reputation,
  science,
  rosterFrom,
  factor,
  onFactorChange,
  activateCmd,
  drawsOwnActions = false,
  expanded,
  onToggleExpanded,
  note,
}: {
  strategy: Strategy;
  showDepartment: boolean;
  funds: number | null;
  reputation: number | null;
  science: number | null;
  rosterFrom: readonly CarriedCurrency[];
  factor: number;
  onFactorChange: (v: number) => void;
  /** The shared activate handle; each row's `CommandButton` holds its own arm and in-flight state. */
  activateCmd: CommandButtonHandle;
  /**
   * True when the screen's own body carries the activate verb, so this card
   * draws no Activate button and none of what only that button spends: the
   * price, the no-cost note and the factor slider. The figures on the record
   * are stock's activation cost, which the body's own verb need not charge.
   */
  drawsOwnActions?: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** A standing account of this card's own state, on screen above the price. */
  note?: string;
}) {
  // KSP costs scale linearly with the commitment factor; a zero default falls back to unscaled rather than divide by zero.
  const factorScale =
    s.factorSliderDefault > 0 ? factor / s.factorSliderDefault : 1;
  const scaledFunds = s.initialCostFunds * factorScale;
  const noListedCost =
    s.initialCostFunds === 0 &&
    s.initialCostScience === 0 &&
    s.initialCostReputation === 0;
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

  // A cost chip carries the kit's `nogo` tone only once the verdict is actually "no"; an unknown balance stays untoned rather than reading as either afford or refusal.
  const costTone = (afford: "yes" | "no" | undefined) =>
    afford === "no" ? ("nogo" as const) : undefined;

  return (
    <StrategyCard
      title={
        <Button
          type="button"
          variant="text"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          {s.title}
        </Button>
      }
      titleRight={
        showDepartment ? <CardDept>{s.departmentName}</CardDept> : undefined
      }
      footer={
        drawsOwnActions ? undefined : (
          <CommandButton
            handle={activateCmd}
            args={{ strategyId: s.id, factor }}
            commandLabel={`Activate ${s.title}`}
            label="Activate"
            confirmLabel="Confirm activate"
            pendingLabel="Activating..."
          />
        )
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
      {!drawsOwnActions && !noListedCost && (
        <CostRow>
          {s.initialCostFunds > 0 && (
            <CostChip
              size="sm"
              tone={costTone(affordVerdict(scaledFunds, funds))}
              data-afford={affordVerdict(scaledFunds, funds)}
            >
              <Unit
                value={datedFrom(rosterFrom, value("funds", scaledFunds))}
              />
            </CostChip>
          )}
          {s.initialCostScience > 0 && (
            <CostChip
              size="sm"
              tone={costTone(affordVerdict(scaledScience, science))}
              data-afford={affordVerdict(scaledScience, science)}
            >
              <Unit
                value={datedFrom(rosterFrom, value("science", scaledScience))}
              />
            </CostChip>
          )}
          {s.initialCostReputation > 0 && (
            <Tooltip
              text={`Nominal ${writeQuantity(value("rep", s.initialCostReputation * factorScale))}; the rep curve bumps the real charge to ${writeQuantity(value("rep", scaledRep))}.`}
              focusable
            >
              <CostChip
                size="sm"
                tone={costTone(affordVerdict(scaledRep, reputation))}
                data-afford={affordVerdict(scaledRep, reputation)}
              >
                <Unit value={datedFrom(rosterFrom, value("rep", scaledRep))} />
              </CostChip>
            </Tooltip>
          )}
        </CostRow>
      )}
      {!drawsOwnActions && noListedCost && (
        // Three zeros say nothing about a currency this record has no field for, such as a career mod's own currency. A plain note, so a list of them is not announced.
        <Notice tone="neutral" role="note">
          No funds, science or rep cost on this record
        </Notice>
      )}
      {!drawsOwnActions && s.hasFactorSlider && (
        <FactorRow>
          <FactorLabel>Factor</FactorLabel>
          <Slider
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
            <Unit value={staticValue("%", factor * 100)} decimals={0} />
          </FactorValue>
        </FactorRow>
      )}
    </StrategyCard>
  );
}
