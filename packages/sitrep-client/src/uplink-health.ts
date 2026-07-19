import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/**
 * The `system.uplinks` derived reader — the client-side half of Uplink
 * health self-reporting (`local_docs/telemetry-mod/uplink-health-design.md`).
 * Each Uplink reports its OWN health via the mod-side
 * `Sitrep.Contract.IUplinkHealthReporter` contract; the client never infers
 * readiness from topic staleness — it only reads what the mod already
 * decided. `ChannelEngine`'s built-in `system.uplinks` channel (declared
 * directly by the engine, not any one Uplink's manifest — it is the only
 * component that sees every registered Uplink at once) aggregates that
 * report for every registered Uplink, self-reporting or not.
 *
 * Named distinctly from the raw wire topic (`system.uplinks` stays the raw
 * carried topic — see `default-carried-topics.ts`; this derived channel
 * registers as `system.uplinkHealth`) for the same reason
 * `system.bodies` -> `system.state` are two different topic names: a derived
 * channel registered under the SAME name as its own input would recurse
 * into itself the first time `derive` calls `get()` on that input.
 */

/** One `system.uplinks` wire entry's `health` field, before decode. */
interface RawUplinkHealth {
  /** `Sitrep.Contract.UplinkHealthState`'s integer ordinal — see `HEALTH_STATE_NAMES`. */
  state: number;
  detail: string | null;
}

/** One `system.uplinks` wire entry, before decode. */
interface RawUplinkEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  health: RawUplinkHealth;
  /**
   * Every topic/prefix this uplink owns — `ChannelEngine.ComputeOwnedPrefixes`'s
   * output. Optional on the wire type so a pre-Phase-1 mod build (field
   * absent) decodes safely instead of throwing.
   */
  ownedPrefixes?: string[];
}

/** The raw `system.uplinks` wire payload (`ChannelEngine.BuildSystemUplinksPayload`'s shape). */
interface RawSystemUplinksPayload {
  uplinks: RawUplinkEntry[];
}

/**
 * `Sitrep.Contract.UplinkHealthState`'s enum declaration order (Healthy 0 /
 * Degraded 1 / Unavailable 2) — index-matched so the wire ordinal resolves
 * via a plain array lookup, same convention `useGameContext`'s
 * `GameMode`/`career.mode.mode` decode already uses (see that hook's doc
 * comment for why: the mod serializes every enum as its integer ordinal, not
 * its name — `CareerViewProvider.ToWire(CareerMode)` is the canonical
 * example).
 */
const HEALTH_STATE_NAMES = ["healthy", "degraded", "unavailable"] as const;

/** Decoded, widget-facing form of `UplinkHealthState`. */
export type UplinkHealthStateName = (typeof HEALTH_STATE_NAMES)[number];

/** Decoded, widget-facing form of one Uplink's health self-report. */
export interface UplinkHealthEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  /**
   * Every topic/prefix this uplink owns, mod-side source of truth
   * (`ChannelEngine._channelOwner` / `_dynamicNamespaceOwner`) — the client
   * NEVER re-derives a TOPIC_OWNER map. `useUplinkHealthFor` resolves a
   * widget's declared channels against this via longest-prefix match.
   * Empty array (never absent) for a pre-Phase-1 mod build.
   */
  ownedPrefixes: string[];
  health: {
    state: UplinkHealthStateName;
    /** Uplink-authored "what ready means for me" text — opaque, display-only. */
    detail: string | null;
  };
}

/** The `system.uplinkHealth` derived-channel payload. */
export interface SystemUplinkHealth {
  uplinks: UplinkHealthEntry[];
}

/**
 * `system.uplinkHealth` derivation. `undefined` while `system.uplinks`
 * hasn't arrived yet ("still resyncing"); `null` when it's a confirmed
 * tombstone; otherwise the decoded per-Uplink array. Never throws — an
 * out-of-range `health.state` ordinal (a future `UplinkHealthState` member
 * this client doesn't know about yet) falls back to `"unavailable"` rather
 * than producing `undefined` for the whole array.
 */
export function deriveSystemUplinkHealth(
  get: DerivedGet,
): SystemUplinkHealth | null | undefined {
  const point = get<RawSystemUplinksPayload>("system.uplinks");
  if (!point) return undefined;
  if (point.payload === null) return null;

  return {
    uplinks: point.payload.uplinks.map((entry) => ({
      id: entry.id,
      version: entry.version,
      available: entry.available,
      reason: entry.reason ?? null,
      ownedPrefixes: entry.ownedPrefixes ?? [],
      health: {
        state: HEALTH_STATE_NAMES[entry.health.state] ?? "unavailable",
        detail: entry.health.detail ?? null,
      },
    })),
  };
}

/**
 * Ready-to-register definition — `store.registerDerivedChannel(systemUplinkHealthChannel)`.
 * `fields: true` exposes `system.uplinkHealth.uplinks`. `deriveStatus` is
 * omitted: the default (worst status across declared inputs — here just
 * `system.uplinks`) is exactly right for a single-input passthrough.
 */
export const systemUplinkHealthChannel: DerivedChannelDefinition<SystemUplinkHealth> =
  {
    topic: "system.uplinkHealth",
    inputs: ["system.uplinks"],
    derive: deriveSystemUplinkHealth,
    fields: true,
  };
