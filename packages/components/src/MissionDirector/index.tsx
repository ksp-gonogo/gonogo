import type { ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  BellIcon,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
} from "@gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { useAlarmCreator } from "../shared/AlarmsLauncher";

/**
 * Trigger shape used by the Mission Director's parameter bells. Mirrors
 * `ContractParameterTrigger` in `@gonogo/app/src/alarms/types.ts`;
 * declared inline here because @gonogo/components can't import from
 * @gonogo/app (would be circular). The bridge in
 * `AlarmsLauncherBridge.tsx` accepts the shape via the generic
 * `AlarmCreator<TTrigger>` interface.
 */
interface ContractParameterAlarmTrigger {
  kind: "contract-parameter";
  contractId: number;
  parameterTitle: string;
  targetState: "Complete" | "Failed";
  sustainSeconds: number;
}

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
  const execute = useExecuteAction("data");
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();

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
        {activeCount === 0 && offeredCount === 0 && (
          <Empty>No active contracts. Pick one up in Mission Control.</Empty>
        )}
        {activeCount > 0 && <SectionLabel>Active</SectionLabel>}
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
                    {p.state === "Incomplete" && createAlarm && (
                      <ParameterAlarmButton
                        type="button"
                        title={`Alarm me when "${p.title}" completes`}
                        aria-label={`Set alarm for ${p.title} completion`}
                        onClick={() =>
                          createAlarm({
                            name: `${p.title} → Complete`,
                            trigger: {
                              kind: "contract-parameter",
                              contractId: c.id,
                              parameterTitle: p.title,
                              targetState: "Complete",
                              sustainSeconds: 0,
                            },
                          })
                        }
                      >
                        <BellIcon size={12} />
                      </ParameterAlarmButton>
                    )}
                  </Parameter>
                ))}
              </Parameters>
            )}
            <ActiveActions>
              <CancelButton contractId={c.id} execute={execute} />
            </ActiveActions>
          </ContractCard>
        ))}
        {offeredCount > 0 && <SectionLabel>Offered</SectionLabel>}
        {offered?.map((c) => (
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
            <OfferedActions>
              <AcceptButton
                type="button"
                onClick={() => {
                  void execute(`contracts.accept[${c.id}]`);
                }}
              >
                Accept
              </AcceptButton>
              <DeclineButton contractId={c.id} execute={execute} />
            </OfferedActions>
          </ContractCard>
        ))}
      </Body>
    </Panel>
  );
}

const ARM_TIMEOUT_MS = 4000;

function DeclineButton({
  contractId,
  execute,
}: {
  contractId: number;
  execute: (action: string) => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);

  // Auto-disarm so a forgotten armed-decline doesn't sit waiting for a
  // misclick. Matches the maneuver-trigger pattern.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <DeclineButtonStyled type="button" onClick={() => setArmed(true)}>
        Decline
      </DeclineButtonStyled>
    );
  }
  return (
    <ConfirmDeclineButton
      type="button"
      onClick={() => {
        setArmed(false);
        void execute(`contracts.decline[${contractId}]`);
      }}
    >
      Confirm decline
    </ConfirmDeclineButton>
  );
}

function CancelButton({
  contractId,
  execute,
}: {
  contractId: number;
  execute: (action: string) => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);

  // Cancel forfeits any work in progress on the contract — same arm-then-
  // confirm pattern as Decline but stronger framing in the confirm copy
  // because the loss is bigger (you may have already spent funds /
  // achieved partial parameters).
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <CancelButtonStyled
        type="button"
        onClick={() => setArmed(true)}
        title="Cancel this contract — forfeits all progress"
      >
        Cancel
      </CancelButtonStyled>
    );
  }
  return (
    <ConfirmCancelButton
      type="button"
      onClick={() => {
        setArmed(false);
        void execute(`contracts.cancel[${contractId}]`);
      }}
    >
      Forfeit contract
    </ConfirmCancelButton>
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

const SectionLabel = styled.div`
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: 4px;
`;

const OfferedActions = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 4px;
`;

const ActiveActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
`;

const ActionButton = styled.button`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 2px;
  border: 1px solid var(--color-surface-raised);
  cursor: pointer;
  font-family: inherit;
`;

const AcceptButton = styled(ActionButton)`
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  border-color: transparent;

  &:hover {
    filter: brightness(1.1);
  }
`;

const DeclineButtonStyled = styled(ActionButton)`
  background: transparent;
  color: var(--color-text-muted);

  &:hover {
    color: var(--color-status-nogo-fg);
    border-color: var(--color-status-nogo-bg);
  }
`;

const ConfirmDeclineButton = styled(ActionButton)`
  background: var(--color-status-nogo-bg);
  color: var(--color-status-nogo-fg);
  border-color: transparent;
  animation: declinePulse 1s ease-in-out infinite;

  @media (prefers-reduced-motion: no-preference) {
    @keyframes declinePulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
`;

const CancelButtonStyled = styled(ActionButton)`
  background: transparent;
  color: var(--color-text-faint);
  font-size: 10px;
  padding: 2px 8px;

  &:hover {
    color: var(--color-status-nogo-fg);
    border-color: var(--color-status-nogo-bg);
  }
`;

const ConfirmCancelButton = styled(ActionButton)`
  background: var(--color-status-nogo-bg);
  color: var(--color-status-nogo-fg);
  border-color: transparent;
  animation: declinePulse 1s ease-in-out infinite;
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

const ParameterAlarmButton = styled.button`
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  color: var(--color-text-faint);
  display: inline-flex;
  align-items: center;

  &:hover {
    color: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
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
  requires: ["career"],
});

export { MissionDirectorComponent };
