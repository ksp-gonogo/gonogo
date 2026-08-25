import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  formatCompactCurrency,
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  type Reading,
  useCommand,
  useStream,
  useViewUt,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { KspParameterState, value } from "@ksp-gonogo/sitrep-sdk";
import {
  BellIcon,
  CommandButton,
  formatDuration,
  Panel,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import styled from "styled-components";
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["career.status", "vessel.state"],
  // `altitudeAsl` is consumed by AltitudeProgress on altitude-bounded contract
  // parameters; without it the orchestrator never subscribes and the bar stays
  // empty in production.
  fields: [
    "career.status.contracts.active",
    "career.status.contracts.offered",
    "career.status.contracts.completedRecent",
    "vessel.state.altitudeAsl",
  ],
});

/**
 * Trigger shape used by the Mission Director's parameter bells. Mirrors
 * `ContractParameterTrigger` in `@ksp-gonogo/app/src/alarms/types.ts`;
 * declared inline here because @ksp-gonogo/components can't import from
 * @ksp-gonogo/app (would be circular). The bridge in
 * `AlarmsLauncherBridge.tsx` accepts the shape via the generic
 * `AlarmCreator<TTrigger>` interface.
 */
export interface ContractParameterAlarmTrigger {
  kind: "contract-parameter";
  contractId: number;
  parameterTitle: string;
  targetState: "Complete" | "Failed";
  sustainSeconds: number;
}

type ContractManagerConfig = Record<string, never>;

/**
 * An objective's state, as this widget models it.
 *
 * The first three are KSP's `Contracts.ParameterState`. `"Unknown"` is OURS and
 * is the point: a state this build does not recognise used to collapse onto
 * `"Incomplete"`, so a completed objective read as outstanding and a mod's
 * appended state read as work still to do. An unrecognised state is not the
 * pessimistic arm, it is a third answer, and the widget says so on screen.
 */
export type ContractParameterState =
  | "Incomplete"
  | "Complete"
  | "Failed"
  | "Unknown";

