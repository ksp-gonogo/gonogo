import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  formatCompactCurrency,
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand, useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  combineReadings,
  KspParameterState,
  type Reading,
  stillTrue,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  BellIcon,
  Block,
  CommandButton,
  formatStreamStatus,
  Meter,
  Panel,
  Section,
  severityFromStreamStatus,
  speakQuantity,
  Unit,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
/* `ParameterAlarmButton` needs a `:focus-visible` ring, which inline style cannot express. */
import styled from "styled-components";
import { useAlarmCreator, useAlarmManager } from "../shared/AlarmsLauncher";
import { heldGrade } from "../shared/heldGrade";
import { asQuantityish, magnitudeOf, magnitudeOr } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["career.status", "vessel.flight"],
  // Without `altitudeAsl` listed the orchestrator never subscribes and AltitudeProgress stays empty.
  fields: [
    "career.status.contracts.active",
    "career.status.contracts.offered",
    "career.status.contracts.completedRecent",
    "vessel.flight.altitudeAsl",
  ],
});

/**
 * Trigger shape for the parameter bells. Mirrors the app's
 * `ContractParameterTrigger`, which this package cannot import.
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
 * An objective's state. The first three are KSP's `Contracts.ParameterState`;
 * `"Unknown"` is a third answer for a state this build does not recognise,
 * never a collapse onto `"Incomplete"`.
 */
export type ContractParameterState =
  | "Incomplete"
  | "Complete"
  | "Failed"
  | "Unknown";

export interface ContractParameter {
  title: string;
  state: ContractParameterState;
  /** KSP's own word for the state, shown when {@link state} is `"Unknown"`; empty when none was sent. */
  stateLabel: string;
  optional: boolean;
  /** Lower bound of the altitude band the objective requires, metres. */
  minAltitude?: number;
  /** Upper bound of the altitude band the objective requires, metres. */
  maxAltitude?: number;
  /** ReachDestination body name (matches v.body). */
  body?: string;
  /** ReachSituation / PartTest situation name (Landed, Flying, etc.). */
  situation?: string;
  /** PartTest target part name (e.g. "sensorBarometer"). */
  partName?: string;
}

export interface ContractEntry {
  /** KSP contract ids are 64-bit longs that exceed Number.MAX_SAFE_INTEGER, so they travel as strings. */
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
 * KSP's `ParameterState` ordinal to the state this widget models. Keyed on
 * the ordinal, never the name: the spelling is KSP's to change.
 */
const PARAM_STATE_BY_ORDINAL: ReadonlyMap<number, ContractParameterState> =
  new Map([
    [KspParameterState.Incomplete, "Incomplete"],
    [KspParameterState.Complete, "Complete"],
    [KspParameterState.Failed, "Failed"],
  ]);

/**
 * What an objective's state actually is. An ordinal outside KSP's members, or
 * none at all, is `"Unknown"`: neither done nor outstanding.
 */
function paramState(ordinal: unknown): ContractParameterState {
  if (typeof ordinal !== "number") return "Unknown";
  return PARAM_STATE_BY_ORDINAL.get(ordinal) ?? "Unknown";
}

/**
 * Defensive parser for contract array payloads, accepting both field spellings
 * (`agency`/`agent`, `repCompletion`/`reputationCompletion`,
 * `deadlineUt`/`dateDeadline`). Parameter fields the wire does not carry stay
 * undefined. Drops malformed entries and reports unrecognised parameter states
 * as "Unknown".
 */
export function parseContracts(raw: unknown): ContractEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ContractEntry[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    // A numeric id is stringified so downstream has one type.
    let id: string | null = null;
    if (typeof e.id === "string" && e.id.length > 0) id = e.id;
    else if (typeof e.id === "number" && Number.isFinite(e.id))
      id = String(e.id);
    if (id === null) continue;
    const agency =
      typeof e.agency === "string"
        ? e.agency
        : typeof e.agent === "string"
          ? e.agent
          : "";
    const repCompletion =
      magnitudeOf(asQuantityish(e.repCompletion)) ??
      magnitudeOf(asQuantityish(e.reputationCompletion)) ??
      0;
    const deadlineUt =
      magnitudeOf(asQuantityish(e.deadlineUt)) ??
      magnitudeOf(asQuantityish(e.dateDeadline)) ??
      0;
    out.push({
      id,
      title: typeof e.title === "string" ? e.title : "(unnamed contract)",
      agency,
      state: typeof e.state === "string" ? e.state : "",
      fundsAdvance: magnitudeOr(asQuantityish(e.fundsAdvance), 0),
      fundsCompletion: magnitudeOr(asQuantityish(e.fundsCompletion), 0),
      scienceCompletion: magnitudeOr(asQuantityish(e.scienceCompletion), 0),
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
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      title: typeof e.title === "string" ? e.title : "(unnamed)",
      state: paramState(e.stateOrdinal),
      stateLabel: typeof e.state === "string" ? e.state : "",
      optional: e.optional === true,
      minAltitude: magnitudeOf(asQuantityish(e.minAltitude)) ?? undefined,
      maxAltitude: magnitudeOf(asQuantityish(e.maxAltitude)) ?? undefined,
      body: typeof e.body === "string" ? e.body : undefined,
      situation: typeof e.situation === "string" ? e.situation : undefined,
      partName: typeof e.partName === "string" ? e.partName : undefined,
    });
  }
  return out;
}

