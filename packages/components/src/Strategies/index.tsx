import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  formatCompactNumber,
  getSizeBucket,
  registerComponent,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  type TopicReading,
  useCommand,
} from "@ksp-gonogo/sitrep-client";
import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
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
  /**
   * Null when the career model could not put the question to the game at all,
   * which is a different answer from a refusal and must not collapse into one.
   * `activateBlockedReason` carries the account either way.
   */
  canActivate: boolean | null;
  activateBlockedReason: string;
  /**
   * Who answered: `"screened"` is KSP's own check, `"derived"` is the same rules
   * put one at a time because the Administration Building was shut, `"none"` is
   * nobody.
   *
   * The career model pairs `"derived"` only with a refusal, never with a yes,
   * because the arm it cannot reach sits ahead of the ones it can. The widget
   * still refuses to arm anything that is not `"screened"`: the published type
   * admits the pair, and KSP's activation runs inside that building whatever we
   * worked out about eligibility, so such a control would dispatch something
   * that cannot land.
   */
  activateVerdictSource: "screened" | "derived" | "none";
  canDeactivate: boolean;
  deactivateBlockedReason: string;
  effect: string;
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: TopicReading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * Accepts BOTH the legacy `strategies.all` shape (`departmentName`) and
 * the new wire shape (`career.status.strategies.all`,
 * CareerViewProvider.BuildStrategyList: `department`): same field-rename
 * normalization ContractManager's `parseContracts` applies. Every other
 * field name matches the new wire 1:1 (decompile-confirmed),
 * including `effectiveCostReputation`
 * staying absent on the new wire: the fallback below to
 * `initialCostReputation` already covers that, unchanged.
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
      /* Three states, and only a real boolean is an answer. An absent field and
         an explicit null both mean the question went unasked. */
      canActivate: typeof e.canActivate === "boolean" ? e.canActivate : null,
      activateBlockedReason:
        typeof e.activateBlockedReason === "string"
          ? e.activateBlockedReason
          : "",
      /* An older career model sent no source at all. Treat that as screened:
         it only ever answered from inside the building, so every verdict it
         did send was the game's own. */
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
 * KSP strategy effect text ships with rich-text markup (`<color>`, `<b>`,
 * `<sprite>`, etc.) plus a "Setup Cost:" block that duplicates the
 * explicit cost fields. Strip tags, drop the redundant cost block, and
 * return just the bullet lines under "Effects:".
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

/**
 * The lists one screenful of strategies is drawn as. Split out of the component
 * so a tab can be partitioned on its own share of the list while the header
 * keeps partitioning the whole of it.
 */
