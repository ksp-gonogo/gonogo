import { KspParameterState, value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { asQuantityish, magnitudeOf, magnitudeOr } from "../shared/magnitude";

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
    const id = contractIdOf(e.id);
    if (id === null) continue;
    const agency = agencyOf(e);
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

/** A numeric id is stringified so downstream has one type. */
function contractIdOf(raw: unknown): string | null {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

function agencyOf(e: Record<string, unknown>): string {
  if (typeof e.agency === "string") return e.agency;
  if (typeof e.agent === "string") return e.agent;
  return "";
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
