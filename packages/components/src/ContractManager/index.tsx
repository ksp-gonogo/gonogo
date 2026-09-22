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
  type TopicReading,
  useCommand,
  useStream,
  useViewUt,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { KspParameterState, value } from "@ksp-gonogo/sitrep-sdk";
import {
  BellIcon,
  Block,
  CommandButton,
  Panel,
  Section,
  Unit,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
/*
 * One block left: `ParameterAlarmButton` carries a `:focus-visible` ring, which
 * inline style cannot express and which a control must have.
 *
 * Not exempt the way the SVG focus rings are: it is waiting on a kit primitive
 * giving the ring and the disabled treatment at caller-chosen geometry. It is a
 * chrome-less icon button at control padding, and the kit has no such thing:
 * `IconButton` is tighter and has no ring of its own, `TextButton` is
 * underlined link styling.
 */
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
 * is the point: a state this build does not recognise gets its own answer
 * rather than collapsing onto `"Incomplete"`. Collapsing would read a completed
 * objective as outstanding and a mod's appended state as work still to do. An
 * unrecognised state is not the pessimistic arm, it is a third answer, and the
 * widget says so on screen.
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
  reading: TopicReading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
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

/**
 * Format a UT-second deadline relative to the current universal time.
 *
 * The remaining time is GAME seconds, so it is a `"s"` quantity and rides the
 * kit's time ladder, which sizes a day by the calendar the game reported (6h
 * under stock, 426d years) rather than by a real one. Written as a string
 * rather than rendered as a node because the phrase is a whole caption, "5d 2h
 * left", and both call sites want the sentence rather than its pieces.
 */
export function formatDeadline(
  deadlineUt: number,
  universalTime: number,
): string {
  if (!deadlineUt || deadlineUt <= 0) return "no deadline";
  const remaining = deadlineUt - universalTime;
  if (remaining <= 0) return "expired";
  // Floored at a minute: the ladder's finest rung the operator needs here, and
  // sub-minute resolution would add noise to a card that is scanned, not read.
  return `${writeQuantity(value("s", Math.max(60, remaining)))} left`;
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
      <Panel
        panelTitle="CONTRACT MANAGER"
        compactTitle={["CONTRACTS"]}
        sections={
          <Section>
            {showSubtitle && (
              <div style={EMPTY_STYLE}>Awaiting contract telemetry</div>
            )}
          </Section>
        }
      />
    );
  }

  const activeCount = active.length;
  const offeredCount = offered?.length ?? 0;
  const recentCount = recent?.length ?? 0;

  return (
    <Panel
      panelTitle="CONTRACT MANAGER"
      compactTitle={["CONTRACTS"]}
      sections={
        <Section>
          {showSubtitle && (
            <div style={SUMMARY_STYLE} role="status" aria-live="polite">
              {activeCount} active · {offeredCount} offered · {recentCount}{" "}
              recent
            </div>
          )}
          {activeCount === 0 && offeredCount === 0 && (
            <div style={EMPTY_STYLE}>
              No active contracts. Pick one up in Mission Control.
            </div>
          )}
          {activeCount > 0 && <div style={SECTION_LABEL_STYLE}>Active</div>}
          <div style={cardListStyle(multiColumn)}>
            {active.map((c) => (
              <ContractCard
                key={c.id}
                title={c.title}
                titleRight={
                  <span style={DEADLINE_STYLE}>
                    {formatDeadline(
                      c.deadlineUt,
                      universalTime?.magnitude ?? 0,
                    )}
                  </span>
                }
              >
                {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
                <div style={REWARDS_STYLE}>
                  {c.fundsCompletion > 0 && (
                    <div style={REWARD_STYLE}>
                      <span style={REWARD_LABEL_STYLE}>FUNDS</span>
                      <span style={REWARD_VALUE_STYLE}>
                        {formatCompactCurrency(c.fundsCompletion)}
                      </span>
                    </div>
                  )}
                  {c.scienceCompletion > 0 && (
                    <div style={REWARD_STYLE}>
                      <span style={REWARD_LABEL_STYLE}>SCI</span>
                      <span style={REWARD_VALUE_STYLE}>
                        {c.scienceCompletion.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {c.repCompletion > 0 && (
                    <div style={REWARD_STYLE}>
                      <span style={REWARD_LABEL_STYLE}>REP</span>
                      <span style={REWARD_VALUE_STYLE}>
                        {c.repCompletion.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
                {c.parameters.length > 0 && (
                  <ul style={PARAMETERS_STYLE}>
                    {c.parameters.map((p) => (
                      <li
                        key={`${c.id}-${p.title}`}
                        style={parameterStyle(p.state)}
                      >
                        <span
                          style={parameterMarkStyle(p.state)}
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
                        </span>
                        <span style={PARAMETER_TITLE_STYLE}>
                          {p.title}
                          {p.optional && (
                            <span style={OPTIONAL_STYLE}> (optional)</span>
                          )}
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
                        </span>
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
                      </li>
                    ))}
                  </ul>
                )}
                <div style={ACTIVE_ACTIONS_STYLE}>
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
                </div>
              </ContractCard>
            ))}
          </div>
          {offeredCount > 0 && <div style={SECTION_LABEL_STYLE}>Offered</div>}
          <div style={cardListStyle(multiColumn)}>
            {offered?.map((c) => (
              <ContractCard
                key={c.id}
                title={c.title}
                titleRight={
                  <span style={DEADLINE_STYLE}>
                    {formatDeadline(
                      c.deadlineUt,
                      universalTime?.magnitude ?? 0,
                    )}
                  </span>
                }
              >
                {c.agency && <div style={AGENCY_STYLE}>{c.agency}</div>}
                <div style={REWARDS_STYLE}>
                  {c.fundsCompletion > 0 && (
                    <div style={REWARD_STYLE}>
                      <span style={REWARD_LABEL_STYLE}>FUNDS</span>
                      <span style={REWARD_VALUE_STYLE}>
                        {formatCompactCurrency(c.fundsCompletion)}
                      </span>
                    </div>
                  )}
                  {c.scienceCompletion > 0 && (
                    <div style={REWARD_STYLE}>
                      <span style={REWARD_LABEL_STYLE}>SCI</span>
                      <span style={REWARD_VALUE_STYLE}>
                        {c.scienceCompletion.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {c.repCompletion > 0 && (
                    <div style={REWARD_STYLE}>
                      <span style={REWARD_LABEL_STYLE}>REP</span>
                      <span style={REWARD_VALUE_STYLE}>
                        {c.repCompletion.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
                <div style={OFFERED_ACTIONS_STYLE}>
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
                </div>
              </ContractCard>
            ))}
          </div>
        </Section>
      }
    />
  );
}

const EMPTY_STYLE = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  padding: "var(--space-8) 0",
} as const;

const SUMMARY_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
} as const;

const CARD_MIN_WIDTH = "240px";

/**
 * Single column by default (portrait / square). In landscape it becomes a
 * width-following grid: `auto-fill` plus a min card width derives the column
 * count from the available width rather than hardcoding two columns, so the
 * same rule fills an 18-wide box with several columns and scales up if the
 * widget is dropped wider. `alignContent: start` keeps short lists from
 * stretching. Each Active / Offered section is its own list so the section
 * labels stay full-width and the grouping holds.
 *
 * Section rather than related: with no box around a contract, the space
 * between two of them is the only thing saying where one ends. At the same rung
 * as a block's own rows they ran together into one paragraph. Both branches
 * carry the same gap, which is what makes them one layout rather than two.
 */
function cardListStyle(multiColumn: boolean) {
  return multiColumn
    ? ({
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH}, 1fr))`,
        alignContent: "start",
        gap: "var(--gap-section)",
      } as const)
    : ({
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-section)",
      } as const);
}

const SECTION_LABEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
  marginTop: "var(--space-4)",
} as const;

const OFFERED_ACTIONS_STYLE = {
  display: "flex",
  gap: "var(--gap-related)",
  marginTop: "var(--space-4)",
} as const;

const ACTIVE_ACTIONS_STYLE = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "var(--gap-related)",
  marginTop: "var(--space-4)",
} as const;

/**
 * A contract as a grouping rather than a box. `Block`, not `Card`: this widget
 * lists many contracts in a panel that is already a surface, and a sunken
 * record inside it read as a second box for no gain. Nothing is drawn here.
 * The separation is the list gap and the title's own weight.
 */
const ContractCard = Block;

const DEADLINE_STYLE = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
} as const;

const AGENCY_STYLE = {
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
} as const;

/*
 * The row gap is kept tight so a wrapped third reward (FUNDS/SCI/REP at narrow
 * widths, e.g. portrait-5x18) sits close under the first line instead of
 * overflowing and clipping the panel edge.
 */
const REWARDS_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2) var(--space-12)",
} as const;

const REWARD_STYLE = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
} as const;

const REWARD_LABEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.1em",
  color: "var(--color-text-faint)",
} as const;

const REWARD_VALUE_STYLE = {
  fontSize: "var(--font-size-value)",
  fontWeight: 600,
  color: "var(--color-accent-fg)",
  fontVariantNumeric: "tabular-nums",
} as const;

const PARAMETERS_STYLE = {
  listStyle: "none",
  margin: "var(--space-4) 0 0",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
} as const;

/** A completed objective is struck through and stood down to muted. */
function parameterStyle(state: ContractParameterState) {
  return {
    display: "flex",
    alignItems: "baseline",
    gap: "var(--gap-related)",
    fontSize: "var(--font-size-compact)",
    color:
      state === "Complete"
        ? "var(--color-text-muted)"
        : state === "Failed"
          ? "var(--color-status-nogo-fg)"
          : "var(--color-text-primary)",
    textDecoration: state === "Complete" ? "line-through" : "none",
  } as const;
}

/** The fixed-width column the tick, cross, question mark or ring sits in. */
function parameterMarkStyle(state: ContractParameterState) {
  return {
    fontFamily: "monospace",
    width: "10px",
    textAlign: "center",
    color:
      state === "Complete"
        ? "var(--color-status-go-fg)"
        : state === "Failed"
          ? "var(--color-status-nogo-fg)"
          : "var(--color-text-faint)",
  } as const;
}

const PARAMETER_TITLE_STYLE = { flex: 1, minWidth: 0 } as const;
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
    <span style={ALT_ROW_STYLE}>
      <span style={ALT_TRACK_STYLE}>
        <span style={altFillStyle(fillFrac, inBand)} />
      </span>
      <span style={altLabelStyle(inBand)}>{label}</span>
    </span>
  );
}

// The shared `length` ladder, so a high-orbit contract target does not render
// as five digits of km. Decimals stay tied to the magnitude the way the
// hand-rolled version had them: this label sits inline in a contract row and
// its width matters more than its last digit.
function AltitudeShort({ m }: { m: number }) {
  return <Unit value={value("m", m)} decimals={Math.abs(m) < 10_000 ? 1 : 0} />;
}

const ALT_ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
  marginTop: "var(--space-2)",
} as const;

/*
 * A stadium, not a corner: --radius-pill clamps to half the shorter side, so it
 * tracks the track height, which --radius-regular (the value this 2px maps to)
 * would not.
 */
const ALT_TRACK_STYLE = {
  display: "inline-block",
  width: "60px",
  height: "4px",
  background: "var(--color-border-subtle)",
  borderRadius: "var(--radius-pill)",
  overflow: "hidden",
} as const;

function altFillStyle(frac: number, inBand: boolean) {
  return {
    display: "block",
    height: "100%",
    width: `${Math.max(0, Math.min(1, frac)) * 100}%`,
    background: inBand ? "var(--color-status-go-fg)" : "var(--color-accent-fg)",
    transition: "width var(--duration-slow) var(--ease-standard)",
  } as const;
}

function altLabelStyle(inBand: boolean) {
  return {
    fontSize: "var(--font-size-compact)",
    fontVariantNumeric: "tabular-nums",
    color: inBand ? "var(--color-status-go-fg)" : "var(--color-text-muted)",
  } as const;
}

const ParameterAlarmButton = styled.button<{ $set?: boolean }>`
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: var(--inset-control);
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

const OPTIONAL_STYLE = {
  color: "var(--color-text-faint)",
  fontStyle: "italic",
} as const;

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