function partition(strategies: readonly Strategy[]): {
  active: Strategy[];
  available: Strategy[];
  softBlocked: Strategy[];
  ineligible: Strategy[];
  unknown: Strategy[];
} {
  const inactive = strategies.filter((s) => !s.isActive);
  // Every other bucket is a reading of an ANSWER, so it is taken off the ones
  // that got one. A strategy nobody could judge belongs to neither the yeses
  // nor the noes, and filing it with the noes is the operator being told a
  // refusal that never happened.
  const answered = inactive.filter((s) => s.canActivate !== null);
  return {
    active: strategies.filter((s) => s.isActive),
    available: answered.filter(
      (s) => s.canActivate || s.activateBlockedReason === "",
    ),
    // "more than 1 active strategies at this level" is the soft cap, the
    // strategy IS eligible, just blocked by the active count. Keep those
    // visible in the Available list so the operator sees them as options once
    // they deactivate the running strategy.
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
 * The one account a whole bucket shares, or null when they differ.
 *
 * A reading that fails usually fails for the whole roster at once, because the
 * career-wide values every card's verdict rests on are read in one place. So
 * the per-card spelling of an unanswered list is one sentence repeated down the
 * screen. Said once above the list it is a statement about the reading, which is
 * what it actually is. Null when the cards genuinely disagree, and then each
 * says its own.
 */
function sharedReason(strategies: readonly Strategy[]): string | null {
  const first = strategies[0]?.activateBlockedReason ?? "";
  if (first === "") return null;
  return strategies.every((s) => s.activateBlockedReason === first)
    ? first
    : null;
}

/**
 * Everything a screen needs to draw its share of the list. The balances, the
 * command handles and the expand/factor state are the WIDGET's, held once and
 * handed down, so switching screens keeps a half-set factor slider and an armed
 * button exactly where the operator left them.
 */
interface ScreenSectionsProps {
  strategies: readonly Strategy[];
  /** Absent for the ungrouped widget; see `ScreenSections`'s own doc. */
  screenId?: string;
  /**
   * Whether each card names its department. False on a screen that IS one
   * department, where the chip is the tab's own name repeated onto every card in
   * it. Defaults true, which is the ungrouped widget: nothing else on screen says
   * which department a strategy belongs to, so the chip is the only thing that
   * does.
   */
  showDepartment?: boolean;
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
  // The whole career snapshot rides ONE
  // canonical Topic, `career.status` (CareerStatus). economy.{funds,
  // reputation,science} and strategies.all are the fields this widget reads,
  // the wire's `career.status.strategies.all` carries the full `id`/costs/
  // canActivate/canDeactivate/effect-text shape `parseStrategies` needs
  // (note `department`, not the legacy
  // `departmentName`, which parseStrategies normalizes). No legacy read
  // fallback: the canonical Topic read has none. The activate/deactivate COMMANDS
  // migrated too: `career.strategy.activate`/`.deactivate` through
  // `useCommand`, at the meta vantage.
  //
  // One record, two kinds of field, so it is read twice.
  //
  // The strategy list is a FACT. What the Administration building offers, what
  // each one costs, which are running: those move when the operator activates or
  // deactivates something, never on their own, so the last list received is still
  // the list. Withholding it would swap the whole widget for "Awaiting career
  // data..." over a roster that is demonstrably still on offer.
  //
  // The balances are JUDGEMENTS, because this widget does not merely print them:
  // `overBudget` turns each one into an affordability verdict that arms or
  // refuses a control which SPENDS them. Funds move on contract payouts, science
  // on transmissions, reputation on both, and none of that reaches us down a link
  // that has stopped delivering. Committing 500,000f against a figure we can no
  // longer vouch for is the exact harm the balance-visibility rule exists for, so
  // a stale balance is withheld and the refusal says why.
  const careerReading = topics.useTelemetry("career.status");
  const stratsRaw = stillTrue(careerReading, undefined)?.strategies?.all;
  /* A verdict may only rest on an observation, and `career.status` declares no
     reckonable value, so there is no model that could stand in for one. */
  const economy =
    careerReading.state === "observed"
      ? careerReading.value.economy
      : undefined;
  const funds = economy?.funds;
  const reputation = economy?.reputation;
  const science = economy?.science;
  /*
   * Distinguishes "the balances went stale" from "no economy has ever arrived".
   * Both blank the figures and both refuse Activate, but only one of them is a
   * statement about the link, and the operator acts differently on each.
   */
  const balancesNotCurrent = careerReading.state === "stale";
  /**
   * A strategy commits funds against a programme that may already be running a
   * standing cost, so the balance beside the Activate control is only half of
   * what the operator needs. The rate is whatever money model won the `economy`
   * capability; stock reports no such mechanism and this renders nothing.
   */
  const netFunds = netFundsPerDay(economy);
  // Activating/deactivating a strategy is an Administration-building action
  // with no vessel signal delay, so it dispatches at the meta-vantage
  // (instant). The handles are contributed to the panel delay rail by usePanelDelay.
  const activateCmd = useCommand("career.strategy.activate", {
    vantage: META_VANTAGE,
  });
  const deactivateCmd = useCommand("career.strategy.deactivate", {
    vantage: META_VANTAGE,
  });
  usePanelDelay(activateCmd);
  usePanelDelay(deactivateCmd);

  const strategies = useMemo(() => parseStrategies(stratsRaw), [stratsRaw]);

  /*
   * Which screens this building has. The widget draws the tab strip and nothing
   * decides what is in the strip except the contribution, so a stock career
   * (nobody contributing) gets the ungrouped widget it has always had, and every
   * screen an operator can see is one somebody stated deliberately.
   */
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
   * The cap is a property of the BUILDING, not of whichever screen is on display,
   * so it is inferred from the whole list even when the list is split across
   * tabs: an operator two strategies over a T2 cap is over it on every screen.
   */
  const { active, softBlocked } = partition(strategies);

  // Over-cap detection: the KSP UI silently allows a save to carry
  // more active strategies than the admin building's level allows
  // (see project_ksp_strategy_overcap_quirk). The blocked-reason text
  // encodes the cap, e.g. "more than 2 active strategies
  // at this level"; if any softBlocked strategy mentions a cap N and
  // we have more than N active, surface that visually so the operator
  // doesn't mistake the over-cap save for a fully-staffed T3 admin.
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

  // ── Tiny mode ─────────────────────────────────────────────────────────
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
            {/* Strategies spends career funds (activate cost), so the balance
                must stay visible even in the tiny bucket (CLAUDE.md "spending
                funds: always show the balance"). The active count rides at the
                END of the same row rather than in the panel aside: an aside that
                does not fit beside the title folds into a chevron row of its
                own, and in a 3x3 dashboard cell that row is the one the balance
                needed. Funds first, so an ellipsis cuts the count, never the
                balance. Compact k/M formatting plus nowrap keeps it to one line. */}
            <TinyFundsRow data-balance-row="" title={tinyFundsTitle}>
              <TinyFundsFigure>
                {balancesNotCurrent ? (
                  /* Withheld, and said so in the operator's own words. "funds
                   unknown" would accuse the link of never having delivered a
                   balance it did deliver, and a bare dash would leave the
                   refusal unexplained. */
                  "funds not current"
                ) : funds != null ? (
                  <>
                    {formatCompactNumber(funds.magnitude, 0)}
                    <Unit>funds</Unit>
                  </>
                ) : (
                  /* An absent balance is the state that rule exists for: it is
                   when the activate buttons refuse, so the row has to say so
                   rather than vanish and leave the refusal unexplained. */
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
            {/* Its own row rather than appended to the balance above: that row is
            nowrap + ellipsis by construction, so anything added to it is the
            part that gets cut. */}
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
      /* ONE section: the body is a screen switch, and a tab strip beside
         anything reads as two widgets rather than as one panel. */
      sections={
        <Section full>
          {/* Strategies spends career funds, so the balances live in the body,
              which keeps them at every width. The panel aside folds behind a
              chevron at the default size, which would hide a balance exactly
              where the operator is deciding to spend it. Funds always, rep and
              science where the row can hold them, or one statement in place of
              all three once they stop being current. */}
          <BalanceRow data-balance-row="">
            {balancesNotCurrent ? (
              /* One statement replaces all three figures. Three dashes would
                 read as a career with nothing in it, and dashes are already what
                 an absent economy renders, so the row has to name the link
                 instead of showing the operator the same nothing twice over. */
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
 * whatever an Uplink has bound to this screen's body.
 *
 * `screenId` is absent for the ungrouped widget, the shape it has when nobody
 * has said what screens this building owns. There is no `strategies.screen-body`
 * slot in that case because there is no screen to name, and `Panel`'s universal
 * `sections` segment is already the place to add to the widget as a whole.
 */
function ScreenSections({
  strategies,
  screenId,
  showDepartment = true,
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
  /* Said once above the unanswered list when they all share it, and on each
     card when they do not. */
  const unknownReason = sharedReason(unknown);
  /* Whether anything is bound to the body slot at all, so the rule that
     separates the widget's lists from an Uplink's body is not drawn across a
     stock career where there is nothing on the other side of it. */
  const bodyBound = useSlotBound("strategies.screen-body");
  /* The available card and the unanswered one are the same card: same price,
     same factor, same refusable control. Only the note above the price and the
     list it sits in differ. */
  const strategyRow = (s: Strategy, note?: string) => (
    <AvailableRow
      key={s.id}
      strategy={s}
      showDepartment={showDepartment}
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
      {/* ONE box owns the screen's inset, and everything on the screen is in
          it, the augment included. The augment slot used to be a bare sibling
          of three self-padding sections, so an Uplink's body sat 12px further
          left than the lists above it and the two halves of one screen read as
          two widgets. Nothing here carries a padding of its own now: the inset
          is this box's and only this box's. */}
      <ScreenInset data-strategies-screen-inset="">
        {/* Left to right when there is width for it, top to bottom when there
            is not. The same `auto-fit` + `minmax` mechanism Panel's own
            sections grid uses, at Panel's own 13rem column floor, because this
            screen cannot reach that grid: the tab strip means the whole body is
            one `Section full` as far as Panel is concerned, and a full section
            never columnises. `min(...,100%)` clamps the track to the panel so a
            narrow tile stacks rather than scrolling sideways. */}
        <Grid cols={SCREEN_COLUMNS} gap="md" align="start">
          <Section as="section" aria-label="Active" title="Active" gap="md">
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
                      // Effect lines are static, non-reorderable text; index keeps
                      // otherwise-identical lines from colliding.
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
            gap="md"
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
            <Section as="section" aria-label="Locked" title="Locked" gap="md">
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

          {/* Its own list, not a badge in Locked. What the career refuses and
              what nobody could ask are different KINDS of statement: the first
              is a fact about the save the operator has to go and change, the
              second is a fact about a reading that could not be taken. Filing
              them together is what put a whole roster under a heading reading
              LOCKED while every card under it said the state was unknown.

              This list used to be the WHOLE roster whenever the Administration
              Building was shut, because the only route to an answer ran through
              that screen. The arms are asked one at a time now, so a strategy
              reaches this list only when a reading genuinely failed, and the
              shared note above it says which one. The cards are the same cards
              as Available, price included, because the operator's next move is
              still to open the facility and spend. */}
          {unknown.length > 0 && (
            <Section
              as="section"
              aria-label="Eligibility unknown"
              title="Eligibility unknown"
              gap="md"
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

        {/* Outside the grid rather than a fourth cell in it: an augment brings
            its own sections and columnises them itself against the width it is
            given, and a cell would hand it a third of one. The rule says where
            the widget's own lists end and the Uplink's body begins, which the
            per-section dashed borders used to say before the grid made a
            border-per-cell read as an underline. */}
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

/**
 * A strategy's own blurb, cut to a couple of lines with the rest a press away.
 *
 * <para>Whatever the game's authors wrote, at whatever length: KSP's own
 * strategies are one sentence, RP-1's Programs run past 1,500 characters of
 * marked-up prose, and this widget draws one under every card in the list. On
 * the Administration Building's Programs screen that was a 5×9 tile rendering
 * 104,000 pixels tall.</para>
 *
 * <para>Both card shapes use this rather than a `Description` each, so the two
 * lists cut identically and the cut is one decision rather than two.</para>
 */
function StrategyDescription({ of: s }: Readonly<{ of: Strategy }>) {
  if (!s.description) return null;
  return (
    <Description>
      <ExpandableText subject={s.title}>{s.description}</ExpandableText>
    </Description>
  );
}

function AvailableRow({
  strategy: s,
  showDepartment,
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
  /** See `ScreenSections`'s own derivation of this. */
  showDepartment: boolean;
  funds: number | null;
  reputation: number | null;
  science: number | null;
  /** Withheld because the balances went stale, rather than never having arrived. */
  balancesNotCurrent: boolean;
  factor: number;
  onFactorChange: (v: number) => void;
  /**
   * The shared activate handle. Each row's `CommandButton` holds its OWN arm and
   * in-flight state off it, which is why the widget keeps no `pendingId`.
   */
  activateCmd: CommandButtonHandle;
  expanded: boolean;
  onToggleExpanded: () => void;
  /**
   * A standing account of this card's own state, on screen above the price. The
   * button's `title` says the same thing to a pointer that rests on it, which
   * is neither a keyboard nor a glance.
   */
  note?: string;
}) {
  // Scale the cost displays by the factor slider, KSP costs scale
  // linearly with the commitment factor inside the slider range. A
  // zero default would divide by zero (NaN/Infinity costs that silently
  // slip past the affordability gate), so fall back to an unscaled 1×.
  const factorScale =
    s.factorSliderDefault > 0 ? factor / s.factorSliderDefault : 1;
  const scaledFunds = s.initialCostFunds * factorScale;
  const scaledScience = s.initialCostScience * factorScale;
  const scaledRep = s.effectiveCostReputation * factorScale;

  /**
   * Treat a non-finite scaled cost as unaffordable, a NaN comparison is always
   * false, which would otherwise let a broken cost bypass the gate.
   *
   * An absent balance is unaffordable for the same reason: activating a strategy
   * spends career funds, science and reputation, and a balance that never
   * arrived says nothing about whether the operator has it. Defaulting it to
   * `POSITIVE_INFINITY` would read absence as an unlimited balance.
   *
   * A balance withheld for going stale takes this same fail-closed path, so the
   * cost chips tint identically for both. The difference between them is carried
   * where the operator acts on it: the button's own refusal text and the header
   * rail, not a shade of red on a figure that is the COST and is known either way.
   */
  const overBudget = (cost: number, balance: number | null) =>
    !Number.isFinite(cost) || balance === null || balance < cost;

  const cantAfford =
    (s.initialCostFunds > 0 && overBudget(scaledFunds, funds)) ||
    (s.initialCostScience > 0 && overBudget(scaledScience, science)) ||
    (s.initialCostReputation > 0 && overBudget(scaledRep, reputation));

  return (
    <StrategyCard
      /* The one interactive title in the tree. It stays a `title`: the prop
         takes a node, so the disclosure button IS the title's content and the
         heading type lands on it unchanged. A layout primitive does not need an
         `expandable` concept to express this. */
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
          /* An unread eligibility refuses on the same terms as a refusal: the
             actuator will not dispatch one either, and arming a control that
             cannot land is the same falsehood pointing the other way.

             The source test is defence in depth rather than a live case. Our
             career model never pairs a yes with an off-screen source, because
             the one arm it cannot reach sits ahead of the ones it can. But the
             published type admits the pair and an Uplink could send it, and the
             answer would still be no: KSP runs its own commitment from inside
             that building, so the dispatch could not land however sound the
             verdict was. */
          disabled={
            s.canActivate !== true ||
            s.activateVerdictSource !== "screened" ||
            cantAfford
          }
          /* A stale balance and a short one both refuse, and the operator does
             something different about each: top up the treasury, or find out
             why the link stopped. So the refusal names which it is rather than
             calling a career it cannot see insufficient. */
          title={
            s.canActivate !== true
              ? s.activateBlockedReason || "Cannot activate"
              : s.activateVerdictSource !== "screened"
                ? "Eligible. KSP commits a strategy only from inside the Administration Building, so open that screen to commit to this one."
                : balancesNotCurrent
                  ? "Career balances are no longer current, so affordability cannot be checked"
                  : cantAfford
                    ? "Insufficient funds / science / reputation at this factor"
                    : "Set the factor, then confirm"
          }
        />
      }
    >
      {/* The description stands without expanding the card, so the operator
          can pick a strategy from the list; expanding the card is what
          reveals the full effect breakdown. */}
      <StrategyDescription of={s} />
      {expanded && (
        <EffectList>
          {parseEffectLines(s.effect).map((line, i) => (
            // Effect lines are static, non-reorderable text; index keeps
            // otherwise-identical lines from colliding.
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
            /* What was READ, not what it means. This record carries three setup
               currencies and no others, so three zeros are a statement about
               those three and about nothing else.

               It read "No setup cost", which is the whole price of a STOCK
               strategy and is a falsehood the moment a career overhaul prices
               one in a currency this record has no field for. RP-1 is the
               shipped case: a Program is a strategy on this same list and
               `Program.Accept()` charges `confidenceCosts[speed]` in
               Confidence, so a 300-Confidence commitment announced itself as
               free directly above an RP-1 section reading "300 at Normal speed,
               SHORT" for the same Program on the same screen.

               Deliberately not taught about Confidence, and deliberately not a
               department name list: the currency is not on this channel, so the
               honest move is to stop claiming more than arrived rather than to
               guess which overhaul is running. */
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
 * the currency's own symbol when no economy has arrived.
 *
 * `Unit` renders an absent value as a bare null token and no unit, which is
 * right for a lone readout and wrong for three of them in a row. Funds,
 * reputation and science are told apart on this rail by their symbol alone (an
 * `f`, a star, a microscope), so three anonymous dashes would say that
 * something is missing without saying what. Hence the token passed alongside:
 * an absent value carries no unit to read one off.
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

// ── Styles ────────────────────────────────────────────────────────────────────

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
  padding: 0 var(--space-12) var(--space-6);
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
  padding: 0 var(--space-12) var(--space-6);
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

/**
 * The screen's one inset, and its one vertical rhythm. Every group on a screen
 * is a child of this box and none of them pads itself, which is what makes the
 * widget's own lists and an Uplink's augment body line up: the inset is a
 * property of the screen, not of whoever happened to draw the section.
 */
const ScreenInset = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  /* The inset stays on the rungs. This is the screen's own gutter, not a
     surface: nothing is drawn here, no border and no fill, and both halves
     resolve the same in every density tier, so it fails both limbs of the
     earning test the same way the (8,16) chrome band does. --inset-surface
     would be a lie about what the box is and would tighten every screen by
     4px on each side to make a ratchet number smaller. */
  padding: var(--space-8) var(--space-12);
`;

/**
 * The section grid's column template, in the same shape and at the same 13rem
 * floor as `Panel`'s own. See `Grid`'s `cols` passthrough: `auto-fit` collapses
 * the tracks nothing lands in, which `Grid`'s `minColWidth` shorthand (auto-FILL)
 * would leave standing and empty on a wide tile.
 */
const SCREEN_COLUMNS = "repeat(auto-fit, minmax(min(13rem, 100%), 1fr))";

const Empty = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: var(--font-size-compact);
`;

/**
 * A strategy on its own surface: the kit's arrangement, this widget's box.
 *
 * `Block` rather than `Card` because the surface here is not the kit's sunken
 * record. An active strategy is signalled by a green border and a tint under
 * it, and a card's own ground would sit between the two.
 *
 * Its title, department, body and footer bar are the arrangement's, so the type
 * and the spacing are the kit's and only the border and the ground are this
 * file's.
 */
const StrategyCard = styled(Block).attrs({
  /* `forwardedAs`, not `as`: styled-components claims `as` for its own
     polymorphism and would swap Block out for a bare article, losing the
     anatomy. `forwardedAs` hands the tag to Block, which is what renders it. */
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
  margin: var(--space-2) 0 var(--space-4);
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
    margin-right: var(--space-6);
  }
`;

const CostRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
  margin-top: var(--space-2);
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
  margin-top: var(--space-4);
`;

/**
 * A bare `<input type="range">` has no cross-engine styling, so each
 * browser paints its own native track/thumb colours (was mismatched
 * Chromium blue vs. WebKit/Firefox default grey: the "wrong colour" /
 * "different coloured blobs" reports). It also has no explicit width, so
 * as a flex child its intrinsic size doesn't shrink to fit a narrow card
 * (was overflowing the widget at portrait/tall sizes). `min-width: 0` +
 * `width: 100%` let it shrink with the row; `appearance: none` plus the
 * per-engine track/thumb pseudo-elements give it one consistent look on
 * Chromium, Firefox and WebKit.
 */
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

/*
 * The whole body of a screen that exists and will not open, which is the only
 * thing on it worth reading. Its tab stays selectable for exactly that reason:
 * `Tabs`'s own `disabled` makes a tab unreachable by pointer AND by key and
 * steps the arrow navigation over it, which would put the reason somewhere the
 * operator cannot get to and leave the screen indistinguishable from one that
 * was never contributed.
 */
const LockedScreen = styled.p`
  margin: 0;
  padding: var(--space-16);
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

// ── Registration ──────────────────────────────────────────────────────────

registerComponent<StrategiesConfig>({
  id: "strategies",
  name: "Admin Building",
  description:
    "Administration Building strategies for career mode. Shows active commitments, their per-strategy effect bullets, and the available alternatives with cost previews scaled by the commitment-factor slider. With that building open KSP answers eligibility itself; with it shut the same rules are asked one at a time, which is enough to name what the career refuses but never enough to say yes. Committing runs inside the building either way, because KSP's own activation does.",
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
  /* Which screens the building has, and what one of them holds beyond its own
     department listing. Split that way because the two answers have different
     failure modes: a tab list assembled from whatever bodies happened to
     register is a race against a runtime-fetched bundle, and a screen that is
     merely missing cannot say it is locked. */
  contributionSlots: ["strategies.screens"],
  augmentSlots: ["strategies.screen-body"],
});

export { StrategiesComponent };
