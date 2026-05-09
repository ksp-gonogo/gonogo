import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle, ScrollArea } from "@gonogo/ui";
import styled from "styled-components";

type MissionDirectorConfig = Record<string, never>;

export type ContractParameterState = "Incomplete" | "Complete" | "Failed";

export interface ContractParameter {
  title: string;
  state: ContractParameterState;
  optional: boolean;
}

export interface ContractEntry {
  id: number;
  title: string;
  agency: string;
  state: string;
  fundsAdvance: number;
  fundsCompletion: number;
  scienceCompletion: number;
  repCompletion: number;
  /** UT seconds at which the contract expires; zero when no deadline. */
  deadlineUt: number;
  parameters: ContractParameter[];
}

const KNOWN_PARAM_STATES = new Set<ContractParameterState>([
  "Incomplete",
  "Complete",
  "Failed",
]);

function isKnownParamState(value: string): value is ContractParameterState {
  return KNOWN_PARAM_STATES.has(value as ContractParameterState);
}

/**
 * Defensive parser for the GonogoTelemetry plugin's contract array
 * payloads (`contracts.active`, `contracts.offered`,
 * `contracts.completedRecent`). Drops malformed entries; tolerates
 * unknown parameter states by collapsing to "Incomplete".
 */
export function parseContracts(raw: unknown): ContractEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ContractEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "number" ? e.id : null;
    if (id === null) continue;
    out.push({
      id,
      title: typeof e.title === "string" ? e.title : "(unnamed contract)",
      agency: typeof e.agency === "string" ? e.agency : "",
      state: typeof e.state === "string" ? e.state : "",
      fundsAdvance: typeof e.fundsAdvance === "number" ? e.fundsAdvance : 0,
      fundsCompletion:
        typeof e.fundsCompletion === "number" ? e.fundsCompletion : 0,
      scienceCompletion:
        typeof e.scienceCompletion === "number" ? e.scienceCompletion : 0,
      repCompletion: typeof e.repCompletion === "number" ? e.repCompletion : 0,
      deadlineUt: typeof e.deadlineUt === "number" ? e.deadlineUt : 0,
      parameters: parseParameters(e.parameters),
    });
  }
  return out;
}

function parseParameters(raw: unknown): ContractParameter[] {
  if (!Array.isArray(raw)) return [];
  const out: ContractParameter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const stateRaw = typeof e.state === "string" ? e.state : "Incomplete";
    out.push({
      title: typeof e.title === "string" ? e.title : "(unnamed)",
      state: isKnownParamState(stateRaw) ? stateRaw : "Incomplete",
      optional: e.optional === true,
    });
  }
  return out;
}

/** Format a UT-second deadline relative to the current universal time. */
export function formatDeadline(
  deadlineUt: number,
  universalTime: number,
): string {
  if (!deadlineUt || deadlineUt <= 0) return "no deadline";
  const remaining = deadlineUt - universalTime;
  if (remaining <= 0) return "expired";
  // Stock KSP uses 6h days, 426d years. Round to whole days/hours for
  // legibility; sub-hour resolution adds noise the operator doesn't need.
  const days = Math.floor(remaining / (6 * 3600));
  const hours = Math.floor((remaining % (6 * 3600)) / 3600);
  if (days >= 1) return `${days}d ${hours}h left`;
  if (hours >= 1) return `${hours}h left`;
  const mins = Math.max(1, Math.floor(remaining / 60));
  return `${mins}m left`;
}

