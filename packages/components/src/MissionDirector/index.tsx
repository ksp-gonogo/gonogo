import type { ComponentProps } from "@gonogo/core";
import {
  getWidgetShape,
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
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";

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
  /**
   * Subclass of `ContractParameter` in stock KSP. Present when the fork's
   * type-aware emit recognises the parameter (ReachAltitudeEnvelope,
   * ReachSituation, ReachDestination, PartTest). Older DLLs that only
   * emit title/state/optional leave this undefined.
   */
  parameterType?: string;
  /** ReachAltitudeEnvelope min, metres. */
  minAltitude?: number;
  /** ReachAltitudeEnvelope max, metres. */
  maxAltitude?: number;
  /** ReachDestination body name (matches v.body). */
  body?: string;
  /** ReachSituation / PartTest situation name (Landed, Flying, etc.). */
  situation?: string;
  /** PartTest target part name (e.g. "sensorBarometer"). */
  partName?: string;
}

export interface ContractEntry {
  /**
   * Contract id as a string. KSP contract IDs are full 64-bit longs and
   * frequently exceed Number.MAX_SAFE_INTEGER; the fork emits them as
   * strings (since 2026-05-11) to roundtrip cleanly. The parser accepts
   * legacy numeric IDs too for backwards-compat with older DLLs.
   */
  id: string;
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
    // Accept string (current) OR number (legacy DLL). KSP contract IDs
    // routinely exceed Number.MAX_SAFE_INTEGER, so the fork emits them
    // as strings since 2026-05-11. Older DLLs emit numbers, which we
    // stringify so downstream consumers have one type to deal with.
    let id: string | null = null;
    if (typeof e.id === "string" && e.id.length > 0) id = e.id;
    else if (typeof e.id === "number" && Number.isFinite(e.id))
      id = String(e.id);
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
      parameterType:
        typeof e.parameterType === "string" ? e.parameterType : undefined,
      minAltitude:
        typeof e.minAltitude === "number" ? e.minAltitude : undefined,
      maxAltitude:
        typeof e.maxAltitude === "number" ? e.maxAltitude : undefined,
      body: typeof e.body === "string" ? e.body : undefined,
      situation: typeof e.situation === "string" ? e.situation : undefined,
      partName: typeof e.partName === "string" ? e.partName : undefined,
    });
  }
  return out;
}

/**
 * Convert a contract id string to a JS number when it fits in the
 * safe-integer range. Returns null for KSP-generated long IDs that
 * exceed Number.MAX_SAFE_INTEGER (about 9×10^15). Used to gate
 * features that depend on the alarm system's current
 * `contractId: number` shape.
 */
