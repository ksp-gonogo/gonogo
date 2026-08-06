import type { ComponentProps } from "@ksp-gonogo/core";
import {
  formatCompactNumber,
  getSizeBucket,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  CommandDelay,
  GhostButton,
  NULL_DISPLAY,
  Panel,
  PrimaryButton,
  ScrollArea,
  Stack,
  speakQuantity,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

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

const COMMIT_TIMEOUT_MS = 5_000;

/**
 * Accepts BOTH the legacy `strategies.all` shape (`departmentName`) and
 * the new wire shape (`career.status.strategies.all`,
 * CareerViewProvider.BuildStrategyList: `department`): same field-rename
 * normalization ContractManager's `parseContracts` applies. Every other
 * field name matches the new wire 1:1 (decompile-confirmed,
 * career-capture-extend-report.md), including `effectiveCostReputation`
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

function StrategiesComponent({
  w,
  h,
}: Readonly<ComponentProps<StrategiesConfig>>) {
  // The whole career snapshot rides ONE
  // canonical Topic, `career.status` (CareerStatus). economy.{funds,
  // reputation,science} and strategies.all are the fields this widget reads,
  // the wire's `career.status.strategies.all` carries the full `id`/costs/
  // canActivate/canDeactivate/effect-text shape `parseStrategies` needs
  // (career-capture-extend-report.md; note `department`, not the legacy
  // `departmentName`, which parseStrategies normalizes). No legacy read
  // fallback: the canonical Topic read has none. The activate/deactivate
  // COMMANDS still have no command home (KNOWN_COMMAND_GAPS) and fall back to
  // the legacy DataSource via `useExecuteAction` automatically: a later
  // migration will move the write path too.
  const career = useTelemetry("career.status");
  const stratsRaw = career?.strategies?.all;
  const funds = career?.economy?.funds;
  const reputation = career?.economy?.reputation;
  const science = career?.economy?.science;
  // Activating/deactivating a strategy is an Administration-building action
  // with no vessel signal delay, so it dispatches at the meta-vantage
  // (instant). The handles are consumed by the <CommandDelay> in the panel.
  const activateCmd = useCommand("career.strategy.activate", {
    vantage: META_VANTAGE,
  });
  const deactivateCmd = useCommand("career.strategy.deactivate", {
    vantage: META_VANTAGE,
  });

  const strategies = useMemo(() => parseStrategies(stratsRaw), [stratsRaw]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [factorById, setFactorById] = useState<Record<string, number>>({});
  const [armedActivateId, setArmedActivateId] = useState<string | null>(null);
  const [armedDeactivateId, setArmedDeactivateId] = useState<string | null>(
    null,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Drop arm/pending state if the user walks away or things change.
  useEffect(() => {
    if (armedActivateId === null) return;
    const id = setTimeout(() => setArmedActivateId(null), COMMIT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armedActivateId]);
  useEffect(() => {
    if (armedDeactivateId === null) return;
    const id = setTimeout(() => setArmedDeactivateId(null), COMMIT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armedDeactivateId]);
  useEffect(() => {
    if (pendingId === null) return;
    const id = setTimeout(() => setPendingId(null), COMMIT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [pendingId]);

  // Clear pending once the live data confirms the new state.
  useEffect(() => {
    if (pendingId === null || strategies === null) return;
    const target = strategies.find((s) => s.id === pendingId);
    if (target === undefined) {
      setPendingId(null);
      return;
    }
    // Either side of the transition counts as "settled", the action
    // mutates isActive in either direction.
    setPendingId(null);
  }, [pendingId, strategies]);

  const bucket = getSizeBucket(w, h);
  const showSubtitle = (h ?? 8) >= 4;

  if (strategies === null) {
    return (
      <Panel panelTitle="Strategies">
        {showSubtitle && <Empty>Awaiting career data...</Empty>}
      </Panel>
    );
  }

  const active = strategies.filter((s) => s.isActive);
  const inactive = strategies.filter((s) => !s.isActive);
  const available = inactive.filter(
    (s) => s.canActivate || s.activateBlockedReason === "",
  );
  const ineligible = inactive.filter(
    (s) =>
      !s.canActivate &&
      s.activateBlockedReason !== "" &&
      // "more than 1 active strategies at this level" is the soft cap,
      // the strategy IS eligible, just blocked by the active count. Keep
      // those visible in the Available list so the operator sees them as
      // options once they deactivate the running strategy.
      !/active strategies at this level/i.test(s.activateBlockedReason),
  );
  const softBlocked = inactive.filter(
    (s) =>
      !s.canActivate &&
      /active strategies at this level/i.test(s.activateBlockedReason),
  );

  // Over-cap detection: the KSP UI silently allows a save to carry
  // more active strategies than the admin building's level allows
  // (see project_ksp_strategy_overcap_quirk). Telemachus's blocked
  // reason text encodes the cap, e.g. "more than 2 active strategies
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

  // ── Tiny mode ─────────────────────────────────────────────────────────
  if (bucket === "tiny") {
    return (
      <Panel
        panelTitle="Strategies"
        panelAside={
          <Tally $overCap={overCap}>
            {active.length} active
            {overCap && ` / ${inferredCap}`}
          </Tally>
        }
      >
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
        {funds != null && (
          <TinyFundsRow title={speakQuantity(funds, { decimals: 0 })}>
            {formatCompactNumber(funds.magnitude, 0)}
            <Unit>funds</Unit>
          </TinyFundsRow>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      panelTitle="Admin Building"
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
          <Tally>
            {formatNumber(funds?.magnitude)}
            <Unit>funds</Unit>
          </Tally>
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
        </HeaderMeta>
      }
    >
      <CommandDelay
        handles={[activateCmd, deactivateCmd]}
        ariaLabel="Strategy commands: in flight"
      />
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
                  <CardDept>{s.departmentName}</CardDept>
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
                  {armedDeactivateId === s.id ? (
                    <ConfirmRow>
                      <PrimaryButton
                        type="button"
                        onClick={() => {
                          setArmedDeactivateId(null);
                          setPendingId(s.id);
                          void deactivateCmd.send({ strategyId: s.id });
                        }}
                        disabled={pendingId === s.id}
                      >
                        Confirm deactivate
                      </PrimaryButton>
                      <GhostButton
                        type="button"
                        onClick={() => setArmedDeactivateId(null)}
                      >
                        Cancel
                      </GhostButton>
                    </ConfirmRow>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => setArmedDeactivateId(s.id)}
                      disabled={!s.canDeactivate || pendingId === s.id}
                      title={
                        s.canDeactivate
                          ? "Deactivate this strategy"
                          : s.deactivateBlockedReason || "Cannot deactivate"
                      }
                    >
                      {pendingId === s.id ? "Deactivating..." : "Deactivate"}
                    </Button>
                  )}
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
                  funds={magnitudeOf(funds)}
                  reputation={magnitudeOf(reputation)}
                  science={magnitudeOf(science)}
                  factor={factorById[s.id] ?? s.factorSliderDefault}
                  onFactorChange={(v) =>
                    setFactorById((prev) => ({ ...prev, [s.id]: v }))
                  }
                  armed={armedActivateId === s.id}
                  onArm={() => setArmedActivateId(s.id)}
                  onCancel={() => setArmedActivateId(null)}
                  onConfirm={(factor) => {
                    setArmedActivateId(null);
                    setPendingId(s.id);
                    void activateCmd.send({ strategyId: s.id, factor });
                  }}
                  pending={pendingId === s.id}
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
                    <CardDept>{s.departmentName}</CardDept>
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
                  <CardDept>{s.departmentName}</CardDept>
                </CardHeader>
                <BlockedNote>{s.activateBlockedReason}</BlockedNote>
              </StrategyCard>
            ))}
          </DividedSection>
        )}
      </ScrollArea>
    </Panel>
  );
}

function AvailableRow({
  strategy: s,
  funds,
  reputation,
  science,
  factor,
  onFactorChange,
  armed,
  onArm,
  onCancel,
  onConfirm,
  pending,
  expanded,
  onToggleExpanded,
}: {
  strategy: Strategy;
  funds: number | null;
  reputation: number | null;
  science: number | null;
  factor: number;
  onFactorChange: (v: number) => void;
  armed: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: (factor: number) => void;
  pending: boolean;
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

  // Treat a non-finite scaled cost as unaffordable, a NaN comparison is
  // always false, which would otherwise let a broken cost bypass the gate.
  const overBudget = (cost: number, balance: number | null) =>
    !Number.isFinite(cost) || (balance ?? Number.POSITIVE_INFINITY) < cost;

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
        <CardDept>{s.departmentName}</CardDept>
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
        {armed ? (
          <ConfirmRow>
            <PrimaryButton
              type="button"
              onClick={() => onConfirm(factor)}
              disabled={pending || cantAfford}
            >
              Confirm activate
            </PrimaryButton>
            <GhostButton type="button" onClick={onCancel}>
              Cancel
            </GhostButton>
          </ConfirmRow>
        ) : (
          <PrimaryButton
            type="button"
            onClick={onArm}
            disabled={!s.canActivate || pending || cantAfford}
            title={
              !s.canActivate
                ? s.activateBlockedReason || "Cannot activate"
                : cantAfford
                  ? "Insufficient funds / science / reputation at this factor"
                  : "Set the factor, then confirm"
            }
          >
            {pending ? "Activating..." : "Activate"}
          </PrimaryButton>
        )}
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

  /* Both tracks: a stadium, not a corner (the old 2px was half the 4px
     height), and the two must stay identical or Chromium and Firefox
     diverge. --radius-pill renders the same and tracks the height. */
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

const ConfirmRow = styled.div`
  display: flex;
  gap: var(--space-6);
  /* Confirm + Cancel are wider than a single action button; let them stack
     rather than overflow the card at narrow widths. */
  flex-wrap: wrap;
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
    "Administration Building strategies for career mode. Shows active commitments, their per-strategy effect bullets, and the available alternatives with cost previews scaled by the commitment-factor slider. Activate / deactivate from any scene, the underlying API replicates KSP's eligibility checks against live state.",
  tags: ["career"],
  defaultSize: { w: 5, h: 9 },
  minSize: { w: 2, h: 2 },
  component: StrategiesComponent,
  dataRequirements: [
    "strategies.all",
    "career.funds",
    "career.reputation",
    "career.science",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { StrategiesComponent };