function MissionDirectorComponent({
  h,
}: Readonly<ComponentProps<MissionDirectorConfig>>) {
  const activeRaw = useDataValue("data", "contracts.active");
  const offeredRaw = useDataValue("data", "contracts.offered");
  const recentRaw = useDataValue("data", "contracts.completedRecent");
  const universalTime = useDataValue("data", "t.universalTime") as
    | number
    | undefined;

  const active = parseContracts(activeRaw);
  const offered = parseContracts(offeredRaw);
  const recent = parseContracts(recentRaw);

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;

  if (active === null) {
    return (
      <Panel>
        <PanelTitle>MISSION DIRECTOR</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Awaiting contract telemetry</PanelSubtitle>
        )}
      </Panel>
    );
  }

  const activeCount = active.length;
  const offeredCount = offered?.length ?? 0;
  const recentCount = recent?.length ?? 0;

  return (
    <Panel>
      <PanelTitle>MISSION DIRECTOR</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {activeCount} active · {offeredCount} offered · {recentCount} recent
        </PanelSubtitle>
      )}
      <Body>
        {activeCount === 0 && (
          <Empty>No active contracts. Pick one up in Mission Control.</Empty>
        )}
        {active.map((c) => (
          <ContractCard key={c.id}>
            <ContractHeader>
              <ContractTitle>{c.title}</ContractTitle>
              <ContractDeadline>
                {formatDeadline(c.deadlineUt, universalTime ?? 0)}
              </ContractDeadline>
            </ContractHeader>
            {c.agency && <Agency>{c.agency}</Agency>}
            <Rewards>
              {c.fundsCompletion > 0 && (
                <Reward>
                  <RewardLabel>FUNDS</RewardLabel>
                  <RewardValue>{formatCurrency(c.fundsCompletion)}</RewardValue>
                </Reward>
              )}
              {c.scienceCompletion > 0 && (
                <Reward>
                  <RewardLabel>SCI</RewardLabel>
                  <RewardValue>{c.scienceCompletion.toFixed(1)}</RewardValue>
                </Reward>
              )}
              {c.repCompletion > 0 && (
                <Reward>
                  <RewardLabel>REP</RewardLabel>
                  <RewardValue>{c.repCompletion.toFixed(1)}</RewardValue>
                </Reward>
              )}
            </Rewards>
            {c.parameters.length > 0 && (
              <Parameters>
                {c.parameters.map((p) => (
                  <Parameter key={`${c.id}-${p.title}`} $state={p.state}>
                    <ParameterMark $state={p.state}>
                      {p.state === "Complete"
                        ? "✓"
                        : p.state === "Failed"
                          ? "✕"
                          : "○"}
                    </ParameterMark>
                    <ParameterTitle>
                      {p.title}
                      {p.optional && <Optional> (optional)</Optional>}
                    </ParameterTitle>
                  </Parameter>
                ))}
              </Parameters>
            )}
          </ContractCard>
        ))}
      </Body>
    </Panel>
  );
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: 12px;
  padding: 8px 0;
`;

const ContractCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--color-surface-panel);
  border-radius: 2px;
`;

const ContractHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
`;

const ContractTitle = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: 12px;
  flex: 1;
  min-width: 0;
`;

const ContractDeadline = styled.span`
  color: var(--color-text-faint);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

const Agency = styled.div`
  color: var(--color-text-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
`;

const Rewards = styled.div`
  display: flex;
  gap: 12px;
`;

const Reward = styled.div`
  display: flex;
  align-items: baseline;
  gap: 4px;
`;

const RewardLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
`;

const RewardValue = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const Parameters = styled.ul`
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Parameter = styled.li<{ $state: ContractParameterState }>`
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  color: ${(p) =>
    p.$state === "Complete"
      ? "var(--color-text-muted)"
      : p.$state === "Failed"
        ? "var(--color-status-nogo-fg)"
        : "var(--color-text-primary)"};
  text-decoration: ${(p) =>
    p.$state === "Complete" ? "line-through" : "none"};
`;

const ParameterMark = styled.span<{ $state: ContractParameterState }>`
  font-family: monospace;
  width: 10px;
  text-align: center;
  color: ${(p) =>
    p.$state === "Complete"
      ? "var(--color-status-go-fg)"
      : p.$state === "Failed"
        ? "var(--color-status-nogo-fg)"
        : "var(--color-text-faint)"};
`;

const ParameterTitle = styled.span`
  flex: 1;
  min-width: 0;
`;

const Optional = styled.span`
  color: var(--color-text-faint);
  font-style: italic;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<MissionDirectorConfig>({
  id: "mission-director",
  name: "Mission Director",
  description:
    "Career-mode contracts panel — active contracts with parameter progress, deadline countdown, and reward breakdown. Counts in subtitle. Read-only Phase 3; Phase 4 will add accept / decline buttons.",
  tags: ["career", "contracts"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: MissionDirectorComponent,
  dataRequirements: [
    "contracts.active",
    "contracts.offered",
    "contracts.completedRecent",
    "t.universalTime",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { MissionDirectorComponent };
