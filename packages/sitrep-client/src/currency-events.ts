import { useEffect, useMemo, useRef, useState } from "react";
import { useTelemetryClientOptional } from "./context";
import { useStream } from "./use-stream";

/**
 * Source-attributed currency events, read off `currency.<guid>.<currency>`.
 *
 * A career currency total reveals instantly (`career.status.economy.*` is TrueNow
 * on purpose: the operator must see the number the game will actually gate a spend
 * against) while the vessel telemetry confirming the underlying event is delayed.
 * These events carry each delta on its SOURCE vessel's own clock instead, so a
 * distant probe's science arrives when its light could have.
 *
 * Fields are BARE numbers, not wrapped `Value<"science">`/`Value<"s">` like the
 * generated `ScienceCreditEvent` contract type: `currency.<guid>.*` is a dynamic
 * topic the decode path cannot unit-wrap (`wrapTopicPayload` keys on the exact topic
 * string and a per-guid topic matches no entry in the unit maps), so every field
 * arrives as the raw wire number. The generated type describes the WIRE contract;
 * this is the shape a client actually receives.
 */
export interface ScienceCreditEvent {
  /** The crediting vessel's guid, the same key the `fleet.` namespace uses. */
  vesselId: string;
  /** The crediting vessel's display name at the moment of the credit. */
  vesselName: string;
  /** Science points credited (bare wire number). */
  amount: number;
  /** The research subject's id, e.g. `magScan@KerbinInSpaceHigh`. */
  subjectId: string;
  /** The research subject's human title. */
  subjectTitle: string;
  /** UT the credit HAPPENED at, not when it arrived, so a consumer can age it. */
  ut: number;
}

/** The topic one vessel's science credits arrive on. */
export function scienceCreditTopic(guid: string): string {
  return `currency.${guid}.science`;
}

/**
 * The latest revealed science credit for one vessel, or undefined until one arrives.
 *
 * The value only appears once that vessel's light-time has elapsed; the reveal is
 * enforced server-side, so there is nothing here to wait on or gate client-side.
 */
export function useScienceCredit(guid: string): ScienceCreditEvent | undefined {
  return useStream<ScienceCreditEvent>(scienceCreditTopic(guid));
}

/** One revealed credit plus how long ago (in UT seconds) it actually happened. */
export interface AgedScienceCredit extends ScienceCreditEvent {
  /**
   * View UT minus the credit's own `ut`: how stale the news is. Roughly the source
   * vessel's one-way light-time at the moment it arrives, which is what lets a
   * render say "5m12s ago" rather than implying it just happened.
   */
  ageSeconds: number;
}

function isCredit(payload: unknown): payload is ScienceCreditEvent {
  if (!payload || typeof payload !== "object") return false;
  const c = payload as Partial<ScienceCreditEvent>;
  return (
    typeof c.vesselId === "string" &&
    typeof c.amount === "number" &&
    Number.isFinite(c.amount) &&
    typeof c.ut === "number" &&
    Number.isFinite(c.ut)
  );
}

/**
 * Every science credit revealed for `guids`, newest first, each aged against
 * `viewUt`, plus their sum.
 *
 * WHAT THIS DELIBERATELY DOES NOT EXPOSE: the amount of science still in flight.
 * That figure is only derivable as `career.status.economy.science` (instant, true)
 * minus a revealed total, and displaying it would tell the operator that N science
 * is inbound the instant it is earned, which is exactly the inference the delayed
 * reveal exists to prevent. So no `pending` field is offered here, by design.
 *
 * WHY THERE IS NO ABSOLUTE "delayed total" EITHER: an exact delayed total would need
 * to be seeded from a baseline read, but any baseline taken mid-session already
 * includes credits still in flight, and how much is in flight is unknowable to the
 * client by design. Seeding from it and then adding those credits as they reveal
 * double-counts them permanently. So the honest quantity is the one reported here:
 * the exact science that has been REVEALED to this observer. `career.status.economy
 * .science` remains the absolute total, instant and untouched, for spend gating.
 *
 * Subscribes imperatively through the client rather than one `useStream` per guid,
 * because a hook-per-guid would break the rules of hooks the moment the roster
 * changed length. Credits are de-duped on `(vesselId, ut)`, so the sticky last value
 * the reliable lane replays on subscribe is counted exactly once even if the guid
 * list churns.
 */