export interface ContractParameter {
  title: string;
  state: ContractParameterState;
  /** KSP's own word for the state, shown when {@link state} is `"Unknown"` so
   *  the operator reads the game's vocabulary rather than a bare question mark.
   *  Empty when the producer sent no name. */
  stateLabel: string;
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

/**
 * KSP's `ParameterState` ordinal → the state this widget models.
 *
 * Keyed on the ORDINAL, not the name. `state` still arrives beside it and is
 * still the label shown for an unrecognised value, but nothing here compares it:
 * `ParameterState` is KSP's enum and its spelling is KSP's to change.
 */
const PARAM_STATE_BY_ORDINAL: ReadonlyMap<number, ContractParameterState> =
  new Map([
    [KspParameterState.Incomplete, "Incomplete"],
    [KspParameterState.Complete, "Complete"],
    [KspParameterState.Failed, "Failed"],
  ]);

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
 * What an objective's state actually is. An ordinal outside KSP's own members,
 * or no ordinal at all, is `"Unknown"`: we cannot say the objective is done and
 * we equally cannot say it is outstanding.
 */
function paramState(ordinal: unknown): ContractParameterState {
  if (typeof ordinal !== "number") return "Unknown";
  return PARAM_STATE_BY_ORDINAL.get(ordinal) ?? "Unknown";
}

/**
 * Defensive parser for contract array payloads. Accepts BOTH the legacy
 * GonogoTelemetry shape (`contracts.active`/`contracts.offered`/
 * `contracts.completedRecent`: `agency`/`repCompletion`/`deadlineUt`) and
 * the career-detail wire shape (`career.status.contracts.active`/
 * `.offered`, mod/Sitrep.Host/CareerViewProvider.cs's `BuildContractList`:
 * `agent`/`reputationCompletion`/`dateDeadline`): same "one parser, either
 * wire shape" pattern ScienceBench's `parseExperiments` established
 * (`partName ?? part`, map-topic.ts's doc comment). The new shape's
 * `parameters` only carry `{title, state}` (no `optional`/`parameterType`/
 * altitude bounds: decompile-confirmed exact shape); those extra fields simply
 * stay undefined on a new-wire
 * parameter, degrading the AltitudeProgress bar/optional-badge gracefully
 * rather than breaking. Drops malformed entries; tolerates unknown
 * parameter states by reporting them as "Unknown", never by collapsing them
 * onto an arm we cannot justify.
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
    // agency/agent, repCompletion/reputationCompletion, deadlineUt/
    // dateDeadline: legacy vs. career.status field names for the same
    // value: prefer whichever the payload actually carries.
    const agency =
      typeof e.agency === "string"
        ? e.agency
        : typeof e.agent === "string"
          ? e.agent
          : "";
    const repCompletion =
      magnitudeOf(e.repCompletion as Quantityish) ??
      magnitudeOf(e.reputationCompletion as Quantityish) ??
      0;
    const deadlineUt =
      magnitudeOf(e.deadlineUt as Quantityish) ??
      magnitudeOf(e.dateDeadline as Quantityish) ??
      0;
    out.push({
      id,
      title: typeof e.title === "string" ? e.title : "(unnamed contract)",
      agency,
      state: typeof e.state === "string" ? e.state : "",
      fundsAdvance: magnitudeOr(e.fundsAdvance as Quantityish, 0),
      fundsCompletion: magnitudeOr(e.fundsCompletion as Quantityish, 0),
      scienceCompletion: magnitudeOr(e.scienceCompletion as Quantityish, 0),
      repCompletion,
      deadlineUt,
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
    out.push({
      title: typeof e.title === "string" ? e.title : "(unnamed)",
      state: paramState(e.stateOrdinal),
      stateLabel: typeof e.state === "string" ? e.state : "",
      optional: e.optional === true,
      parameterType:
        typeof e.parameterType === "string" ? e.parameterType : undefined,
      minAltitude: magnitudeOf(e.minAltitude as Quantityish) ?? undefined,
      maxAltitude: magnitudeOf(e.maxAltitude as Quantityish) ?? undefined,
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
  return `${formatDuration(Math.max(60, remaining))} left`;
}

function ContractManagerComponent({
  w,
  h,
}: Readonly<ComponentProps<ContractManagerConfig>>) {
  // active/offered/completedRecent all ride the `career.status` Topic's
  // `contracts` sub-tree (map-topic.ts): read the Topic once and pick them off.
  //
  // Facts, so they are held through a quiet link. A contract joins the offered
  // board, gets accepted, or completes because the PLAYER or the game did
  // something, and none of that can happen down a link that is not delivering:
  // the last board we were sent is still the board. Blanking it would claim the
  // programme has no contracts, which is a positive statement about career state
  // made from the absence of a frame. Same split `SpaceCenterStatus` makes, where
  // the facility tiers stay and only the funds balance goes.
  //
  // Nothing on these records is a quantity that drifts on its own. The one
  // number that moves, the deadline countdown, is not remembered at all: it is
  // computed from a FIXED `deadlineUt` against the frame's view UT, and that
  // view time is the confirmed edge, so with nothing arriving it holds where the
  // last sample left it rather than inventing progress the link cannot support.
  const contracts = stillTrue(
    useTelemetry("career.status"),
    undefined,
  )?.contracts;
  const activeRaw = contracts?.active;
  const offeredRaw = contracts?.offered;
  const recentRaw = contracts?.completedRecent;
  // t.universalTime is dropped as a data key, it was never a stream, it IS
  // the SDK view-UT the propagation is evaluated at, so read that directly.
  const universalTime = useViewUt();
  // `v.altitude` -> derived `vessel.state.altitudeAsl` (`null` in the
  // propagated basis): collapse to `undefined` for the numeric comparisons.
  const vAltitude =
    useStream<VesselState>("vessel.state")?.altitudeAsl ?? undefined;
  // Career actions dispatch at the meta-vantage: accepting/declining/cancelling
  // a contract is a program-desk action with no vessel signal delay, so it
  // stays instant regardless of the selected command centre. The handles are
  // contributed to the panel delay rail by usePanelDelay (nothing at meta-vantage).
  const acceptCmd = useCommand("career.contract.accept", {
    vantage: META_VANTAGE,
  });
  const declineCmd = useCommand("career.contract.decline", {
    vantage: META_VANTAGE,
  });
  const cancelCmd = useCommand("career.contract.cancel", {
    vantage: META_VANTAGE,
  });
  usePanelDelay(acceptCmd);
  usePanelDelay(declineCmd);
  usePanelDelay(cancelCmd);
  const createAlarm = useAlarmCreator<ContractParameterAlarmTrigger>();
  const alarmManager = useAlarmManager();

  const active = parseContracts(activeRaw);
  const offered = parseContracts(offeredRaw);
  const recent = parseContracts(recentRaw);

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  // Wide-short boxes (landscape-18x5) strand the single-column card list: one
  // card fills the full width while the rest scroll off the short height, and
  // the right ~75% sits empty. Only the shape signal can see this, the size
  // bucket reads the same `normal` at 18x5 as at 5x18. Flow the cards into a
  // width-following multi-column grid only when landscape; portrait and square
  // keep the unchanged single column so those sizes can't regress. The section
  // labels (Active / Offered) stay outside the grid so the grouping holds.
  const { shape } = getWidgetShape(w, h);
  const multiColumn = shape === "landscape";

  if (active === null) {
    return (
      <Panel panelTitle="CONTRACT MANAGER">
        {showSubtitle && <Empty>Awaiting contract telemetry</Empty>}
      </Panel>
    );
  }

  const activeCount = active.length;
  const offeredCount = offered?.length ?? 0;
  const recentCount = recent?.length ?? 0;

  return (
    <Panel panelTitle="CONTRACT MANAGER">
      {showSubtitle && (
        <Summary role="status" aria-live="polite">
          {activeCount} active · {offeredCount} offered · {recentCount} recent
        </Summary>
      )}
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
                {formatDeadline(c.deadlineUt, universalTime?.magnitude ?? 0)}
              </ContractDeadline>
            </ContractHeader>
            {c.agency && <Agency>{c.agency}</Agency>}
            <Rewards>
              {c.fundsCompletion > 0 && (
                <Reward>
                  <RewardLabel>FUNDS</RewardLabel>
                  <RewardValue>
                    {formatCompactCurrency(c.fundsCompletion)}
                  </RewardValue>
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
                    <ParameterMark
                      $state={p.state}
                      // Only on the Unknown arm: the ✓/✕/○ marks already say
                      // what they are, and the "?" is the one that needs to
                      // report the game's own word for a state we cannot place.
                      title={
                        p.state === "Unknown"
                          ? `Unrecognised objective state${p.stateLabel ? `: ${p.stateLabel}` : ""}`
                          : undefined
                      }
                    >
                      {p.state === "Complete"
                        ? "✓"
                        : p.state === "Failed"
                          ? "✕"
                          : p.state === "Unknown"
                            ? "?"
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
                                ? `Alarm set for "${p.title}": click to clear`
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
                        // than hide: keeps the row layout consistent.
                        <ParameterAlarmButton
                          type="button"
                          disabled
                          title="Cannot alarm: contract id exceeds JS safe-integer range. Fix tracked in feature_log."
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
              <CommandButton
                handle={cancelCmd}
                args={{ contractId: c.id }}
                commandLabel={`Cancel ${c.title}`}
                size="sm"
                label="Cancel"
                /* Cancel forfeits any work in progress, so the confirm copy is
                   stronger than Decline's: the loss is bigger, funds may
                   already be spent and parameters part-achieved. */
                confirmLabel="Forfeit contract"
                confirmTone="nogo"
                pendingLabel="Cancelling..."
                title="Cancel this contract: forfeits all progress"
              />
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
                {formatDeadline(c.deadlineUt, universalTime?.magnitude ?? 0)}
              </ContractDeadline>
            </ContractHeader>
            {c.agency && <Agency>{c.agency}</Agency>}
            <Rewards>
              {c.fundsCompletion > 0 && (
                <Reward>
                  <RewardLabel>FUNDS</RewardLabel>
                  <RewardValue>
                    {formatCompactCurrency(c.fundsCompletion)}
                  </RewardValue>
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
              <CommandButton
                handle={acceptCmd}
                args={{ contractId: c.id }}
                commandLabel={`Accept ${c.title}`}
                size="sm"
                tone="go"
                label="Accept"
                pendingLabel="Accepting..."
              />
              <CommandButton
                handle={declineCmd}
                args={{ contractId: c.id }}
                commandLabel={`Decline ${c.title}`}
                size="sm"
                label="Decline"
                confirmLabel="Confirm decline"
                confirmTone="nogo"
                pendingLabel="Declining..."
              />
            </OfferedActions>
          </ContractCard>
        ))}
      </CardList>
    </Panel>
  );
}

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-sm);
  padding: var(--space-8) 0;
