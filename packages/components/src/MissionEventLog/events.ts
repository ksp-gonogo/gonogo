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
 * Source-agnostic: a staging event is the same MissionEvent whether the stage
 * was fired manually, by kOS, or by the app, we only observe the resulting
 * telemetry edge, never how it was triggered.
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
  | "science-collected";

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

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function makeId(kind: MissionEventKind, ut: number, disc?: string): string {
  return disc ? `${kind}:${ut}:${disc}` : `${kind}:${ut}`;
}

// --- Tier A: discrete-topic shapers -----------------------------------------

interface DiscretePayload {
  ut?: unknown;
  vesselName?: unknown;
  [k: string]: unknown;
}

const nameOf = (p: DiscretePayload): string =>
  typeof p.vesselName === "string" && p.vesselName.trim().length > 0
    ? p.vesselName
    : "vessel";

export function fromFlightStarted(
  p: DiscretePayload | undefined,
): MissionEvent | null {
  if (!p || !isNum(p.ut)) return null;
  return {
    ut: p.ut,
    kind: "launch",
    label: `Launched ${nameOf(p)}`,
    id: makeId("launch", p.ut),
  };
}

export function fromFlightEnded(
  p: DiscretePayload | undefined,
): MissionEvent | null {
  if (!p || !isNum(p.ut)) return null;
  const reason = typeof p.reason === "string" ? p.reason : undefined;
  return {
    ut: p.ut,
    kind: "flight-ended",
    label: "Flight ended",
    detail: reason,
    id: makeId("flight-ended", p.ut),
  };
}

export function fromVesselChanged(
  p: DiscretePayload | undefined,
): MissionEvent | null {
  if (!p || !isNum(p.ut)) return null;
  return {
    ut: p.ut,
    kind: "vessel-changed",
    label: `Switched to ${nameOf(p)}`,
    id: makeId("vessel-changed", p.ut),
  };
}

export function fromCrash(p: DiscretePayload | undefined): MissionEvent | null {
  if (!p || !isNum(p.ut)) return null;
  const cause = typeof p.cause === "string" ? p.cause : undefined;
  return {
    ut: p.ut,
    kind: "crash",
    label: `${nameOf(p)} crashed`,
    detail: cause,
    id: makeId("crash", p.ut),
  };
}

export function fromRecovery(
  p: DiscretePayload | undefined,
): MissionEvent | null {
  if (!p || !isNum(p.ut)) return null;
  const funds = isNum(p.fundsRecovered)
    ? `+${Math.round(p.fundsRecovered).toLocaleString()}f`
    : undefined;
  return {
    ut: p.ut,
    kind: "recovery",
    label: `Recovered ${nameOf(p)}`,
    detail: funds,
    id: makeId("recovery", p.ut),
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