export function useRevealedScience(
  guids: readonly string[],
  viewUt: number,
): { credits: AgedScienceCredit[]; revealedTotal: number } {
  const client = useTelemetryClientOptional();
  // Distinct (vesselId, ut) keys already counted. A ref, not state: seeing the same
  // credit again (a re-subscribe replaying the sticky last value, a remount, the
  // guid list churning) must never add it to the total twice.
  const seen = useRef(new Set<string>());
  const [credits, setCredits] = useState<ScienceCreditEvent[]>([]);

  // A joined string, not the array itself, is what the effect depends on: a caller
  // rebuilding an equal roster array every render would otherwise tear down and
  // re-subscribe every topic each time. The effect re-derives the list from the key
  // rather than closing over `guids`, so its dependencies are genuinely complete and
  // it re-runs exactly when the SET of guids changes. (Vessel guids never contain a
  // comma, so the join is a faithful identity for the list.)
  const key = guids.join(",");

  useEffect(() => {
    if (!client) return;
    const unsubscribes = (key === "" ? [] : key.split(",")).map((guid) =>
      client.subscribe(scienceCreditTopic(guid), (payload) => {
        if (!isCredit(payload)) return;
        const id = `${payload.vesselId}:${payload.ut}`;
        if (seen.current.has(id)) return;
        seen.current.add(id);
        setCredits((prev) => [payload, ...prev]);
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [client, key]);

  return useMemo(
    () => ({
      credits: credits
        .map((credit) => ({ ...credit, ageSeconds: viewUt - credit.ut }))
        .sort((a, b) => b.ut - a.ut),
      revealedTotal: credits.reduce((sum, credit) => sum + credit.amount, 0),
    }),
    [credits, viewUt],
  );
}

/**
 * One revealed reputation loss, attributed to the vessel it happened aboard.
 *
 * NARRATIVE ONLY. `delta` is a change, never a total, and there is deliberately no
 * absolute reputation on this shape: the number that GATES (a strategy's minimum-rep
 * unlock, contract offer availability) is `career.status.economy.reputation`, which
 * stays instant and untouched. Never render this beside an activate/accept control.
 */
export interface ReputationLossEvent {
  /** The vessel the loss happened aboard. */
  vesselId: string;
  /** The vessel's display name at the moment of the loss. */
  vesselName: string;
  /** The reputation CHANGE, negative for a penalty (bare wire number). */
  delta: number;
  /** What caused it, e.g. `crew-loss`. */
  cause: string;
  /** The kerbals lost, all of those folded into this event's `delta`. */
  crewLost: string[];
  /** UT the loss HAPPENED at, not when it arrived. */
  ut: number;
}

/** The topic one vessel's reputation losses arrive on. */
export function reputationLossTopic(guid: string): string {
  return `currency.${guid}.reputation`;
}

function isReputationLoss(payload: unknown): payload is ReputationLossEvent {
  if (!payload || typeof payload !== "object") return false;
  const r = payload as Partial<ReputationLossEvent>;
  return (
    typeof r.vesselId === "string" &&
    typeof r.delta === "number" &&
    Number.isFinite(r.delta) &&
    typeof r.ut === "number" &&
    Number.isFinite(r.ut)
  );
}

/**
 * Every reputation loss revealed for `guids`, newest first.
 *
 * Each arrives only once its vessel's light-time has elapsed, so an operator cannot
 * infer a distant crew loss from the instant career total ticking down.
 *
 * Callers should pass a STICKY guid list, not a live roster: a destroyed vessel leaves
 * the roster while its own event is still crossing its light-time, and a subscription
 * keyed on the live roster alone would be gone by the time the event matured. The
 * ledger holds the event either way; only the subscription can go missing.
 */
export function useReputationLossEvents(
  guids: readonly string[],
): ReputationLossEvent[] {
  const client = useTelemetryClientOptional();
  const seen = useRef(new Set<string>());
  const [losses, setLosses] = useState<ReputationLossEvent[]>([]);
  const key = guids.join(",");

  useEffect(() => {
    if (!client) return;
    const unsubscribes = (key === "" ? [] : key.split(",")).map((guid) =>
      client.subscribe(reputationLossTopic(guid), (payload) => {
        if (!isReputationLoss(payload)) return;
        const id = `${payload.vesselId}:${payload.ut}`;
        if (seen.current.has(id)) return;
        seen.current.add(id);
        setLosses((prev) => [payload, ...prev]);
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [client, key]);

  return useMemo(() => [...losses].sort((a, b) => b.ut - a.ut), [losses]);
}

/**
 * The vessel guids to keep a source-attributed event subscription open for: every guid
 * currently in `roster`, plus every guid seen earlier in this session.
 *
 * A vessel that is destroyed leaves the roster immediately, but its own reputation-loss
 * event is still crossing its light-time and will not be revealed for minutes. A
 * subscription set built from the live roster alone would therefore have dropped that
 * guid before the event matured, and the news of the loss would never arrive. Retaining
 * every guid ever seen is bounded by the vessels one save has actually flown, which is
 * small, and costs one idle subscription each.
 */
export function useStickyVesselGuids(
  roster: readonly string[] | undefined,
): string[] {
  const known = useRef<string[]>([]);
  const [guids, setGuids] = useState<string[]>([]);

  const key = (roster ?? []).join(",");
  useEffect(() => {
    const incoming = key === "" ? [] : key.split(",");
    const added = incoming.filter((guid) => !known.current.includes(guid));
    if (added.length === 0) return;
    known.current = [...known.current, ...added];
    setGuids(known.current);
  }, [key]);

  return guids;
}