`;

const Summary = styled.div`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
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
         gap: var(--space-8);`
      : `display: flex;
         flex-direction: column;
         gap: var(--space-8);`}
`;

const SectionLabel = styled.div`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: var(--space-4);
`;

const OfferedActions = styled.div`
  display: flex;
  gap: var(--space-6);
  margin-top: var(--space-4);
`;

const ActiveActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--space-6);
  margin-top: var(--space-4);
`;

const ContractCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8);
  background: var(--color-surface-panel);
  border-radius: var(--radius-xs);
`;

const ContractHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-8);
  /* At very narrow widths (compact-4x5) the title (flex:1, wrapping text)
     and the fixed-width deadline label had no room to both sit on one row:
     the deadline text (flex-shrink:0) claimed its full width regardless,
     squeezing the title's flex-basis down to its longest unbreakable word
     with no room left for the gap, so the two ran together with zero
     space between them ("Buildno deadline"). Let the deadline wrap to its
     own line instead of collapsing the gap. */
  flex-wrap: wrap;
`;

const ContractTitle = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: var(--font-size-sm);
  flex: 1;
  /* A flex-basis:0 item (what plain "flex: 1" gives) always "fits" its
     flex line at its pre-grow hypothetical size of zero, so ContractHeader's
     flex-wrap never triggered even when there wasn't room: the title's box
     shrank to near-nothing while ContractDeadline (flex-shrink:0) claimed
     its full width, and the title's own unbreakable first word then
     overflowed that near-zero box straight into the deadline text with no
     gap at all ("Buildno deadline" at compact-4x5). A real min-width gives
     the title enough box to hold at least one full word, so when the
     deadline label can't fit alongside it, flex-wrap actually pushes the
     deadline onto its own line instead of the two colliding. */
  min-width: 90px;
`;