export function contractIdToSafeNumber(id: string): number | null {
  // Long.TryParse accepts negative IDs too, which JS Number can also
  // represent. Reject scientific-notation strings since they'd already
  // be lossy at this point.
  if (!/^-?\d+$/.test(id)) return null;
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  if (!Number.isSafeInteger(n)) return null;
  return n;
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
  w,
  h,
}: Readonly<ComponentProps<MissionDirectorConfig>>) {
  const activeRaw = useDataValue("data", "contracts.active");
  const offeredRaw = useDataValue("data", "contracts.offered");
  const recentRaw = useDataValue("data", "contracts.completedRecent");
  const universalTime = useDataValue("data", "t.universalTime") as
    | number
    | undefined;
  const vAltitude = useDataValue("data", "v.altitude") as number | undefined;
  const execute = useExecuteAction("data");
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();
  const alarmManager = useAlarmManager();

  const active = parseContracts(activeRaw);
  const offered = parseContracts(offeredRaw);
  const recent = parseContracts(recentRaw);

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  // Wide-short boxes (landscape-18x5) strand the single-column card list: one
  // card fills the full width while the rest scroll off the short height, and
  // the right ~75% sits empty. Only the shape signal can see this — the size
  // bucket reads the same `normal` at 18x5 as at 5x18. Flow the cards into a
  // width-following multi-column grid only when landscape; portrait and square
  // keep the unchanged single column so those sizes can't regress. The section
  // labels (Active / Offered) stay outside the grid so the grouping holds.
  const { shape } = getWidgetShape(w, h);
  const multiColumn = shape === "landscape";

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
        <CardList $multiColumn={multiColumn}>
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
                      {p.state === "Incomplete" &&
                        p.parameterType === "ReachAltitudeEnvelope" &&
                        p.minAltitude !== undefined &&
                        p.maxAltitude !== undefined &&
                        typeof vAltitude === "number" && (
                          <AltitudeProgress
                            min={p.minAltitude}
                            max={p.maxAltitude}
                            current={vAltitude}
                          />
                        )}
                    </ParameterTitle>
                    {p.state === "Incomplete" &&
                      createAlarm &&
                      contractIdToSafeNumber(c.id) !== null &&
                      (() => {
                        const numericId = contractIdToSafeNumber(c.id);
                        if (numericId === null) return null;
                        const existingId =
                          alarmManager?.find((trigger) => {
                            if (
                              !trigger ||
                              typeof trigger !== "object" ||
                              Array.isArray(trigger)
                            )
                              return false;
                            const t = trigger as Record<string, unknown>;
                            return (
                              t.kind === "contract-parameter" &&
                              t.contractId === numericId &&
                              t.parameterTitle === p.title
                            );
                          }) ?? null;
                        const isSet = existingId !== null;
                        return (
                          <ParameterAlarmButton
                            type="button"
                            $set={isSet}
                            title={
                              isSet
                                ? `Alarm set for "${p.title}" — click to clear`
                                : `Alarm me when "${p.title}" completes`
                            }
                            aria-label={
                              isSet
                                ? `Clear alarm for ${p.title}`
                                : `Set alarm for ${p.title} completion`
                            }
                            aria-pressed={isSet}
                            onClick={() => {
                              if (isSet && existingId && alarmManager) {
                                alarmManager.remove(existingId);
                                return;
                              }
                              createAlarm({
                                name: `${p.title} → Complete`,
                                trigger: {
                                  kind: "contract-parameter",
                                  contractId: numericId,
                                  parameterTitle: p.title,
                                  targetState: "Complete",
                                  sustainSeconds: 0,
                                },
                              });
                            }}
                          >
                            <BellIcon size={12} />
                          </ParameterAlarmButton>
                        );
                      })()}
                    {p.state === "Incomplete" &&
                      createAlarm &&
                      contractIdToSafeNumber(c.id) === null && (
                        // Big-id contracts (KSP-generated longs above
                        // Number.MAX_SAFE_INTEGER) can't be addressed by the
                        // current alarm trigger shape (contractId: number).
                        // Render a disabled icon with explanation rather
                        // than hide — keeps the row layout consistent.
                        <ParameterAlarmButton
                          type="button"
                          disabled
                          title="Cannot alarm — contract id exceeds JS safe-integer range. Fix tracked in feature_log."
                          aria-label="Alarm unavailable for this contract"
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
        </CardList>
        {offeredCount > 0 && <SectionLabel>Offered</SectionLabel>}
        <CardList $multiColumn={multiColumn}>
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
        </CardList>
      </Body>
    </Panel>
  );
}

const ARM_TIMEOUT_MS = 4000;

function DeclineButton({
  contractId,
  execute,
}: {
  contractId: string;
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
  contractId: string;
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

// Single column by default (portrait / square). In landscape we switch to a
// width-following grid: `auto-fill` + a min card width derives the column count
// from the available width rather than hardcoding a fixed "2 columns", so the
// same rule fills an 18-wide box with several columns and would scale up if the
// widget were dropped wider. `align-content: start` keeps short lists from
// stretching. The 8px gap matches the single-column flex spacing the Body
// inner used to own between cards, so portrait/square are byte-for-byte
// unchanged. Each Active / Offered section is its own CardList so the section
// labels stay full-width and the grouping holds.
const CARD_MIN_WIDTH = "240px";
const CardList = styled.div<{ $multiColumn: boolean }>`
  ${({ $multiColumn }) =>
    $multiColumn
      ? `display: grid;
         grid-template-columns: repeat(auto-fill, minmax(${CARD_MIN_WIDTH}, 1fr));
         align-content: start;
         gap: 8px;`
      : `display: flex;
         flex-direction: column;
         gap: 8px;`}
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
  /* The animation property must live inside the same media guard as
     the keyframes — wrapping only the keyframes leaves the animation
     active for reduced-motion users (CLAUDE.md a11y rule). */
  @media (prefers-reduced-motion: no-preference) {
    animation: declinePulse 1s ease-in-out infinite;
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
  font-size: 10px;
  padding: 2px 8px;
  /* Reuses the declinePulse @keyframes from ConfirmDeclineButton above
     (declared inside the same media guard). */
  @media (prefers-reduced-motion: no-preference) {
    animation: declinePulse 1s ease-in-out infinite;
  }
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
  flex-wrap: wrap;
  /* row-gap kept tight so a wrapped third reward (FUNDS/SCI/REP at narrow
     widths, e.g. portrait-5x18) sits close under the first line instead of
     overflowing and clipping the panel edge. */
  gap: 2px 12px;
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

/**
 * Inline progress indicator for ReachAltitudeEnvelope parameters. Renders
 * a thin bar showing where the current altitude sits between min and max.
 * Below the band: bar empty + "−Xkm". In the band: bar fully green +
 * "in band". Above: bar full + "+Xkm".
 *
 * Helps the operator see at a glance how close the vessel is to the
 * target band without parsing the title string and doing the maths.
 */
function AltitudeProgress({
  min,
  max,
  current,
}: {
  min: number;
  max: number;
  current: number;
}) {
  const inBand = current >= min && current <= max;
  let fillFrac: number;
  let label: string;
  if (inBand) {
    fillFrac = 1;
    label = "in band";
  } else if (current < min) {
    // Below the band — show progress toward min as fraction.
    fillFrac = Math.max(0, Math.min(1, current / min));
    const delta = min - current;
    label = `−${formatAltitudeShort(delta)}`;
  } else {
    fillFrac = 1;
    const delta = current - max;
    label = `+${formatAltitudeShort(delta)}`;
  }
  return (
    <AltitudeBarRow>
      <AltitudeBarTrack>
        <AltitudeBarFill $frac={fillFrac} $inBand={inBand} />
      </AltitudeBarTrack>
      <AltitudeBarLabel $inBand={inBand}>{label}</AltitudeBarLabel>
    </AltitudeBarRow>
  );
}

function formatAltitudeShort(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

const AltitudeBarRow = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
`;

const AltitudeBarTrack = styled.span`
  display: inline-block;
  width: 60px;
  height: 4px;
  background: var(--color-border-subtle);
  border-radius: 2px;
  overflow: hidden;
`;

const AltitudeBarFill = styled.span.attrs<{ $frac: number; $inBand: boolean }>(
  (p) => ({
    style: { width: `${Math.max(0, Math.min(1, p.$frac)) * 100}%` },
  }),
)<{ $frac: number; $inBand: boolean }>`
  display: block;
  height: 100%;
  background: ${(p) =>
    p.$inBand ? "var(--color-status-go-fg)" : "var(--color-accent-fg)"};
  transition: width 200ms ease;
`;

const AltitudeBarLabel = styled.span<{ $inBand: boolean }>`
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$inBand ? "var(--color-status-go-fg)" : "var(--color-text-muted)"};
`;

const ParameterAlarmButton = styled.button<{ $set?: boolean }>`
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  color: ${(p) =>
    p.$set ? "var(--color-accent-fg)" : "var(--color-text-faint)"};
  display: inline-flex;
  align-items: center;

  &:hover {
    color: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    color: var(--color-text-faint);
  }
`;

const Optional = styled.span`
  color: var(--color-text-faint);
  font-style: italic;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<MissionDirectorConfig>({
  id: "mission-director",
  name: "Contracts Board",
  description:
    "Career contracts with active objectives, deadlines, and rewards. Accept new contracts from the offered list, decline ones you don't want, and cancel active ones (with a confirmation step). A bell next to each open objective sets an alarm that fires when the objective completes.",
  tags: ["career", "contracts"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: MissionDirectorComponent,
  dataRequirements: [
    "contracts.active",
    "contracts.offered",
    "contracts.completedRecent",
    "t.universalTime",
    // Consumed by AltitudeProgress on altitude-bounded contract
    // parameters. Without listing it here the orchestrator never
    // subscribes and the bar stays empty in production.
    "v.altitude",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { MissionDirectorComponent };
