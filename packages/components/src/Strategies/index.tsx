import type { ComponentProps } from "@gonogo/core";
import {
  getSizeBucket,
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  Button,
  GhostButton,
  Panel,
  PanelSubtitle,
  PanelTitle,
  PrimaryButton,
  ScrollArea,
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

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
        typeof e.departmentName === "string" ? e.departmentName : "",
      isActive: e.isActive === true,
      factor: typeof e.factor === "number" ? e.factor : 0,
      dateActivated: typeof e.dateActivated === "number" ? e.dateActivated : 0,
      requiredReputation:
        typeof e.requiredReputation === "number" ? e.requiredReputation : 0,
      initialCostFunds:
        typeof e.initialCostFunds === "number" ? e.initialCostFunds : 0,
      initialCostScience:
        typeof e.initialCostScience === "number" ? e.initialCostScience : 0,
      initialCostReputation:
        typeof e.initialCostReputation === "number"
          ? e.initialCostReputation
          : 0,
      effectiveCostReputation:
        typeof e.effectiveCostReputation === "number"
          ? e.effectiveCostReputation
          : typeof e.initialCostReputation === "number"
            ? e.initialCostReputation
            : 0,
      hasFactorSlider: e.hasFactorSlider === true,
      factorSliderDefault:
        typeof e.factorSliderDefault === "number" ? e.factorSliderDefault : 0,
      factorSliderSteps:
        typeof e.factorSliderSteps === "number" ? e.factorSliderSteps : 1,
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
  const stratsRaw = useDataValue("data", "strategies.all");
  const funds = useDataValue<number>("data", "career.funds");
  const reputation = useDataValue<number>("data", "career.reputation");
  const science = useDataValue<number>("data", "career.science");
  const execute = useExecuteAction("data");

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
    // Either side of the transition counts as "settled" — the action
    // mutates isActive in either direction.
    setPendingId(null);
  }, [pendingId, strategies]);

  const bucket = getSizeBucket(w, h);
  const showSubtitle = (h ?? 8) >= 4;

  if (strategies === null) {
    return (
      <Panel>
        <PanelTitle>Strategies</PanelTitle>
        {showSubtitle && <PanelSubtitle>Awaiting career data…</PanelSubtitle>}
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
      // "more than 1 active strategies at this level" is the soft cap —
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

  // Over-cap detection — the KSP UI silently allows a save to carry
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
      <Panel>
        <Header>
          <PanelTitle>Strategies</PanelTitle>
          <Tally $overCap={overCap}>
            {active.length} active
            {overCap && ` / ${inferredCap}`}
          </Tally>
        </Header>
      </Panel>
    );
  }

  return (
    <Panel>
      <Header>
        <PanelTitle>Admin Building</PanelTitle>
        {/* HeaderMeta wraps to a second row at narrow widths so funds /
            rep / sci aren't clipped by the title's space-between layout.
            At very narrow widths (cols < 6) the funds/rep/sci line gets
            dropped entirely — the active count is the headline; full
            tallies need the wide-9x12 mode to fit on one row. */}
        <HeaderMeta>
          <Tally $overCap={overCap}>
            {active.length} active
            {overCap && ` / ${inferredCap}`}
          </Tally>
          {(w ?? 9) >= 6 && (
            <>
              <Sep>·</Sep>
              <Tally>{formatNumber(funds)}f</Tally>
              <Sep>·</Sep>
              <Tally>{formatNumber(reputation)} rep</Tally>
              <Sep>·</Sep>
              <Tally>{formatNumber(science)} sci</Tally>
            </>
          )}
        </HeaderMeta>
      </Header>
      <ScrollArea>
        <Section>
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
                  {parseEffectLines(s.effect).map((line) => (
                    <EffectLine key={line}>{line}</EffectLine>
                  ))}
                </EffectList>
                <CardFooter>
                  <FactorTag>factor {formatPct(s.factor)}</FactorTag>
                  {armedDeactivateId === s.id ? (
                    <ConfirmRow>
                      <PrimaryButton
                        type="button"
                        onClick={() => {
                          setArmedDeactivateId(null);
                          setPendingId(s.id);
                          void execute(`strategies.deactivate[${s.id}]`);
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
                      {pendingId === s.id ? "Deactivating…" : "Deactivate"}
                    </Button>
                  )}
                </CardFooter>
              </StrategyCard>
            ))
          )}
        </Section>

        <Section>
          <SectionLabel>Available</SectionLabel>
          {available.length === 0 && softBlocked.length === 0 ? (
            <Empty>No strategies available right now.</Empty>
          ) : (
            <>
              {available.map((s) => (
                <AvailableRow
                  key={s.id}
                  strategy={s}
                  funds={funds ?? null}
                  reputation={reputation ?? null}
                  science={science ?? null}
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
                    void execute(`strategies.activate[${s.id},${factor}]`);
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
        </Section>

        {ineligible.length > 0 && (
          <Section>
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
          </Section>
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
  // Scale the cost displays by the factor slider — KSP costs scale
  // linearly with the commitment factor inside the slider range.
  const scaledFunds = s.initialCostFunds * (factor / s.factorSliderDefault);
  const scaledScience = s.initialCostScience * (factor / s.factorSliderDefault);
  const scaledRep =
    s.effectiveCostReputation * (factor / s.factorSliderDefault);

  const cantAfford =
    (s.initialCostFunds > 0 &&
      (funds ?? Number.POSITIVE_INFINITY) < scaledFunds) ||
    (s.initialCostScience > 0 &&
      (science ?? Number.POSITIVE_INFINITY) < scaledScience) ||
    (s.initialCostReputation > 0 &&
      (reputation ?? Number.POSITIVE_INFINITY) < scaledRep);

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
          {parseEffectLines(s.effect).map((line) => (
            <EffectLine key={line}>{line}</EffectLine>
          ))}
        </EffectList>
      )}
      <CostRow>
        {s.initialCostFunds > 0 && (
          <CostChip
            $insufficient={(funds ?? Number.POSITIVE_INFINITY) < scaledFunds}
          >
            {formatNumber(scaledFunds)}f
          </CostChip>
        )}
        {s.initialCostScience > 0 && (
          <CostChip
            $insufficient={
              (science ?? Number.POSITIVE_INFINITY) < scaledScience
            }
          >
            {formatNumber(scaledScience)} sci
          </CostChip>
        )}
        {s.initialCostReputation > 0 && (
          <CostChip
            $insufficient={(reputation ?? Number.POSITIVE_INFINITY) < scaledRep}
            title={`Nominal ${formatNumber(s.initialCostReputation * (factor / s.factorSliderDefault))}; the rep curve bumps the real charge to ${formatNumber(scaledRep)}.`}
          >
            {formatNumber(scaledRep)} rep
          </CostChip>
        )}
        {s.initialCostFunds === 0 &&
          s.initialCostScience === 0 &&
          s.initialCostReputation === 0 && <CostChip>No setup cost</CostChip>}
      </CostRow>
      {s.hasFactorSlider && (
        <FactorRow>
          <FactorLabel>Factor</FactorLabel>
          <input
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
          <FactorValue>{formatPct(factor)}</FactorValue>
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
            {pending ? "Activating…" : "Activate"}
          </PrimaryButton>
        )}
      </CardFooter>
    </StrategyCard>
  );
}

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000)
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px 6px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-wrap: wrap;
`;

const HeaderMeta = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
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

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
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
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)"};
  border-radius: 4px;
  background: ${({ $active }) =>
    $active ? "var(--color-status-go-muted)" : "transparent"};
`;

const CardHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
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
  margin: 2px 0 4px;
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
  line-height: 1.4;
`;

const EffectList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const EffectLine = styled.li`
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  line-height: 1.35;
  &::before {
    content: "·";
    color: var(--color-text-dim);
    margin-right: 6px;
  }
`;

const CostRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
`;

const CostChip = styled.span<{ $insufficient?: boolean }>`
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: 999px;
  background: ${({ $insufficient }) =>
    $insufficient
      ? "var(--color-status-nogo-muted)"
      : "var(--color-surface-elevated)"};
  color: ${({ $insufficient }) =>
    $insufficient
      ? "var(--color-status-nogo-fg)"
      : "var(--color-text-primary)"};
  font-variant-numeric: tabular-nums;
`;

const FactorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
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
  gap: 6px;
  margin-top: 4px;
  /* At very narrow widths (portrait-5x18) the FactorTag + action button
     can't sit side by side — wrap the button onto its own line instead of
     letting it overflow the card's right edge (was clipping "DEACTIVATE"
     to "DEACTIVAT"). */
  flex-wrap: wrap;
`;

const ConfirmRow = styled.div`
  display: flex;
  gap: 6px;
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
    "Administration Building strategies for career mode. Shows active commitments, their per-strategy effect bullets, and the available alternatives with cost previews scaled by the commitment-factor slider. Activate / deactivate from any scene — the underlying API replicates KSP's eligibility checks against live state.",
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