const ContractDeadline = styled.span`
  color: var(--color-text-faint);
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

const Agency = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
`;

const Rewards = styled.div`
  display: flex;
  flex-wrap: wrap;
  /* row-gap kept tight so a wrapped third reward (FUNDS/SCI/REP at narrow
     widths, e.g. portrait-5x18) sits close under the first line instead of
     overflowing and clipping the panel edge. */
  gap: var(--space-2) var(--space-12);
`;

const Reward = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
`;

const RewardLabel = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
`;

const RewardValue = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const Parameters = styled.ul`
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const Parameter = styled.li<{ $state: ContractParameterState }>`
  display: flex;
  align-items: baseline;
  gap: var(--space-6);
  font-size: var(--font-size-xs);
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
  let label: ReactNode;
  if (inBand) {
    fillFrac = 1;
    label = "in band";
  } else if (current < min) {
    // Below the band: show progress toward min as fraction.
    fillFrac = Math.max(0, Math.min(1, current / min));
    const delta = min - current;
    label = (
      <>
        −<AltitudeShort m={delta} />
      </>
    );
  } else {
    fillFrac = 1;
    const delta = current - max;
    label = (
      <>
        +<AltitudeShort m={delta} />
      </>
    );
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

// The shared `length` ladder, so a high-orbit contract target does not render
// as five digits of km. Decimals stay tied to the magnitude the way the
// hand-rolled version had them: this label sits inline in a contract row and
// its width matters more than its last digit.
function AltitudeShort({ m }: { m: number }) {
  return <Unit value={value("m", m)} decimals={Math.abs(m) < 10_000 ? 1 : 0} />;
}

const AltitudeBarRow = styled.span`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-top: var(--space-2);
`;

const AltitudeBarTrack = styled.span`
  display: inline-block;
  width: 60px;
  height: 4px;
  background: var(--color-border-subtle);
  /* A stadium, not a corner: the radius is exactly half the track height.
     --radius-pill clamps to half the shorter side, so it renders
     identically today and keeps tracking the height if that changes,
     which --radius-xs (the value this 2px maps to) would not. */
  border-radius: var(--radius-pill);
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
  transition: width var(--duration-slow) var(--ease-standard);
`;

const AltitudeBarLabel = styled.span<{ $inBand: boolean }>`
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$inBand ? "var(--color-status-go-fg)" : "var(--color-text-muted)"};
`;

const ParameterAlarmButton = styled.button<{ $set?: boolean }>`
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: var(--space-2) var(--space-4);
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

registerComponent<ContractManagerConfig>({
  id: "contract-manager",
  name: "Contract Manager",
  description:
    "Career contracts with active objectives, deadlines, and rewards. Accept new contracts from the offered list, decline ones you don't want, and cancel active ones (with a confirmation step). A bell next to each open objective sets an alarm that fires when the objective completes.",
  tags: ["career", "contracts"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: ContractManagerComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { ContractManagerComponent };
