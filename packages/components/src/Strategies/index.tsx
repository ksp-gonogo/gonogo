import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  formatCompactNumber,
  getSizeBucket,
  registerComponent,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  type Reading,
  useCommand,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  CommandButton,
  type CommandButtonHandle,
  NULL_DISPLAY,
  Panel,
  ScrollArea,
  Section,
  Stack,
  speakQuantity,
  type TabDescriptor,
  Tabs,
  Unit,
  useContributions,
  usePanelDelay,
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
  canActivate: boolean;
  activateBlockedReason: string;
  canDeactivate: boolean;
  deactivateBlockedReason: string;
  effect: string;
}

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
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
  for (const entry of raw) {
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
      factor: magnitudeOr(e.factor as Quantityish, 0),
      dateActivated: magnitudeOr(e.dateActivated as Quantityish, 0),
      requiredReputation: magnitudeOr(e.requiredReputation as Quantityish, 0),
      initialCostFunds: magnitudeOr(e.initialCostFunds as Quantityish, 0),
      initialCostScience: magnitudeOr(e.initialCostScience as Quantityish, 0),
      initialCostReputation: magnitudeOr(
        e.initialCostReputation as Quantityish,
        0,
      ),
      effectiveCostReputation:
        magnitudeOf(e.effectiveCostReputation as Quantityish) ??
        magnitudeOr(e.initialCostReputation as Quantityish, 0),
      hasFactorSlider: e.hasFactorSlider === true,
      factorSliderDefault: magnitudeOr(e.factorSliderDefault as Quantityish, 0),
      factorSliderSteps: magnitudeOr(e.factorSliderSteps as Quantityish, 1),
      canActivate: e.canActivate === true,
      activateBlockedReason:
        typeof e.activateBlockedReason === "string"
          ? e.activateBlockedReason
          : "",
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
 * The four lists one screenful of strategies is drawn as. Split out of the
 * component so a tab can be partitioned on its own share of the list while the
 * header keeps partitioning the whole of it.
 */
function partition(strategies: readonly Strategy[]): {
  active: Strategy[];
  available: Strategy[];
  softBlocked: Strategy[];
  ineligible: Strategy[];
} {
  const inactive = strategies.filter((s) => !s.isActive);
  return {
    active: strategies.filter((s) => s.isActive),
    available: inactive.filter(
      (s) => s.canActivate || s.activateBlockedReason === "",
    ),
    // "more than 1 active strategies at this level" is the soft cap, the
    // strategy IS eligible, just blocked by the active count. Keep those
    // visible in the Available list so the operator sees them as options once
    // they deactivate the running strategy.
    softBlocked: inactive.filter(
      (s) =>
        !s.canActivate &&
        /active strategies at this level/i.test(s.activateBlockedReason),
    ),
    ineligible: inactive.filter(
      (s) =>
        !s.canActivate &&
        s.activateBlockedReason !== "" &&
        !/active strategies at this level/i.test(s.activateBlockedReason),
    ),
  };
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
  const economy = judgeable(careerReading)?.economy;
  const funds = economy?.funds;
  const reputation = economy?.reputation;
  const science = economy?.science;
  // Distinguishes "the balances went stale" from "no economy has ever arrived".
  // Both blank the figures and both refuse Activate, but only one of them is a
  // statement about the link, and the operator acts differently on each.
  const balancesNotCurrent = notCurrent(careerReading);
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
    return (
      <Panel
        panelTitle="Strategies"
        compactTitle={["ADMIN", "ADM"]}
        panelAside={
          <Tally $overCap={overCap}>
            {active.length} active
            {overCap && ` / ${inferredCap}`}
          </Tally>
        }
        sections={
          <Section full>
            {/* Strategies spends career funds (activate cost), so the balance
            must stay visible even in the tiny bucket (CLAUDE.md "spending
            funds: always show the balance"). A dedicated row below the
            header rather than inlined into the Header's own flex-wrap
            group: Panel has no scroll area in tiny mode, so competing for
            space inside Header's wrap could push the figure below the
            visible panel bounds (it did, in an earlier version of this
            fix: the balance wrapped clean off the bottom of a 3x3 box).
            Compact k/M formatting plus nowrap+ellipsis keeps this to one
            line that always fits. */}
            {balancesNotCurrent ? (
              /* Withheld, and said so in the operator's own words. "funds unknown"
             below would accuse the link of never having delivered a balance it
             did deliver, and a bare dash would leave the refusal unexplained. */
              <TinyFundsRow title="The funds balance is no longer current, so affordability is not being checked">
                funds not current
              </TinyFundsRow>
            ) : funds != null ? (
              <TinyFundsRow title={speakQuantity(funds, { decimals: 0 })}>
                {formatCompactNumber(funds.magnitude, 0)}
                <Unit>funds</Unit>
              </TinyFundsRow>
            ) : (
              /* An absent balance is the state that rule exists for: it is when the
             activate buttons refuse, so the row has to say so rather than
             vanish and leave the refusal unexplained. */
              <TinyFundsRow title="No funds balance has arrived">
                funds unknown
              </TinyFundsRow>
            )}
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
      /* The tallies wrap to a second row at narrow widths, which Panel.Header
         now does for any aside rather than each widget arranging its own.
         Funds must stay visible at every width: Strategies spends career funds
         on activate (CLAUDE.md "spending funds: always show the balance").
         Rep/sci are supplementary and still drop below cols 6, where even a
         wrapped row cannot hold them. */
      panelAside={
        <HeaderMeta>
          <Tally $overCap={overCap}>
            {active.length} active
            {overCap && ` / ${inferredCap}`}
          </Tally>
          <Sep>·</Sep>
          {balancesNotCurrent ? (
            /* One statement replaces all three figures. Three dashes would read
               as a career with nothing in it, and dashes are already what an
               absent economy renders, so the rail has to name the link instead
               of showing the operator the same nothing twice over. */
            <NotCurrentTally title="The career balances are no longer current, so affordability is not being checked">
              balances not current
            </NotCurrentTally>
          ) : (
            <>
              <Tally>
                {formatNumber(funds?.magnitude)}
                <Unit>funds</Unit>
              </Tally>
              {reportsFundsDrain(netFunds) && (
                <>
                  <Sep>·</Sep>
                  <FundsDrain funds={magnitudeOf(funds)} netPerDay={netFunds} />
                </>
              )}
              {(w ?? 9) >= 6 && (
                <>
                  <Sep>·</Sep>
                  <Tally>
                    {formatNumber(reputation?.magnitude)}
                    <Unit>rep</Unit>
                  </Tally>
                  <Sep>·</Sep>
                  <Tally>
                    {formatNumber(science?.magnitude)}
                    <Unit>science</Unit>
                  </Tally>
                </>
              )}
            </>
          )}
        </HeaderMeta>
      }
      /* ONE section: the body is a screen switch, and a tab strip beside
         anything reads as two widgets rather than as one panel. */
      sections={
        <Section full>
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
  const { active, available, softBlocked, ineligible } = partition(strategies);
  return (
    <ScrollArea>
      <DividedSection aria-label="Active">
        <SectionLabel>Active</SectionLabel>
        {active.length === 0 ? (
          <Empty>No active strategies.</Empty>
        ) : (
          active.map((s) => (
            <StrategyCard key={s.id} $active>
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                {showDepartment && <CardDept>{s.departmentName}</CardDept>}
              </CardHeader>
              {s.description && <Description>{s.description}</Description>}
              <EffectList>
                {parseEffectLines(s.effect).map((line, i) => (
                  // Effect lines are static, non-reorderable text; index keeps
                  // otherwise-identical lines from colliding.
                  // biome-ignore lint/suspicious/noArrayIndexKey: static effect text, never reordered
                  <EffectLine key={`${i}:${line}`}>{line}</EffectLine>
                ))}
              </EffectList>
              <CardFooter>
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
              </CardFooter>
            </StrategyCard>
          ))
        )}
      </DividedSection>

      <DividedSection aria-label="Available">
        <SectionLabel>Available</SectionLabel>
        {available.length === 0 && softBlocked.length === 0 ? (
          <Empty>No strategies available right now.</Empty>
        ) : (
          <>
            {available.map((s) => (
              <AvailableRow
                key={s.id}
                strategy={s}
                showDepartment={showDepartment}
                funds={magnitudeOf(funds)}
                reputation={magnitudeOf(reputation)}
                science={magnitudeOf(science)}
                balancesNotCurrent={balancesNotCurrent}
                factor={factorById[s.id] ?? s.factorSliderDefault}
                onFactorChange={(v) =>
                  setFactorById((prev) => ({ ...prev, [s.id]: v }))
                }
                activateCmd={activateCmd}
                expanded={expandedId === s.id}
                onToggleExpanded={() =>
                  setExpandedId(expandedId === s.id ? null : s.id)
                }
              />
            ))}
            {softBlocked.map((s) => (
              <StrategyCard key={s.id}>
                <CardHeader>
                  <CardTitle>{s.title}</CardTitle>
                  {showDepartment && <CardDept>{s.departmentName}</CardDept>}
                </CardHeader>
                <BlockedNote>
                  Deactivate the running strategy first to enable this one.
                </BlockedNote>
              </StrategyCard>
            ))}
          </>
        )}
      </DividedSection>

      {ineligible.length > 0 && (
        <DividedSection aria-label="Locked">
          <SectionLabel>Locked</SectionLabel>
          {ineligible.map((s) => (
            <StrategyCard key={s.id}>
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                {showDepartment && <CardDept>{s.departmentName}</CardDept>}
              </CardHeader>
              <BlockedNote>{s.activateBlockedReason}</BlockedNote>
            </StrategyCard>
          ))}
        </DividedSection>
      )}

      {screenId !== undefined && (
        <AugmentSlot name="strategies.screen-body" props={{ screenId }} />
      )}
    </ScrollArea>
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
    <StrategyCard>
      <CardHeader>
        <ExpandToggle
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          <CardTitle>{s.title}</CardTitle>
        </ExpandToggle>
        {showDepartment && <CardDept>{s.departmentName}</CardDept>}
      </CardHeader>
      {/* Always show the short description so the operator can pick a
          strategy without clicking expand; expand still reveals the full
          effect breakdown. */}
      {s.description && <Description>{s.description}</Description>}
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
      <CostRow>
        {s.initialCostFunds > 0 && (
          <CostChip $insufficient={overBudget(scaledFunds, funds)}>
            {formatNumber(scaledFunds)}
            <Unit>funds</Unit>
          </CostChip>
        )}
        {s.initialCostScience > 0 && (
          <CostChip $insufficient={overBudget(scaledScience, science)}>
            {formatNumber(scaledScience)}
            <Unit>science</Unit>
          </CostChip>
        )}
        {s.initialCostReputation > 0 && (
          <CostChip
            $insufficient={overBudget(scaledRep, reputation)}
            title={`Nominal ${formatNumber(s.initialCostReputation * factorScale)}; the rep curve bumps the real charge to ${formatNumber(scaledRep)}.`}
          >
            {formatNumber(scaledRep)}
            <Unit>rep</Unit>
          </CostChip>
        )}
        {s.initialCostFunds === 0 &&
          s.initialCostScience === 0 &&
          s.initialCostReputation === 0 && <CostChip>No setup cost</CostChip>}
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
      <CardFooter>
        <CommandButton
          handle={activateCmd}
          args={{ strategyId: s.id, factor }}
          commandLabel={`Activate ${s.title}`}
          label="Activate"
          confirmLabel="Confirm activate"
          pendingLabel="Activating..."
          disabled={!s.canActivate || cantAfford}
          /* A stale balance and a short one both refuse, and the operator does
             something different about each: top up the treasury, or find out
             why the link stopped. So the refusal names which it is rather than
             calling a career it cannot see insufficient. */
          title={
            !s.canActivate
              ? s.activateBlockedReason || "Cannot activate"
              : balancesNotCurrent
                ? "Career balances are no longer current, so affordability cannot be checked"
                : cantAfford
                  ? "Insufficient funds / science / reputation at this factor"
                  : "Set the factor, then confirm"
          }
        />
      </CardFooter>
    </StrategyCard>
  );
}

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NULL_DISPLAY;
  if (Math.abs(v) >= 1000)
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── Styles ────────────────────────────────────────────────────────────────────

const HeaderMeta = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-6);
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
  flex-wrap: wrap;
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
  padding: 0 var(--space-12) var(--space-6);
  font-size: var(--font-size-xs);
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TinyDrainRow = styled.div`
  padding: 0 var(--space-12) var(--space-6);
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// Gap moves 6px to 8px: the space scale is 2/4/8/12/16 and has no 6, so it
// snaps to md. The padding and the dashed divider are this list's own.
const DividedSection = styled(Stack).attrs({
  // forwardedAs: `as` would be consumed by styled-components and render a bare
  // <section>, dropping Stack's flex column. See ManeuverPlanner's note.
  forwardedAs: "section" as const,
  gap: "md" as const,
})`
  padding: var(--space-8) var(--space-12);
  border-bottom: 1px dashed var(--color-border-subtle);
  &:last-child {
    border-bottom: none;
  }
`;

const SectionLabel = styled.h4`
  margin: 0;
  font-size: var(--font-size-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const Empty = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: var(--font-size-sm);
`;

const StrategyCard = styled.article<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-md);
  /* An active card is signalled by the green border above, not by a fill.
     This read var(--color-status-go-muted), a token that has never been
     declared, so the whole declaration was invalid and the background has
     always resolved to transparent: what is written here now is what has
     actually rendered all along. Restoring the intended tint needs a
     go-tone dark added to the palette, which currently carries muted
     variants for nogo and warning only, and every candidate green drops
     this card's --color-text-dim text from its present 4.92:1 to below the
     4.5:1 AA floor. That makes it a design call rather than a rename. */
  background: transparent;
`;

const CardHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
`;

const CardTitle = styled.div`
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: var(--font-size-sm);
`;

const CardDept = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
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
  font-size: var(--font-size-xs);
  line-height: var(--line-height-body);
`;

const EffectList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const EffectLine = styled.li`
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
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
  gap: var(--space-4);
  margin-top: var(--space-2);
`;

const CostChip = styled.span<{ $insufficient?: boolean }>`
  font-size: var(--font-size-xs);
  padding: var(--space-hair) var(--space-6);
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
  gap: var(--space-8);
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
  font-size: var(--font-size-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const FactorTag = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
`;

const FactorValue = styled.span`
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  min-width: 3em;
  text-align: right;
`;

const CardFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  margin-top: var(--space-4);
  /* At very narrow widths (portrait-5x18) the FactorTag + action button
     can't sit side by side, wrap the button onto its own line instead of
     letting it overflow the card's right edge (was clipping "DEACTIVATE"
     to "DEACTIVAT"). */
  flex-wrap: wrap;
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
  font-size: var(--font-size-sm);
  text-align: center;
`;

const BlockedNote = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
  font-style: italic;
`;

// ── Registration ──────────────────────────────────────────────────────────

registerComponent<StrategiesConfig>({
  id: "strategies",
  name: "Admin Building",
  description:
    "Administration Building strategies for career mode. Shows active commitments, their per-strategy effect bullets, and the available alternatives with cost previews scaled by the commitment-factor slider. Committing and cancelling need the Administration Building open: KSP answers whether a strategy may be activated only while that screen exists, and the answer is the game's own rather than one this widget reconstructs.",
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