/**
 * A contract id as a JS number when it fits the safe-integer range, else null.
 * Gates features that depend on the alarm system's `contractId: number`.
 */
export function contractIdToSafeNumber(id: string): number | null {
  // Negative ids are valid; scientific notation would already be lossy.
  if (!/^-?\d+$/.test(id)) return null;
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/**
 * Format a UT-second deadline relative to the current universal time.
 *
 * The remaining time is game seconds, so it rides the kit's time ladder and
 * sizes a day by the game's own calendar.
 */
export function formatDeadline(
  deadlineUt: number,
  universalTime: number,
): string {
  if (!deadlineUt || deadlineUt <= 0) return "no deadline";
  const remaining = deadlineUt - universalTime;
  if (remaining <= 0) return "expired";
  // Floored at a minute: a card that is scanned needs no sub-minute noise.
  return `${writeQuantity(value("s", Math.max(60, remaining)))} left`;
}

function ContractManagerComponent({
  w,
  h,
}: Readonly<ComponentProps<ContractManagerConfig>>) {
  /*
   * The contract board is a fact: it changes only when the player or the game
   * acts, so the last board sent is still the board. The deadline countdown is
   * computed from a fixed `deadlineUt` against the confirmed view UT, so it holds
   * rather than inventing progress.
   */
  const careerReading = useTelemetry("career.status");
  const contracts = stillTrue(careerReading, undefined)?.contracts;
  // A held board marks every card and kills its controls: a Cancel against a held board forfeits a contract the operator cannot see.
  const boardHeld = heldGrade(careerReading);
  const activeRaw = contracts?.active;
  const offeredRaw = contracts?.offered;
  const recentRaw = contracts?.completedRecent;
  const universalTime = useViewUt();
  // The field reading, not a derived copy, so the bar survives the craft going on rails.
  const altitudeReading = topics.useTelemetry("vessel.flight").altitudeAsl;
  // Career actions dispatch at the meta-vantage, with no vessel signal delay.
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
  // Only the shape can see a wide-short box stranding a single-column list, so landscape flows into a grid.
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
                  <>
                    <span style={DEADLINE_STYLE}>
                      {formatDeadline(
                        c.deadlineUt,
                        universalTime?.magnitude ?? 0,
                      )}
                    </span>
                    {boardHeld !== undefined && (
                      /* On the card, in the operator's eyeline while they look at its Cancel. */
                      <Badge
                        severity={severityFromStreamStatus(boardHeld)}
                        size="sm"
                        title="Contract board is no longer current"
                      >
                        {formatStreamStatus(boardHeld)}
                      </Badge>
                    )}
                  </>
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
                          // Only on the Unknown arm: report the game's own word for a state we cannot place.
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
                            p.minAltitude !== undefined &&
                            p.maxAltitude !== undefined && (
                              <AltitudeProgress
                                min={p.minAltitude}
                                max={p.maxAltitude}
                                altitude={altitudeReading}
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
                            // A long id cannot fit the alarm trigger's `contractId: number`, so the button renders disabled.
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
                    /* Cancel forfeits work in progress and spent funds, so its confirm is stronger than Decline's. */
                    confirmLabel="Forfeit contract"
                    confirmTone="nogo"
                    pendingLabel="Cancelling..."
                    disabled={boardHeld !== undefined}
                    title={
                      boardHeld === undefined
                        ? "Cancel this contract: forfeits all progress"
                        : "Contract board is no longer current: cancelling would forfeit a contract whose state cannot be read"
                    }
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
                  <>
                    <span style={DEADLINE_STYLE}>
                      {formatDeadline(
                        c.deadlineUt,
                        universalTime?.magnitude ?? 0,
                      )}
                    </span>
                    {boardHeld !== undefined && (
                      /* On the card, in the operator's eyeline while they look at its Cancel. */
                      <Badge
                        severity={severityFromStreamStatus(boardHeld)}
                        size="sm"
                        title="Contract board is no longer current"
                      >
                        {formatStreamStatus(boardHeld)}
                      </Badge>
                    )}
                  </>
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
                    disabled={boardHeld !== undefined}
                    title={
                      boardHeld === undefined
                        ? undefined
                        : "Contract board is no longer current: this offer may already be gone"
                    }
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
                    disabled={boardHeld !== undefined}
                    title={
                      boardHeld === undefined
                        ? undefined
                        : "Contract board is no longer current: this offer may already be gone"
                    }
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
  padding: "var(--inset-empty-note)",
} as const;

const SUMMARY_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
} as const;

const CARD_MIN_WIDTH = "240px";

/**
 * Single column in portrait or square; in landscape an `auto-fill` grid whose
 * column count follows the width. Contracts separate at the section gap
 * because nothing else marks where one ends.
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
  marginTop: "var(--gap-list-heading)",
} as const;

const OFFERED_ACTIONS_STYLE = {
  display: "flex",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-actions)",
} as const;

const ACTIVE_ACTIONS_STYLE = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-actions)",
} as const;

/**
 * A contract as a grouping rather than a box: the panel is already a surface,
 * so the separation is the list gap and the title's weight.
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

/* A tight row gap keeps a wrapped third reward close under the first line. */
const REWARDS_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-rewards)",
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
  margin: "var(--gap-sub-readout) 0 0",
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
    fontFamily: "var(--font-family-mono)",
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
 * Inline progress for ReachAltitudeEnvelope parameters: below the band the
 * bar fills toward the floor and the figure is the climb still needed; in the
 * band it is full; above it the figure is the overshoot.
 *
 * A held altitude dims the fill and an unreported one draws the absent form.
 * The band is judged against the modelled altitude where offered, since on
 * rails the model is the only answer.
 */
