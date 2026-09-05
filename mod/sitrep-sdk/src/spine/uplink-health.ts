import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/**
 * The `system.uplinks` derived reader: the client-side half of Uplink
 * health self-reporting.
 * Each Uplink reports its OWN health via the mod-side
 * `Sitrep.Contract.IUplinkHealthReporter` contract; the client never infers
 * readiness from topic staleness: it only reads what the mod already
 * decided. `ChannelEngine`'s built-in `system.uplinks` channel (declared
 * directly by the engine, not any one Uplink's manifest, it is the only
 * component that sees every registered Uplink at once) aggregates that
 * report for every registered Uplink, self-reporting or not.
 *
 * Named distinctly from the raw wire topic (`system.uplinks` stays the raw
 * carried topic: see `default-carried-topics.ts`; this derived channel
 * registers as `system.uplinkHealth`) for the same reason
 * `system.bodies` -> `system.state` are two different topic names: a derived
 * channel registered under the SAME name as its own input would recurse
 * into itself the first time `derive` calls `get()` on that input.
 */

/** One `Sitrep.Contract.UplinkHealthFact`, before decode. */
interface RawUplinkHealthFact {
  label: string;
  value: string | null;
}

/** One `system.uplinks` wire entry's `health` field, before decode. */
interface RawUplinkHealth {
  /** `Sitrep.Contract.UplinkHealthState`'s integer ordinal: see `HEALTH_STATE_NAMES`. */
  state: number;
  detail: string | null;
  /**
   * `Sitrep.Contract.UplinkHealth.Facts`. Optional on the wire type so a mod
   * build predating uplink-authored facts (field absent) decodes to an empty
   * list rather than throwing.
   */
  facts?: RawUplinkHealthFact[];
}

/** One `system.uplinks` wire entry, before decode. */
interface RawUplinkEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  health: RawUplinkHealth;
  /**
   * Every topic/prefix this uplink owns: `ChannelEngine.ComputeOwnedPrefixes`'s
   * output. Optional on the wire type so a pre-Phase-1 mod build (field
   * absent) decodes safely instead of throwing.
   */
  ownedPrefixes?: string[];
  /**
   * The contract version this Uplink declared it was built against, off its
   * `[SitrepUplink]` attribute. Absent for an uplink registered outside
   * discovery, and for a mod build predating the fields.
   */
  contractMajor?: number | null;
  contractMinor?: number | null;
}

/** The raw `system.uplinks` wire payload (`ChannelEngine.BuildSystemUplinksPayload`'s shape). */
interface RawSystemUplinksPayload {
  uplinks: RawUplinkEntry[];
  /** The contract version the running mod speaks. Absent on a mod build predating the field. */
  coreContractMajor?: number | null;
  coreContractMinor?: number | null;
}

/**
 * `Sitrep.Contract.UplinkHealthState` in declaration order (Healthy 0 /
 * Degraded 1 / Unavailable 2), lowercased. The mod serializes every enum as
 * its integer ordinal rather than its name, so the wire value resolves here by
 * a plain array index.
 *
 * The one ordinal→name table in this package still written out by hand: its
 * literal tuple type is what gives {@link UplinkHealthStateName} a closed
 * union for callers to key a `Record` on, which deriving it would lose. That
 * also makes it the one table a C# member can be appended to without,
 * so `enum-name-tables.test.ts` reads the declaration out of the contract
 * source and fails when the two drift.
 */
export const HEALTH_STATE_NAMES = [
  "healthy",
  "degraded",
  "unavailable",
] as const;

/** Decoded, widget-facing form of `UplinkHealthState`. */
export type UplinkHealthStateName = (typeof HEALTH_STATE_NAMES)[number];

/**
 * One labelled diagnostic an Uplink reports about whatever it depends on: which
 * file, which build, which hash. Both halves are display text the Uplink itself
 * authored, so a client lists them without knowing what the Uplink is or what
 * the fact means.
 */
