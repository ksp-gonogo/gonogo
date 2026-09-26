import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  formatCompactNumber,
  getSizeBucket,
  registerComponent,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { stillTrue, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  Block,
  CommandButton,
  type CommandButtonHandle,
  Divider,
  ExpandableText,
  Grid,
  NULL_DISPLAY,
  Panel,
  ScrollArea,
  Section,
  speakQuantity,
  type TabDescriptor,
  Tabs,
  Unit,
  useContributions,
  usePanelDelay,
  useSlotBound,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import styled from "styled-components";
import {
  FundsDrain,
  netFundsPerDay,
  reportsFundsDrain,
} from "../shared/FundsDrain";
import {
  asQuantityish,
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";
import { resolveScreens } from "./screens";

const topics = defineTopicManifest({
  channels: ["career.status"],
  fields: [
    "career.status.strategies.all",
    "career.status.strategies.activationPatched",
    "career.status.economy.funds",
    "career.status.economy.reputation",
    "career.status.economy.science",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.upkeepPerDay",
  ],
});

type StrategiesConfig = Record<string, never>;

export interface Strategy {
  id: string;
  title: string;
  description: string;
  departmentName: string;
  isActive: boolean;
  factor: number;
  dateActivated: number;
  requiredReputation: number;
  initialCostFunds: number;
  initialCostScience: number;
  initialCostReputation: number;
  /** Reputation cost after KSP's nonlinear rep curve; what the player actually loses. */
  effectiveCostReputation: number;
  hasFactorSlider: boolean;
  factorSliderDefault: number;
  factorSliderSteps: number;
  /** Null when the question could not be put to the game at all, which is not a refusal. */
  canActivate: boolean | null;
  activateBlockedReason: string;
  /**
   * Who answered: `"screened"` is KSP's own check, `"derived"` is the same rules
   * applied one at a time while the Administration Building is shut, `"none"`
   * is nobody. The widget never arms on a derived verdict: a yes nobody
   * screened is not an answer.
   */
  activateVerdictSource: "screened" | "derived" | "none";
  canDeactivate: boolean;
  deactivateBlockedReason: string;
  effect: string;
}

/**
 * Parses the strategy list, accepting `department` or `departmentName`. An
 * absent `effectiveCostReputation` falls back to `initialCostReputation`.
 */
export function parseStrategies(raw: unknown): Strategy[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: Strategy[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : null;
    if (!id) continue;
    out.push({
      id,
      title: typeof e.title === "string" ? e.title : id,
      description: typeof e.description === "string" ? e.description : "",
      departmentName:
        typeof e.departmentName === "string"
          ? e.departmentName
          : typeof e.department === "string"
            ? e.department
            : "",
      isActive: e.isActive === true,
      factor: magnitudeOr(asQuantityish(e.factor), 0),
      dateActivated: magnitudeOr(asQuantityish(e.dateActivated), 0),
      requiredReputation: magnitudeOr(asQuantityish(e.requiredReputation), 0),
      initialCostFunds: magnitudeOr(asQuantityish(e.initialCostFunds), 0),
      initialCostScience: magnitudeOr(asQuantityish(e.initialCostScience), 0),
      initialCostReputation: magnitudeOr(
        asQuantityish(e.initialCostReputation),
        0,
      ),
      effectiveCostReputation:
        magnitudeOf(asQuantityish(e.effectiveCostReputation)) ??
        magnitudeOr(asQuantityish(e.initialCostReputation), 0),
      hasFactorSlider: e.hasFactorSlider === true,
      factorSliderDefault: magnitudeOr(asQuantityish(e.factorSliderDefault), 0),
      factorSliderSteps: magnitudeOr(asQuantityish(e.factorSliderSteps), 1),
      // Only a real boolean is an answer; absent and null both mean the question went unasked.
      canActivate: typeof e.canActivate === "boolean" ? e.canActivate : null,
      activateBlockedReason:
        typeof e.activateBlockedReason === "string"
          ? e.activateBlockedReason
          : "",
      // A career model that sends no source only ever answered from inside the building, so its verdicts are screened.
      activateVerdictSource:
        e.activateVerdictSource === "derived"
          ? "derived"
          : e.activateVerdictSource === "none"
            ? "none"
            : "screened",
      canDeactivate: e.canDeactivate === true,
      deactivateBlockedReason:
        typeof e.deactivateBlockedReason === "string"
          ? e.deactivateBlockedReason
          : "",
      effect: typeof e.effect === "string" ? e.effect : "",
    });
  }
  return out;
}

/**
 * Strips KSP's rich-text markup from strategy effect text and returns the
 * bullet lines under "Effects:", dropping the "Setup Cost:" block that
 * duplicates the explicit cost fields.
 */
export function parseEffectLines(raw: string): string[] {
  const stripped = raw
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .trim();
  const lines: string[] = [];
  for (const line of stripped.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (/^effects?:/i.test(t)) continue;
    if (/^setup cost:?/i.test(t)) break;
    if (t.startsWith("*")) {
      lines.push(t.slice(1).trim());
    } else {
      lines.push(t);
    }
  }
  return lines;
}

/** The lists one screenful of strategies is drawn as. */
function partition(strategies: readonly Strategy[]): {
  active: Strategy[];
  available: Strategy[];
  softBlocked: Strategy[];
  ineligible: Strategy[];
  unknown: Strategy[];
} {
  const inactive = strategies.filter((s) => !s.isActive);
  // A strategy nobody could judge is neither a yes nor a no.
  const answered = inactive.filter((s) => s.canActivate !== null);
  return {
    active: strategies.filter((s) => s.isActive),
    available: answered.filter(
      (s) => s.canActivate || s.activateBlockedReason === "",
    ),
    // The per-level active cap is a soft block: the strategy is eligible once the running one is deactivated.
    softBlocked: answered.filter(
      (s) =>
        !s.canActivate &&
        /active strategies at this level/i.test(s.activateBlockedReason),
    ),
    ineligible: answered.filter(
      (s) =>
        !s.canActivate &&
        s.activateBlockedReason !== "" &&
        !/active strategies at this level/i.test(s.activateBlockedReason),
    ),
    unknown: inactive.filter((s) => s.canActivate === null),
  };
}

/**
 * The one account a whole bucket shares, or null when they differ. A failed
 * reading usually fails the whole roster at once, so its reason is said once
 * above the list rather than repeated on every card.
 */
function sharedReason(strategies: readonly Strategy[]): string | null {
  const first = strategies[0]?.activateBlockedReason ?? "";
  if (first === "") return null;
  return strategies.every((s) => s.activateBlockedReason === first)
    ? first
    : null;
}

/**
 * Everything a screen needs to draw its share of the list. The state is held
 * by the widget, so switching screens keeps a half-set factor slider and an
 * armed button where the operator left them.
 */
interface ScreenSectionsProps {
  strategies: readonly Strategy[];
  /** Absent for the ungrouped widget. */
  screenId?: string;
  /** Whether each card names its department; false on a screen that is one department. */
  showDepartment?: boolean;
  /** Whether `career.strategy.activate` can commit a strategy the roster has no verdict for. */
  commitsUnanswered: boolean;
  funds: Quantityish | undefined;
  reputation: Quantityish | undefined;
  science: Quantityish | undefined;
  balancesNotCurrent: boolean;
  factorById: Record<string, number>;
  setFactorById: Dispatch<SetStateAction<Record<string, number>>>;
  activateCmd: CommandButtonHandle;
  deactivateCmd: CommandButtonHandle;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
}

function StrategiesComponent({
  w,
  h,
}: Readonly<ComponentProps<StrategiesConfig>>) {
  /*
   * The strategy list is a fact that only moves when the operator acts, so the
   * last list received is still the list. The balances are judgements: they
   * arm or refuse a control that spends them, so a stale balance is withheld.
   */
  const careerReading = topics.useTelemetry("career.status");
  const rosterRaw = stillTrue(careerReading, undefined)?.strategies;
  const stratsRaw = rosterRaw?.all;
  // Only an explicit false says the game's activation is its own; absent and null say nothing.
  const commitsUnanswered = rosterRaw?.activationPatched === false;
  // An affordability verdict may only rest on an observation.
  const economy =
    careerReading.state === "observed"
      ? careerReading.value.economy
      : undefined;
  const funds = economy?.funds;
  const reputation = economy?.reputation;
  const science = economy?.science;
  // Stale balances and a never-arrived economy both refuse Activate, but only one is about the link.
  const balancesNotCurrent = careerReading.state === "stale";
  // The standing funds rate beside Activate; stock reports none and it renders nothing.
  const netFunds = netFundsPerDay(economy);
  // An Administration Building action carries no vessel signal delay.
  const activateCmd = useCommand("career.strategy.activate", {
    vantage: META_VANTAGE,
  });
  const deactivateCmd = useCommand("career.strategy.deactivate", {
    vantage: META_VANTAGE,
  });
  usePanelDelay(activateCmd);
  usePanelDelay(deactivateCmd);

  const strategies = useMemo(() => parseStrategies(stratsRaw), [stratsRaw]);

  // With no screens contributed (stock), the widget draws ungrouped.
  const screenEntries = useContributions("strategies.screens");
  const screens = useMemo(
    () => resolveScreens(screenEntries, strategies ?? []),
    [screenEntries, strategies],
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [factorById, setFactorById] = useState<Record<string, number>>({});

  const bucket = getSizeBucket(w, h);
  const showSubtitle = (h ?? 8) >= 4;

  if (strategies === null) {
    return (
      <Panel
        panelTitle="Strategies"
        compactTitle={["ADMIN", "ADM"]}
        sections={
          showSubtitle ? (
            <Section full>
              <Empty>Awaiting career data...</Empty>
            </Section>
          ) : null
        }
      />
    );
  }

  /*
   * KSP silently lets a save carry more active strategies than the building's
   * level allows. The cap is inferred from the blocked-reason text across the
   * whole list, because it belongs to the building rather than to a screen.
   */
  const { active, softBlocked } = partition(strategies);

  const inferredCap = (() => {
    for (const s of softBlocked) {
      const m = s.activateBlockedReason.match(/(\d+)\s+active strategies/i);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  })();
  const overCap = inferredCap !== null && active.length > inferredCap;

  const sectionProps = {
    commitsUnanswered,
    funds,
    reputation,
    science,
    balancesNotCurrent,
    factorById,
    setFactorById,
    activateCmd,
    deactivateCmd,
    expandedId,
    setExpandedId,
  };

  if (bucket === "tiny") {
    const tinyFundsTitle = balancesNotCurrent
      ? "The funds balance is no longer current, so affordability is not being checked"
      : funds != null
        ? speakQuantity(funds, { decimals: 0 })
        : "No funds balance has arrived";
    return (
      <Panel
        panelTitle="Strategies"
        compactTitle={["ADMIN", "ADM"]}
        sections={
          <Section full>
            {/* Funds first, so an ellipsis cuts the active count, never the balance. */}
            <TinyFundsRow data-balance-row="" title={tinyFundsTitle}>
              <TinyFundsFigure>
                {balancesNotCurrent ? (
                  "funds not current"
                ) : funds != null ? (
                  <>
                    {formatCompactNumber(funds.magnitude, 0)}
                    <Unit>funds</Unit>
                  </>
                ) : (
                  // Activate refuses on an absent balance, so the row says so rather than vanish.
                  "funds unknown"
                )}
              </TinyFundsFigure>
              <TinyTally>
                <Sep>·</Sep>{" "}
                <Tally $overCap={overCap}>
                  {active.length} active
                  {overCap && ` / ${inferredCap}`}
                </Tally>
              </TinyTally>
            </TinyFundsRow>
            {/* Its own row: the balance row above ellipsises whatever is appended to it. */}
            {reportsFundsDrain(netFunds) && (
              <TinyDrainRow>
                <FundsDrain
                  funds={magnitudeOf(funds)}
                  netPerDay={netFunds}
                  compact
                />
              </TinyDrainRow>
            )}
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="Admin Building"
      compactTitle={["ADMIN", "ADM"]}
      panelAside={
        <Tally $overCap={overCap}>
          {active.length} active
          {overCap && ` / ${inferredCap}`}
        </Tally>
      }
      // One section: a tab strip beside anything reads as two widgets.
      sections={
        <Section full>
          {/* The balances live in the body, because the panel aside collapses at the default size. */}
          <BalanceRow data-balance-row="">
            {balancesNotCurrent ? (
              // One statement, since dashes are what an absent economy already renders.
              <NotCurrentTally title="The career balances are no longer current, so affordability is not being checked">
                balances not current
              </NotCurrentTally>
            ) : (
              <>
                <Tally>
                  <Balance balance={funds} unit="funds" />
                </Tally>
                {reportsFundsDrain(netFunds) && (
                  <>
                    <Sep>·</Sep>
                    <FundsDrain
                      funds={magnitudeOf(funds)}
                      netPerDay={netFunds}
                    />
                  </>
                )}
                {(w ?? 9) >= 6 && (
                  <>
                    <Sep>·</Sep>
                    <Tally>
                      <Balance balance={reputation} unit="rep" />
                    </Tally>
                    <Sep>·</Sep>
                    <Tally>
                      <Balance balance={science} unit="science" />
                    </Tally>
                  </>
                )}
              </>
            )}
          </BalanceRow>
          {screens.length === 0 ? (
            <ScreenSections {...sectionProps} strategies={strategies} />
          ) : (
            <Tabs
              tabs={screens.map(
                (screen): TabDescriptor => ({
                  id: screen.id,
                  label: screen.label,
                  content:
                    screen.lockedReason !== null ? (
                      <LockedScreen>{screen.lockedReason}</LockedScreen>
                    ) : (
                      <ScreenSections
                        {...sectionProps}
                        strategies={screen.strategies}
                        screenId={screen.id}
                        showDepartment={!screen.namesOneDepartment}
                      />
                    ),
                }),
              )}
              aria-label="Administration Building screens"
            />
          )}
        </Section>
      }
    />
  );
}

/**
 * One screenful of strategies: the Active / Available / Locked lists, plus
 * whatever an Uplink has bound to this screen's body. The ungrouped widget has
 * no `screenId` and so no body slot.
 */
function ScreenSections({
  strategies,
  screenId,
  showDepartment = true,
  commitsUnanswered,
  funds,
  reputation,
  science,
  balancesNotCurrent,
  factorById,
  setFactorById,
  activateCmd,
  deactivateCmd,
  expandedId,
  setExpandedId,
}: Readonly<ScreenSectionsProps>) {
  const { active, available, softBlocked, ineligible, unknown } =
    partition(strategies);
  const unknownReason = sharedReason(unknown);
  const bodyBound = useSlotBound("strategies.screen-body");
  // The available card and the unanswered one are the same card; only the note differs.
  const strategyRow = (s: Strategy, note?: string) => (
    <AvailableRow
      key={s.id}
      strategy={s}
      showDepartment={showDepartment}
      commitsUnanswered={commitsUnanswered}
      funds={magnitudeOf(funds)}
      reputation={magnitudeOf(reputation)}
      science={magnitudeOf(science)}
      balancesNotCurrent={balancesNotCurrent}
      factor={factorById[s.id] ?? s.factorSliderDefault}
      onFactorChange={(v) => setFactorById((prev) => ({ ...prev, [s.id]: v }))}
      activateCmd={activateCmd}
      expanded={expandedId === s.id}
      onToggleExpanded={() => setExpandedId(expandedId === s.id ? null : s.id)}
      note={note}
    />
  );
  return (
    <ScrollArea>
      {/* One box owns the whole screen's inset, the augment included. */}
      <ScreenInset data-strategies-screen-inset="">
        {/* Panel's own columnising, rebuilt: the tabbed body is one full section, which never columnises. */}
        <Grid cols={SCREEN_COLUMNS} gap="related-comfortable" align="start">
          <Section
            as="section"
            aria-label="Active"
            title="Active"
            gap="related-comfortable"
          >
            {active.length === 0 ? (
              <Empty>No active strategies.</Empty>
            ) : (
              active.map((s) => (
                <StrategyCard
                  key={s.id}
                  $active
                  title={s.title}
                  titleRight={
                    showDepartment ? (
                      <CardDept>{s.departmentName}</CardDept>
                    ) : undefined
                  }
                  footer={
                    <>
                      <FactorTag>
                        factor{" "}
                        <Unit value={value("%", s.factor * 100)} decimals={0} />
                      </FactorTag>
                      <CommandButton
                        handle={deactivateCmd}
                        args={{ strategyId: s.id }}
                        commandLabel={`Deactivate ${s.title}`}
                        label="Deactivate"
                        confirmLabel="Confirm deactivate"
                        pendingLabel="Deactivating..."
                        active
                        tone="go"
                        disabled={!s.canDeactivate}
                        title={
                          s.canDeactivate
                            ? "Deactivate this strategy"
                            : s.deactivateBlockedReason || "Cannot deactivate"
                        }
                      />
                    </>
                  }
                >
                  <StrategyDescription of={s} />
                  <EffectList>
                    {parseEffectLines(s.effect).map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: static effect text, never reordered
                      <EffectLine key={`${i}:${line}`}>{line}</EffectLine>
                    ))}
                  </EffectList>
                </StrategyCard>
              ))
            )}
          </Section>

          <Section
            as="section"
            aria-label="Available"
            title="Available"
            gap="related-comfortable"
          >
            {available.length === 0 && softBlocked.length === 0 ? (
              <Empty>No strategies available right now.</Empty>
            ) : (
              <>
                {available.map((s) => strategyRow(s))}
                {softBlocked.map((s) => (
                  <StrategyCard
                    key={s.id}
                    title={s.title}
                    titleRight={
                      showDepartment ? (
                        <CardDept>{s.departmentName}</CardDept>
                      ) : undefined
                    }
                  >
                    <BlockedNote>
                      Deactivate the running strategy first to enable this one.
                    </BlockedNote>
                  </StrategyCard>
                ))}
              </>
            )}
          </Section>

          {ineligible.length > 0 && (
            <Section
              as="section"
              aria-label="Locked"
              title="Locked"
              gap="related-comfortable"
            >
              {ineligible.map((s) => (
                <StrategyCard
                  key={s.id}
                  title={s.title}
                  titleRight={
                    showDepartment ? (
                      <CardDept>{s.departmentName}</CardDept>
                    ) : undefined
                  }
                >
                  <BlockedNote>{s.activateBlockedReason}</BlockedNote>
                </StrategyCard>
              ))}
            </Section>
          )}

          {/* Not part of Locked: a refusal is a fact about the save, an unknown is a reading that could not be taken. */}
          {unknown.length > 0 && (
            <Section
              as="section"
              aria-label="Eligibility unknown"
              title="Eligibility unknown"
              gap="related-comfortable"
            >
              {unknownReason !== null && (
                <BlockedNote>{unknownReason}</BlockedNote>
              )}
              {unknown.map((s) =>
                strategyRow(
                  s,
                  unknownReason === null ? s.activateBlockedReason : undefined,
                ),
              )}
            </Section>
          )}
        </Grid>

        {/* Outside the grid: an augment columnises its own sections against the full width. */}
        {screenId !== undefined && (
          <>
            {bodyBound && <Divider />}
            <AugmentSlot name="strategies.screen-body" props={{ screenId }} />
          </>
        )}
      </ScreenInset>
    </ScrollArea>
  );
}

/** A strategy's own blurb, cut to a couple of lines with the rest a press away: RP-1's run past 1,500 characters. */
function StrategyDescription({ of: s }: Readonly<{ of: Strategy }>) {
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
  balancesNotCurrent: boolean,
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
  if (balancesNotCurrent) {
    return "Career balances are no longer current, so affordability cannot be checked";
  }
  if (cantAfford) {
    return "Insufficient funds / science / reputation at this factor";
  }
  return unanswered
    ? "Set the factor, then confirm. The checks that could not be made here are made when you confirm."
    : "Set the factor, then confirm";
}

function AvailableRow({
  strategy: s,
  showDepartment,
  commitsUnanswered,
  funds,
  reputation,
  science,
  balancesNotCurrent,
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
  balancesNotCurrent: boolean;
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
          title={activateTitle(
            s,
            commitsUnanswered,
            balancesNotCurrent,
            cantAfford,
          )}
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
          <CostChip $insufficient={overBudget(scaledFunds, funds)}>
            <Unit value={value("funds", scaledFunds)} />
          </CostChip>
        )}
        {s.initialCostScience > 0 && (
          <CostChip $insufficient={overBudget(scaledScience, science)}>
            <Unit value={value("science", scaledScience)} />
          </CostChip>
        )}
        {s.initialCostReputation > 0 && (
          <CostChip
            $insufficient={overBudget(scaledRep, reputation)}
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

/**
 * One career balance on the header rail: the figure, or the null token beside
 * the currency's symbol, so three absent balances still say which is which.
 */
function Balance<U extends string>({
  balance,
  unit,
}: {
  balance: Value<U> | null | undefined;
  unit: U;
}) {
  if (balance === null || balance === undefined) {
    return (
      <>
        {NULL_DISPLAY}
        <Unit>{unit}</Unit>
      </>
    );
  }
  return <Unit value={balance} />;
}

const BalanceRow = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--gap-related);
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;

const Tally = styled.span<{ $overCap?: boolean }>`
  color: ${(p) =>
    p.$overCap
      ? "var(--color-status-warning-bg)"
      : "var(--color-text-primary)"};
  font-variant-numeric: tabular-nums;
  font-weight: ${(p) => (p.$overCap ? 700 : 400)};
`;

const NotCurrentTally = styled.span`
  color: var(--color-status-warning-bg);
  font-weight: 700;
`;

const Sep = styled.span`
  color: var(--color-text-dim);
`;

const TinyFundsRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  padding: var(--inset-tiny-row);
  font-size: var(--font-size-compact);
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
`;

/** The balance never gives up width: the tally beside it does. */
const TinyFundsFigure = styled.span`
  flex: none;
`;

const TinyTally = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TinyDrainRow = styled.div`
  padding: var(--inset-tiny-row);
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

/** The screen's one inset: no group inside pads itself, so the lists and an augment body line up. */
const ScreenInset = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--gutter-screen-body);
`;

/** `Panel`'s own column template; `auto-fit` collapses empty tracks, which `minColWidth` (auto-fill) would not. */
const SCREEN_COLUMNS = "repeat(auto-fit, minmax(min(13rem, 100%), 1fr))";

const Empty = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: var(--font-size-compact);
`;

/** `Block` rather than `Card`: an active strategy is a green border and tint, and a card's own ground would sit between them. */
const StrategyCard = styled(Block).attrs({
  // `forwardedAs`, not `as`, which would replace Block with a bare article.
  forwardedAs: "article" as const,
})<{ $active?: boolean }>`
  padding: var(--inset-surface);
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
  /* The tint an active card has never actually had: this read
     var(--color-status-go-muted) against a token nobody declared, so the
     declaration was invalid and the ground resolved to transparent.

     The token exists now, and it is very dark for a reason tokens.css states
     at length: the card's own --color-text-dim body text has half a ratio
     point of headroom over the 4.5:1 floor, so a green readable as green would
     take the text under it. The border carries the green; this carries the
     fact that the row is different. */
  background: ${({ $active }) =>
    $active ? "var(--color-status-go-muted)" : "transparent"};
`;

const CardDept = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  /* Truncate gracefully at narrow card widths instead of clipping
     mid-glyph (was reading as "OPERAT" with no ellipsis at
     compact-5x7). */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const ExpandToggle = styled.button`
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Description = styled.p`
  margin: var(--gap-caption) 0 var(--gap-sub-readout);
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
`;

const EffectList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const EffectLine = styled.li`
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
  &::before {
    content: "·";
    color: var(--color-text-dim);
    margin-right: var(--gap-trailing-mark);
  }
`;

const CostRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
  margin-top: var(--gap-caption);
`;

const CostChip = styled.span<{ $insufficient?: boolean }>`
  font-size: var(--font-size-compact);
  padding: var(--inset-chip);
  border-radius: var(--radius-pill);
  background: ${({ $insufficient }) =>
    $insufficient
      ? "var(--color-status-alert-muted)"
      : "var(--color-surface-raised)"};
  color: ${({ $insufficient }) =>
    $insufficient
      ? "var(--color-status-nogo-fg)"
      : "var(--color-text-primary)"};
  font-variant-numeric: tabular-nums;
`;

const FactorRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  margin-top: var(--gap-actions);
`;

/** A range input styled per engine, since a bare one paints differently in each and does not shrink in a flex row. */
const Slider = styled.input`
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 16px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;

  /* Both tracks: a stadium, not a corner, and the two must stay identical or
     Chromium and Firefox diverge. --radius-pill tracks the track height
     rather than freezing at one px value. */
  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--color-border-strong);
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    /* Off the spacing ladder: (4 - 14) / 2, i.e. half the difference between
       the track height above and this thumb's own size, so it is locked to
       two siblings and must track them rather than a rung. The Firefox thumb
       below carries no offset at all and the two must stay in step. */
    margin-top: -5px;
    border-radius: var(--radius-circle);
    background: var(--color-accent-fg);
  }

  &::-moz-range-track {
    width: 100%;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--color-border-strong);
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: none;
    border-radius: var(--radius-circle);
    background: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }

  &::-moz-focus-outer {
    border: 0;
  }
`;

const FactorLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const FactorTag = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
`;

const FactorValue = styled.span`
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
  min-width: 3em;
  text-align: right;
`;

/** The body of a locked screen; its tab stays selectable so the reason stays reachable. */
const LockedScreen = styled.p`
  margin: 0;
  padding: var(--inset-empty-state);
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  text-align: center;
`;

const BlockedNote = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  font-style: italic;
`;

registerComponent<StrategiesConfig>({
  id: "strategies",
  name: "Admin Building",
  description:
    "Administration Building strategies for career mode. Shows active commitments, their per-strategy effect bullets, and the available alternatives with cost previews scaled by the commitment-factor slider. With that building open KSP answers eligibility itself; with it shut the same rules are asked one at a time, which is enough to name what the career refuses but never enough to say yes. A strategy left unanswered can still be committed from here when no other mod has changed how activation works: the remaining checks are made when you confirm.",
  tags: ["career"],
  defaultSize: { w: 5, h: 9 },
  minSize: { w: 2, h: 2 },
  component: StrategiesComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
  contributionSlots: ["strategies.screens"],
  augmentSlots: ["strategies.screen-body"],
});

export { StrategiesComponent };
