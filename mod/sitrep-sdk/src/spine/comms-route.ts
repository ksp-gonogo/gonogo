import { isUnit } from "../unit-system/guards";
import { isValue, type Value, value } from "../unit-system/value";

/**
 * The `comms.route` channel topic: each command centre's predicted
 * earliest-arrival route to and from the active craft, from the contact plan.
 * A session receives only the rows that start or end at its own vantage.
 */
export const ROUTE_TOPIC = "comms.route";

/** One stretch a routed message would spend held at a node, waiting for its next window. */
export interface RouteHold {
  /** The node holding it, as a roster id. */
  at: string;
  /** When it reaches the node, or is sent from it. */
  arriveUt: Value<"ut">;
  /** When it is predicted to leave on its next hop. */
  departUt: Value<"ut">;
}

/** One direction between a centre and the active craft, as the route predicts it. */
export interface RouteRow {
  from: string;
  to: string;
  sentUt: Value<"ut">;
  /** When it would arrive, waits included; absent when no route is predicted. */
  arrivalUt?: Value<"ut">;
  /** Whether nothing would wait anywhere. */
  live: boolean;
  /** Every hold in route order; empty for a live route. */
  holds: readonly RouteHold[];
}

/** A wire time, bare or wrapped by the decode, as a finite instant, or `null`. */
function readUt(field: unknown): Value<"ut"> | null {
  if (typeof field === "number") {
    return Number.isFinite(field) ? value("ut", field) : null;
  }
  return isValue(field) && isUnit(field, "ut") && field.isFinite()
    ? field
    : null;
}

function readHold(hold: unknown): RouteHold | null {
  if (typeof hold !== "object" || hold === null) return null;
  const at = "at" in hold ? hold.at : undefined;
  const arriveUt = readUt("arriveUt" in hold ? hold.arriveUt : undefined);
  const departUt = readUt("departUt" in hold ? hold.departUt : undefined);
  if (typeof at !== "string" || arriveUt === null || departUt === null) {
    return null;
  }
  return { at, arriveUt, departUt };
}

/**
 * Every row of a `comms.route` payload, or `null` for a payload that is not
 * one. A malformed row or hold is left out rather than guessed at.
 */
export function readRouteRows(payload: unknown): readonly RouteRow[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("routes" in payload) || !Array.isArray(payload.routes)) return null;
  const rows: RouteRow[] = [];
  for (const route of payload.routes) {
    if (typeof route !== "object" || route === null) continue;
    const from = "from" in route ? route.from : undefined;
    const to = "to" in route ? route.to : undefined;
    const sentUt = readUt("sentUt" in route ? route.sentUt : undefined);
    if (typeof from !== "string" || typeof to !== "string" || sentUt === null) {
      continue;
    }
    const arrivalUt = readUt(
      "arrivalUt" in route ? route.arrivalUt : undefined,
    );
    const holds: RouteHold[] = [];
    if ("holds" in route && Array.isArray(route.holds)) {
      for (const hold of route.holds) {
        const read = readHold(hold);
        if (read !== null) holds.push(read);
      }
    }
    rows.push({
      from,
      to,
      sentUt,
      ...(arrivalUt === null ? {} : { arrivalUt }),
      live: "live" in route && route.live === true,
      holds,
    });
  }
  return rows;
}

/**
 * Each centre's predicted downlink from the active craft, keyed by the centre
 * it reaches: the time from sending to arrival, waits included, and whether
 * nothing waits anywhere. A row with no arrival has no route and is left out.
 * `null` for a payload that is not one.
 */
export function readRouteDelays(
  payload: unknown,
): ReadonlyMap<string, { seconds: Value<"s">; live: boolean }> | null {
  const rows = readRouteRows(payload);
  if (rows === null) return null;
  const delays = new Map<string, { seconds: Value<"s">; live: boolean }>();
  for (const row of rows) {
    if (row.from === row.to || row.arrivalUt === undefined) continue;
    if (row.arrivalUt.lessThan(row.sentUt)) continue;
    delays.set(row.to, {
      seconds: row.arrivalUt.minus(row.sentUt),
      live: row.live,
    });
  }
  return delays;
}

/**
 * When a message on this route is next predicted to leave a node it is held
 * at, after `nowUt`: the countdown a waiting step counts to. Undefined for a
 * live route and for one whose holds have all departed.
 */
export function nextDepartureUt(
  row: RouteRow,
  nowUt: Value<"ut">,
): Value<"ut"> | undefined {
  return row.holds.find((hold) => hold.departUt.greaterThan(nowUt))?.departUt;
}

/** Every predicted hold at `nodeId` across the rows, in time order: what a node is expected to be holding. */
export function holdsAt(
  rows: readonly RouteRow[],
  nodeId: string,
): readonly RouteHold[] {
  return rows
    .flatMap((row) => row.holds.filter((hold) => hold.at === nodeId))
    .sort((a, b) =>
      a.arriveUt.lessThan(b.arriveUt)
        ? -1
        : b.arriveUt.lessThan(a.arriveUt)
          ? 1
          : 0,
    );
}
