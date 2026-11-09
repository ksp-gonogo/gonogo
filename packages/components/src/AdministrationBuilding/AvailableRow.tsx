import {
  type CarriedCurrency,
  datedFrom,
  staticValue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Cluster,
  type CommandButtonHandle,
  DataLine,
  ExpandableText,
  NULL_DISPLAY,
  Slider,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { activationFactor, factorSliderOf, parseEffectLines } from "./parsing";
import {
  BlockedNote,
  CardDept,
  CostReadout,
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
  const noListedCost = !hasListedCost(s);
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

  // Only a verdict of "no" tones the figure; an unknown balance reads as neither afford nor refusal.
  const costTone = (afford: "yes" | "no" | undefined) =>
    afford === "no" ? ("nogo" as const) : undefined;

  if (noListedCost) {
    // Three zeros say nothing about a currency this record has no field for, such as a career mod's own currency, so the readout says "listed" rather than calling the strategy free.
    return (
      <CostReadout>
        <DataLine label="Cost">None listed</DataLine>
      </CostReadout>
    );
  }

  const figure = (
    label: string,
    cost: number | null,
    balance: number | null,
    unit: "funds" | "science" | "rep",
  ) => {
    const afford = affordVerdict(cost, balance);
    return (
      <DataLine label={label} tone={costTone(afford)} data-afford={afford}>
        {cost === null ? (
          NULL_DISPLAY
        ) : (
          <Unit value={datedFrom(rosterFrom, value(unit, cost))} />
        )}
      </DataLine>
    );
  };

  return (
    <CostReadout>
      {s.initialCostFunds !== 0 && figure("Funds", scaledFunds, funds, "funds")}
      {s.initialCostScience !== 0 &&
        figure("Science", scaledScience, science, "science")}
      {s.initialCostReputation !== 0 &&
        figure("Rep", scaledRep, reputation, "rep")}
    </CostReadout>
  );
}

/** True when the record lists a price in at least one currency, so the readout carries figures rather than the none-listed line. */
export function hasListedCost(s: Strategy): boolean {
  return !(
    s.initialCostFunds === 0 &&
    s.initialCostScience === 0 &&
    s.initialCostReputation === 0
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
  advise,
  badge,
}: {
  strategy: Strategy;
  showDepartment: boolean;
  funds: number | null;
  reputation: number | null;
  science: number | null;
  rosterFrom: readonly CarriedCurrency[];
  factor: number | null;
  onFactorChange: (v: number) => void;
  /** The shared activate handle; each row's a command `Button` holds its own arm and in-flight state. */
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
  /** Why the game is likely to refuse this activation; the button stays and the press is sent. */
  advise?: string;
  /** The strategy's whole-card status, drawn at the end of its title row beside the department, such as that it is locked. */
  badge?: ReactNode;
}) {
  const slider = factorSliderOf(s);
  const sentFactor = activationFactor(s, factor);
  const cost = (
    <StrategyCost
      strategy={s}
      funds={funds}
      reputation={reputation}
      science={science}
      rosterFrom={rosterFrom}
      factor={factor}
    />
  );
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
        showDepartment || badge ? (
          <Cluster justify="end" gap="related-packed" wrap>
            {showDepartment && <CardDept>{s.departmentName}</CardDept>}
            {badge}
          </Cluster>
        ) : undefined
      }
      footer={
        drawsOwnActions ? undefined : (
          <>
            {cost}
            {sentFactor !== null && (
              <Button
                command={activateCmd.with(
                  { strategyId: s.id, factor: sentFactor },
                  { label: `Activate ${s.title}` },
                )}
                variant="ghost"
                confirmLabel="Confirm activate"
                advise={advise}
              >
                Activate
              </Button>
            )}
          </>
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