function AltitudeProgress({
  min,
  max,
  altitude,
}: {
  min: number;
  max: number;
  altitude: Reading<Value<"m">>;
}) {
  const scored =
    altitude.reckoning.status === "available"
      ? altitude.reckoning.modelled
      : altitude.value;
  if (scored === undefined) {
    return (
      <Meter
        label="Altitude"
        value={null}
        layout="row"
        style={ALT_METER_STYLE}
      />
    );
  }
  const below = scored.lessThan(min);
  const inBand = !below && scored.lessThanOrEqual(max);
  const delta = below ? value("m", min).minus(scored) : scored.minus(max);
  const deltaReading = combineReadings([altitude], () => delta);
  const sign = below ? "−" : "+";
  return (
    <Meter
      label="Altitude"
      value={altitude}
      capacity={value("m", min)}
      layout="row"
      fillColor={
        inBand ? "var(--color-status-go-fg)" : "var(--color-accent-fg)"
      }
      valueLabelNode={
        <span style={altLabelStyle(inBand)}>
          {inBand ? (
            "in band"
          ) : (
            <>
              {sign}
              <AltitudeShort m={deltaReading} />
            </>
          )}
        </span>
      }
      valueLabel={
        inBand
          ? "in band"
          : `${speakQuantity(delta)} ${below ? "below" : "above"} the band`
      }
      style={ALT_METER_STYLE}
    />
  );
}

// Decimals track magnitude: this label sits inline, where width matters more than the last digit.
function AltitudeShort({ m }: { m: Reading<Value<"m">> }) {
  const short = m.value?.abs().lessThan(10_000) ?? true;
  return <Unit value={m} decimals={short ? 1 : 0} />;
}

const ALT_METER_STYLE = { marginTop: "var(--gap-caption)" } as const;

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