export interface UplinkHealthFact {
  label: string;
  value: string | null;
}

/** A `Sitrep.Contract.ContractVersion` pair, as a Major/Minor the two sides can be compared on. */
export interface ContractVersionReading {
  major: number;
  minor: number;
}

/** Decoded, widget-facing form of one Uplink's health self-report. */
export interface UplinkHealthEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  /**
   * The contract version this Uplink was built against, which the mod reads off
   * its `[SitrepUplink]` attribute rather than out of its payloads: an Uplink
   * REFUSED for a major mismatch still says which version it expected, because
   * the attribute is the one thing about it a differing core can safely read.
   * Compare it against {@link SystemUplinkHealth.coreContract} to tell a refusal
   * from any other kind of unavailability. `null` for an Uplink that declared
   * nothing, and for a mod build predating the field.
   */
  contract: ContractVersionReading | null;
  /**
   * Every topic/prefix this uplink owns, mod-side source of truth
   * (`ChannelEngine._channelOwner` / `_dynamicNamespaceOwner`): the client
   * NEVER re-derives a TOPIC_OWNER map. A widget's declared channels resolve to
   * their owner by longest-prefix match against this.
   * Empty array (never absent) for a pre-Phase-1 mod build.
   */
  ownedPrefixes: string[];
  health: {
    state: UplinkHealthStateName;
    /** Uplink-authored "what ready means for me" text, opaque, display-only. */
    detail: string | null;
    /**
     * Uplink-authored diagnostics, in the order the Uplink wants them read.
     * Empty (never absent) when the Uplink has nothing to add.
     */
    facts: UplinkHealthFact[];
  };
}

/** The `system.uplinkHealth` derived-channel payload. */
export interface SystemUplinkHealth {
  uplinks: UplinkHealthEntry[];
  /**
   * The contract version the running mod speaks: the other half of every
   * contract refusal on the roster, stated once because it is a fact about the
   * core rather than about any one Uplink. `null` on a mod build predating it.
   */
  coreContract: ContractVersionReading | null;
}

/**
 * A Major/Minor pair from two nullable wire ints. Both have to be present to
 * mean anything: half a version number is not a version.
 */
function readContractVersion(
  major: number | null | undefined,
  minor: number | null | undefined,
): ContractVersionReading | null {
  return typeof major === "number" && typeof minor === "number"
    ? { major, minor }
    : null;
}

/**
 * `system.uplinkHealth` derivation. `undefined` while `system.uplinks`
 * hasn't arrived yet ("still resyncing"); `null` when it's a confirmed
 * tombstone; otherwise the decoded per-Uplink array. Never throws, an
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
    coreContract: readContractVersion(
      point.payload.coreContractMajor,
      point.payload.coreContractMinor,
    ),
    uplinks: point.payload.uplinks.map((entry) => ({
      id: entry.id,
      version: entry.version,
      available: entry.available,
      reason: entry.reason ?? null,
      contract: readContractVersion(entry.contractMajor, entry.contractMinor),
      ownedPrefixes: entry.ownedPrefixes ?? [],
      health: {
        state: HEALTH_STATE_NAMES[entry.health.state] ?? "unavailable",
        detail: entry.health.detail ?? null,
        facts: (entry.health.facts ?? []).map((fact) => ({
          label: fact.label,
          value: fact.value ?? null,
        })),
      },
    })),
  };
}

/**
 * Ready-to-register definition: `store.registerDerivedChannel(systemUplinkHealthChannel)`.
 * `fields: true` exposes `system.uplinkHealth.uplinks`. `deriveStatus` is
 * omitted: the default (worst status across declared inputs, here just
 * `system.uplinks`) is exactly right for a single-input passthrough.
 */
export const systemUplinkHealthChannel: DerivedChannelDefinition<SystemUplinkHealth> =
  {
    topic: "system.uplinkHealth",
    inputs: ["system.uplinks"],
    derive: deriveSystemUplinkHealth,
    fields: true,
  };
