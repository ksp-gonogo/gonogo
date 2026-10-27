import { useEffect, useState } from "react";
import { useTelemetryClientOptional } from "./context";

/**
 * One contract objective a vessel has met, lost or failed while word of it is
 * still on its way to the home command, read off
 * `career.objectives.<guid>.pending`.
 *
 * Fields are bare wire values, as on every dynamic per-vessel topic: the decode
 * path cannot unit-wrap a topic keyed by guid.
 */
export interface PendingObjectiveRow {
  /** Names the change; `career.status.objectivesSettled` carries the same key once home acts on it. */
  key: string;
  /** The contract's id, as `career.status.contracts.active[].id` carries it, or null. */
  contractId: string | null;
  contractTitle: string | null;
  objective: string;
  /** The objective's place in its contract's tree, child indices joined by `/`. */
  objectivePath: string;
  /** What the objective became at the vessel. */
  target: "Met" | "Unmet" | "Failed";
  vesselId: string;
  vesselName: string | null;
  /** UT the change happened at, in the vessel's own time. */
  ut: number;
  /** UT word of the change is due at home, or null while the vessel has no route home. */
  homeArrivesUt: number | null;
}

/** The topic one vessel's pending objective changes arrive on. */
export function pendingObjectiveTopic(guid: string): string {
  return `career.objectives.${guid}.pending`;
}

const TARGETS = new Set(["Met", "Unmet", "Failed"]);

function isPendingRow(payload: unknown): payload is PendingObjectiveRow {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Partial<PendingObjectiveRow>;
  return (
    typeof row.key === "string" &&
    typeof row.objectivePath === "string" &&
    typeof row.vesselId === "string" &&
    typeof row.target === "string" &&
    TARGETS.has(row.target) &&
    typeof row.ut === "number" &&
    Number.isFinite(row.ut)
  );
}

/** The settled keys off a `career.status` payload's `objectivesSettled`, ignoring anything malformed. */
function settledKeys(settled: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(settled)) return keys;
  for (const entry of settled) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "key" in entry &&
      typeof entry.key === "string"
    ) {
      keys.add(entry.key);
    }
  }
  return keys;
}

/**
 * The pending objective changes an operator at this command centre should
 * see: every row heard from a vessel whose key home has not yet settled,
 * newest per objective.
 *
 * At the home command none: home learns of a change exactly when it applies
 * it, so a row there would be news home does not have. Pass `atHome` true
 * whenever the vantage is home or not yet known.
 *
 * @param objectivesSettled `career.status.objectivesSettled` as received, or
 * undefined before `career.status` has arrived.
 */
export function unsettledObjectiveRows(
  rows: readonly PendingObjectiveRow[],
  objectivesSettled: unknown,
  atHome: boolean,
): PendingObjectiveRow[] {
  if (atHome) return [];
  const settled = settledKeys(objectivesSettled);
  const newest = new Map<string, PendingObjectiveRow>();
  for (const row of rows) {
    if (settled.has(row.key)) continue;
    const objective = `${row.contractId ?? ""}|${row.objectivePath}`;
    const held = newest.get(objective);
    if (!held || row.ut > held.ut) newest.set(objective, row);
  }
  return [...newest.values()].sort((a, b) => a.ut - b.ut);
}

/**
 * Every pending objective row revealed so far for `guids`, de-duplicated by
 * key. Each row appears only once the delay from its vessel to this command
 * centre has passed; the mod enforces that, so nothing here waits.
 *
 * Subscribes imperatively through the client, one topic per guid, so the
 * guid list may change length between renders.
 */
export function usePendingObjectiveRows(
  guids: readonly string[],
): PendingObjectiveRow[] {
  const client = useTelemetryClientOptional();
  const [rows, setRows] = useState<PendingObjectiveRow[]>([]);
  const key = guids.join(",");

  useEffect(() => {
    if (!client) return;
    const unsubscribes = (key === "" ? [] : key.split(",")).map((guid) =>
      client.subscribe(pendingObjectiveTopic(guid), (payload) => {
        if (!isPendingRow(payload)) return;
        setRows((prev) =>
          prev.some((row) => row.key === payload.key)
            ? prev
            : [...prev, payload],
        );
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [client, key]);

  return rows;
}
