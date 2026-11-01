import type {
  HostRecordModel,
  HostRoleReply,
  HostStationCheckReply,
} from "@ksp-gonogo/sitrep-sdk";

/** One approved remote station as the page reads it off `host.record`. */
export interface ApprovedStationEntry {
  id: string;
  name: string;
  /** When it was approved, in Unix milliseconds. */
  approvedAt: number;
}

/** `host.record` as the page reads it, with every field checked. */
export interface HostRecordView {
  held: boolean;
  holderAway: boolean;
  holderId: string;
  code: string;
  stations: readonly ApprovedStationEntry[];
}

/** What `host.claim` and `host.heartbeat` answered, in plain numbers. */
export interface RoleAnswer {
  holds: boolean;
  holderId: string;
  heartbeatSeconds: number;
  graceSeconds: number;
  /** How many times the mod has granted the role, this grant included when `holds`. */
  generation: number;
}

/** What `host.station.check` answered. */
export interface StationCheckAnswer {
  approved: boolean;
  stationId: string;
  name: string;
}

export const HOST_RECORD_TOPIC = "host.record";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A figure off the wire, whether it came as a number or as a unit value. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (isRecord(value) && typeof value.toWire === "function") {
    const wire: unknown = value.toWire();
    return typeof wire === "number" ? wire : undefined;
  }
  return undefined;
}

function stationOf(value: unknown): ApprovedStationEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, approvedAt } = value;
  const at = numberOf(approvedAt);
  if (typeof id !== "string" || typeof name !== "string" || at === undefined) {
    return undefined;
  }
  return { id, name, approvedAt: at };
}

/** `host.record`'s payload, or `undefined` when it is not one. */
export function readHostRecord(payload: unknown): HostRecordView | undefined {
  if (!isRecord(payload)) return undefined;
  const record = payload as Partial<Record<keyof HostRecordModel, unknown>>;
  const { held, holderAway, holderId, code, stations } = record;
  if (
    typeof held !== "boolean" ||
    typeof holderAway !== "boolean" ||
    typeof holderId !== "string" ||
    typeof code !== "string"
  ) {
    return undefined;
  }
  const list = Array.isArray(stations)
    ? stations.flatMap((s) => {
        const entry = stationOf(s);
        return entry ? [entry] : [];
      })
    : [];
  return { held, holderAway, holderId, code, stations: list };
}

/** The payload of a command result the mod accepted, or `undefined` for a refusal. */
function payloadOf(result: unknown): unknown {
  if (!isRecord(result) || result.success !== true) return undefined;
  return result.payload;
}

/** Whether a command that answers with no payload was accepted. */
export function accepted(result: unknown): boolean {
  return isRecord(result) && result.success === true;
}

/** The answer to `host.claim` or `host.heartbeat`, or `undefined` for a refusal. */
export function readRoleAnswer(result: unknown): RoleAnswer | undefined {
  const payload = payloadOf(result);
  if (!isRecord(payload)) return undefined;
  const reply = payload as Partial<Record<keyof HostRoleReply, unknown>>;
  const heartbeatSeconds = numberOf(reply.heartbeatSeconds);
  const graceSeconds = numberOf(reply.graceSeconds);
  const generation = numberOf(reply.generation);
  if (
    typeof reply.holds !== "boolean" ||
    typeof reply.holderId !== "string" ||
    heartbeatSeconds === undefined ||
    graceSeconds === undefined ||
    generation === undefined
  ) {
    return undefined;
  }
  return {
    holds: reply.holds,
    holderId: reply.holderId,
    heartbeatSeconds,
    graceSeconds,
    generation,
  };
}

/** The answer to `host.station.check`, or `undefined` for a refusal. */
export function readStationCheck(
  result: unknown,
): StationCheckAnswer | undefined {
  const payload = payloadOf(result);
  if (!isRecord(payload)) return undefined;
  const reply = payload as Partial<
    Record<keyof HostStationCheckReply, unknown>
  >;
  const { approved, stationId, name } = reply;
  if (
    typeof approved !== "boolean" ||
    typeof stationId !== "string" ||
    typeof name !== "string"
  ) {
    return undefined;
  }
  return { approved, stationId, name };
}
