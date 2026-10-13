import {
  type CarriedCurrency,
  datedFrom,
  staticValue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  ExpandableText,
  Notice,
  NULL_DISPLAY,
  Slider,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { activationFactor, factorSliderOf, parseEffectLines } from "./parsing";
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
  StrategyName,
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

/** What activating this strategy costs, in each currency it charges, drawn against the career's balances. The price is the one the record carries, at the slider's default factor. */
export function StrategyCost({
  strategy: s,
  funds,
  reputation,
  science,
  rosterFrom,
  factor,
}: Readonly<{
  strategy: Strategy;
  funds: number | null;
  reputation: number | null;
  science: number | null;
  rosterFrom: readonly CarriedCurrency[];
  factor: number | null;
}>) {
  /*
   * The record carries each cost of an inactive strategy at the slider's default factor, and KSP prices a strategy by interpolating between a minimum and a maximum, which the record does not carry. A price at any other commitment is therefore unknown, and is drawn as the null token with no verdict.
   */
  const atRecordFactor =
    factor === null || s.factorSliderDefault === null
      ? factor === s.factorSliderDefault
      : Math.abs(factor - s.factorSliderDefault) < 1e-9;
  const priced = (cost: number | null): number | null =>
    atRecordFactor ? cost : null;
  const scaledFunds = priced(s.initialCostFunds);
  // Only a record that states every price as zero is free; a price it left out is unknown.
  const noListedCost =
    s.initialCostFunds === 0 &&
    s.initialCostScience === 0 &&
    s.initialCostReputation === 0;
  const scaledScience = priced(s.initialCostScience);
  const scaledRep = priced(s.initialCostReputation);

  // Fails closed: a non-finite cost and an absent or withheld balance are all unaffordable.
  const overBudget = (cost: number, balance: number | null) =>
    !Number.isFinite(cost) || balance === null || balance < cost;
  // The verdict a price draws: none without a current balance, since a held or absent one can say neither yes nor no.
  const affordVerdict = (
    cost: number | null,
    balance: number | null,
  ): "yes" | "no" | undefined => {
    if (balance === null || cost === null) return undefined;
    return overBudget(cost, balance) ? "no" : "yes";
  };

  // A cost chip carries the kit's `nogo` tone only once the verdict is actually "no"; an unknown balance stays untoned rather than reading as either afford or refusal.
  const costTone = (afford: "yes" | "no" | undefined) =>
    afford === "no" ? ("nogo" as const) : undefined;

  return (
    <>
      {!noListedCost && (
        <CostRow>
          {s.initialCostFunds !== 0 && (
            <CostChip
              size="sm"
              tone={costTone(affordVerdict(scaledFunds, funds))}
              data-afford={affordVerdict(scaledFunds, funds)}
            >
              {scaledFunds === null ? (
                NULL_DISPLAY
              ) : (
                <Unit
                  value={datedFrom(rosterFrom, value("funds", scaledFunds))}
                />
              )}
            </CostChip>
          )}
          {s.initialCostScience !== 0 && (
            <CostChip
              size="sm"
              tone={costTone(affordVerdict(scaledScience, science))}
              data-afford={affordVerdict(scaledScience, science)}
            >
              {scaledScience === null ? (
                NULL_DISPLAY
              ) : (
                <Unit
                  value={datedFrom(rosterFrom, value("science", scaledScience))}
                />
              )}
            </CostChip>
          )}
          {s.initialCostReputation !== 0 && (
            <CostChip
              size="sm"
              tone={costTone(affordVerdict(scaledRep, reputation))}
              data-afford={affordVerdict(scaledRep, reputation)}
            >
              {scaledRep === null ? (
                NULL_DISPLAY
              ) : (
                <Unit value={datedFrom(rosterFrom, value("rep", scaledRep))} />
              )}
            </CostChip>
          )}
        </CostRow>
      )}
      {noListedCost && (
        // Three zeros say nothing about a currency this record has no field for, such as a career mod's own currency. A plain note, so a list of them is not announced.
        <Notice tone="neutral" role="note">
          No funds, science or rep cost on this record
        </Notice>
      )}
    </>
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
  factor: number | null;
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
  const slider = factorSliderOf(s);
  const sentFactor = activationFactor(s, factor);
  return (
    <StrategyCard
      title={
        <StrategyName
          type="button"
          variant="text"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          {s.title}
        </StrategyName>
      }
      titleRight={
        showDepartment ? <CardDept>{s.departmentName}</CardDept> : undefined
      }
      footer={
        drawsOwnActions || sentFactor === null ? undefined : (
          <CommandButton
            handle={activateCmd}
            args={{ strategyId: s.id, factor: sentFactor }}
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
      {!drawsOwnActions && (
        <StrategyCost
          strategy={s}
          funds={funds}
          reputation={reputation}
          science={science}
          rosterFrom={rosterFrom}
          factor={factor}
        />
      )}
      {!drawsOwnActions && slider !== null && factor !== null && (
        <FactorRow>
          <FactorLabel>Factor</FactorLabel>
          <Slider
            min={slider.min}
            max={1}
            step={slider.step}
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
