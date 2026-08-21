import { FlightEndReason, value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";
/**
 * Mission-event model + pure derivation logic for the Mission Event Log widget.
 *
 * Two families of source (see the STEP-1 event list, 2026-08-03):
 *   • Tier A: DISCRETE topics that carry their own `ut` (`flight.started/ended/
 *     vesselChanged`, `crash.lastCrash`, `recovery.lastSummary`). Shaped 1:1 by
 *     the `from*` functions.
 *   • Tier B: value topics with NO discrete edge on the wire; we detect the edge
 *     client-side by comparing the previous vs current value and stamp the event
 *     with the current view UT (`detect*` functions).
 *
 * Source-agnostic: a staging event is the same MissionEvent however the stage
 * was triggered (manual, an autopilot, or an app command); we only observe the
 * resulting telemetry edge, never how it was triggered.
 *
 * ⚠️ Tier-B edge detection is a v1 pragmatic substitute for a discrete mod-side
 * `*.event` topic (a Tier-C carry-gap). It can MISS an edge that happened
 * entirely between two delivered samples (e.g. two stages inside one time-warp
 * step) and can RE-FIRE on a stream reconnect if the accumulator's `prev` is
 * reset. A future mod pass emitting discrete per-category event topics removes
 * both risks; until then this is the honest v1 behaviour.
 */

export type MissionEventKind =
  | "launch"
  | "flight-ended"
  | "vessel-changed"
  | "crash"
  | "recovery"
  | "alarm"
  | "staging"
  | "soi-change"
  | "docking"
  | "undocking"
  | "eva"
  | "contract-completed"
  | "science-collected"
  | "reputation-loss";

export interface MissionEvent {
  /** Universal Time (game time) the event happened at. */
  ut: number;
  kind: MissionEventKind;
  /** Short human label, e.g. "Launched Mun Tester". */
  label: string;
  /** Optional secondary detail. */
  detail?: string;
  /**
   * Stable de-dup key. Two derivations of the same underlying occurrence
   * produce the same id so the accumulator never lists it twice; a
   * discriminator (e.g. a completed-contract id) keeps distinct same-UT events
   * apart.
   */
  id: string;
}

/**
 * A finite number from a wire field, whether it arrives bare or as a quantity.
 *
 * Every `ut` on these payloads is declared in seconds, so it reaches a
 * consumer as a `Value<"s">`. A plain `typeof v === "number"` guard is false
 * for all of them, and since each detector returns `null` on a failed guard,
 * that guard silently emptied the whole log: no launch, no crash, no
 * recovery, on a live vessel, with the widget showing its "no events yet"
 * placeholder as if nothing had happened.
 */
const num = (v: unknown): number | null => {
  const n = magnitudeOf(v as Quantityish);
  return n !== null && Number.isFinite(n) ? n : null;
};

const isNum = (v: unknown): v is number => num(v) !== null;

function makeId(kind: MissionEventKind, ut: number, disc?: string): string {
  return disc ? `${kind}:${ut}:${disc}` : `${kind}:${ut}`;
}

// --- Tier A: discrete-topic shapers -----------------------------------------

interface DiscretePayload {
  ut?: unknown;
  vesselName?: unknown;
  [k: string]: unknown;
}

/** Narrow a raw stream payload (typed as its topic shape, or undefined) to a
 *  loose bag we parse defensively; returns undefined for anything non-object. */
function asObj(raw: unknown): DiscretePayload | undefined {
  return raw && typeof raw === "object" ? (raw as DiscretePayload) : undefined;
}

const nameOf = (p: DiscretePayload): string =>
  typeof p.vesselName === "string" && p.vesselName.trim().length > 0
    ? p.vesselName
    : "vessel";

export function fromFlightStarted(raw: unknown): MissionEvent | null {
  const p = asObj(raw);
  const ut = num(p?.ut);
  if (!p || ut === null) return null;
  return {
    ut,
    kind: "launch",
    label: `Launched ${nameOf(p)}`,
    id: makeId("launch", ut),
  };
}

/**
 * Why the flight ended, off the `FlightEndReason` ORDINAL `flight.ended`
 * actually carries (`JsonWriter.AppendFlightEnded` writes
 * `AppendInteger(sb, (long)f.Reason)`).
 *
 * This used to be `typeof p.reason === "string" ? p.reason : undefined`, and no
 * ordinal is ever a string, so the detail was permanently absent: the log read
 * "Flight ended" for a recovery and for a crash alike, and had done since the
 * channel landed.
 *
 * An ordinal the generated enum cannot name is a mod newer than this build.
 * Nothing is the honest answer there: inventing a cause would put a reason on
 * the log that no build reported.
 */
function flightEndReasonName(reason: unknown): string | undefined {
  if (typeof reason !== "number" || !Number.isInteger(reason)) return undefined;
  const name = (FlightEndReason as Record<number, string | undefined>)[reason];
  return typeof name === "string" ? name : undefined;
}

export function fromFlightEnded(raw: unknown): MissionEvent | null {
  const p = asObj(raw);
  const ut = num(p?.ut);
  if (!p || ut === null) return null;
  return {
    ut,
    kind: "flight-ended",
    label: "Flight ended",
    detail: flightEndReasonName(p.reason),
    id: makeId("flight-ended", ut),
  };
}

export function fromVesselChanged(raw: unknown): MissionEvent | null {
  const p = asObj(raw);
  const ut = num(p?.ut);
  if (!p || ut === null) return null;
  return {
    ut,
    kind: "vessel-changed",
    label: `Switched to ${nameOf(p)}`,
    id: makeId("vessel-changed", ut),
  };
}

export function fromCrash(raw: unknown): MissionEvent | null {
  const p = asObj(raw);
  const ut = num(p?.ut);
  if (!p || ut === null) return null;
  const cause = typeof p.cause === "string" ? p.cause : undefined;
  return {
    ut,
    kind: "crash",
    label: `${nameOf(p)} crashed`,
    detail: cause,
    id: makeId("crash", ut),
  };
}

export function fromRecovery(raw: unknown): MissionEvent | null {
  const p = asObj(raw);
  const ut = num(p?.ut);
  if (!p || ut === null) return null;
  // `writeQuantity`, not a typed "f": `detail` is a string on the event model
  // and a string cannot hold `<Unit>`, but the symbol can still come from the
  // unit registry rather than from the keyboard.
  const recovered = num(p.fundsRecovered);
  const funds =
    recovered === null
      ? undefined
      : `+${writeQuantity(value("funds", Math.round(recovered)))}`;
  return {
    ut,
    kind: "recovery",
    label: `Recovered ${nameOf(p)}`,
    detail: funds,
    id: makeId("recovery", ut),
  };
}

/**
 * A source-attributed reputation loss (`currency.<guid>.reputation`).
 *
 * Tier A, and the first source here that is genuinely DELAYED per vessel: it is revealed
 * only after the losing vessel's own light-time, so the log entry is news of something
 * that happened a while ago. `ageSeconds` (view UT minus the event's own UT) is carried
 * into the detail for exactly that reason, so the row reads as a report rather than as
 * something happening now.
 *
 * NARRATIVE ONLY. This never contributes to any affordability or eligibility check: the
 * reputation that GATES a strategy activate or a contract accept is
 * `career.status.economy.reputation`, which stays instant and untouched.
 */
export function fromReputationLoss(
  raw: unknown,
  viewUt: number,
): MissionEvent | null {
  const p = asObj(raw);
  const ut = num(p?.ut);
  const delta = num(p?.delta);
  if (!p || ut === null || delta === null || delta === 0) return null;

  const vessel =
    typeof p.vesselName === "string" && p.vesselName.trim().length > 0
      ? p.vesselName
      : "vessel";
  const crew = Array.isArray(p.crewLost)
    ? p.crewLost.filter((n): n is string => typeof n === "string")
    : [];
  const cause = typeof p.cause === "string" && p.cause ? p.cause : "loss";
  const age = Math.max(0, viewUt - ut);
  const rounded = Math.round(delta * 10) / 10;

  return {
    ut,
    kind: "reputation-loss",
    // A sign is always shown: a penalty reads "-6", and a positive delta from a
    // non-stock penalty class would read "+6" rather than silently losing its sign.
    label: `Reputation ${rounded > 0 ? "+" : ""}${rounded}`,
    detail: [
      cause === "crew-loss" ? "crew loss" : cause,
      vessel,
      crew.length > 0 ? crew.join(", ") : null,
      // `writeQuantity`, not a hand-typed "5m12s": `detail` is a string on the event
      // model and a string cannot hold `<Unit>`, but the ladder and the symbol still
      // come from the unit registry rather than from the keyboard. Same reasoning as
      // `fromRecovery`'s funds figure above.
      `${writeQuantity(value("s", age))} ago`,
    ]
      .filter(Boolean)
      .join(", "),
    // Keyed on the vessel, not just the UT: two vessels lost in the same instant are
    // two distinct events.
    id: makeId(
      "reputation-loss",
      ut,
      typeof p.vesselId === "string" ? p.vesselId : vessel,
    ),
  };
}

// --- Tier B: value-edge detectors (caller supplies the current view `ut`) -----

/** Staging edge: the stage COUNT decreasing (a stage separated). */
export function detectStaging(
  prev: number | undefined,
  curr: number | undefined,
  ut: number,
): MissionEvent | null {
  if (!isNum(prev) || !isNum(curr)) return null;
  if (curr >= prev) return null;
  return {
    ut,
    kind: "staging",
    label: `Staged (stage ${curr})`,
    id: makeId("staging", ut, String(curr)),
  };
}

/** SOI change: the reference-body index changed. */
export function detectSoiChange(
  prev: number | undefined,
  curr: number | undefined,
  ut: number,
): MissionEvent | null {
  if (!isNum(prev) || !isNum(curr) || prev === curr) return null;
  return {
    ut,
    kind: "soi-change",
    label: "Entered new sphere of influence",
    id: makeId("soi-change", ut, String(curr)),
  };
}

/** Docking (false→true) / undocking (true→false). */
export function detectDocking(
  prev: boolean | undefined,
  curr: boolean | undefined,
  ut: number,
): MissionEvent | null {
  if (typeof prev !== "boolean" || typeof curr !== "boolean" || prev === curr) {
    return null;
  }
  const kind: MissionEventKind = curr ? "docking" : "undocking";
  return {
    ut,
    kind,
    label: curr ? "Docked" : "Undocked",
    id: makeId(kind, ut),
  };
}

const VESSEL_TYPE_EVA = 7;

/** EVA start: vesselType transitions INTO the EVA type. */
export function detectEva(
  prev: number | undefined,
  curr: number | undefined,
  ut: number,
): MissionEvent | null {
  if (!isNum(curr) || curr !== VESSEL_TYPE_EVA) return null;
  if (prev === VESSEL_TYPE_EVA) return null;
  return { ut, kind: "eva", label: "Kerbal on EVA", id: makeId("eva", ut) };
}

interface ContractLike {
  id?: unknown;
  title?: unknown;
}

/** One event per contract id present in `curr.completedRecent` but not `prev`. */
export function detectContractsCompleted(
  prev: readonly ContractLike[] | undefined,
  curr: readonly ContractLike[] | undefined,
  ut: number,
): MissionEvent[] {
  if (!Array.isArray(prev) || !Array.isArray(curr)) return [];
  const prevIds = new Set(
    prev
      .map((c) => (typeof c.id === "string" ? c.id : undefined))
      .filter(Boolean),
  );
  const out: MissionEvent[] = [];
  for (const c of curr) {
    const cid = typeof c.id === "string" ? c.id : undefined;
    if (!cid || prevIds.has(cid)) continue;
    const title = typeof c.title === "string" ? c.title : cid;
    out.push({
      ut,
      kind: "contract-completed",
      label: `Contract complete: ${title}`,
      id: makeId("contract-completed", ut, cid),
    });
  }
  return out;
}

/** Science collected: the experiment-breakdown total grew. */
export function detectScienceCollected(
  prev: number | undefined,
  curr: number | undefined,
  ut: number,
): MissionEvent | null {
  if (!isNum(prev) || !isNum(curr) || curr <= prev) return null;
  const gained = Math.round((curr - prev) * 10) / 10;
  return {
    ut,
    kind: "science-collected",
    label: `Science collected (+${gained})`,
    id: makeId("science-collected", ut, String(curr)),
  };
}
