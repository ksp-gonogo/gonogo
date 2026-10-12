import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/**
 * The `system.uplinks` derived reader: the client-side half of Uplink
 * health self-reporting.
 * Each Uplink reports its own health via the mod-side
 * `Sitrep.Contract.ISitrepUplink.Health()`; the client never infers
 * readiness from topic staleness: it only reads what the mod already
 * decided. `ChannelEngine`'s built-in `system.uplinks` channel (declared
 * directly by the engine, not any one Uplink's manifest, it is the only
 * component that sees every registered Uplink at once) aggregates that
 * report for every registered Uplink, self-reporting or not.
 *
 * Named distinctly from the raw wire topic (`system.uplinks` stays the raw
 * wire topic; this derived channel
 * registers as `system.uplinkHealth`) for the same reason
 * `system.bodies` -> `system.state` are two different topic names: a derived
 * channel registered under the same name as its own input would recurse
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
  /** The manifest's display name. Absent when the Uplink set none. */
  name?: string | null;
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
  /** Whether `settings.<id>` carries this Uplink's host mod settings. */
  modSettings?: boolean;
}

/** The raw `system.uplinks` wire payload (`ChannelEngine.BuildSystemUplinksPayload`'s shape). */
interface RawSystemUplinksPayload {
  uplinks: RawUplinkEntry[];
  /** The contract version the running mod speaks. Absent on a mod build predating the field. */
  coreContractMajor?: number | null;
  coreContractMinor?: number | null;
}

/**
 * The names of an Uplink's health states, in the order of the mod's
 * `Sitrep.Contract.UplinkHealthState` (`healthy`, `degraded`, `unavailable`).
 * Useful for turning the number on the wire into a name the operator can read.
 * Used by the app's Uplink roster probe. The mod serializes every enum as its
 * integer ordinal rather than its name, so the wire value resolves here by a plain
 * array index.
 *
 * Its literal tuple type gives {@link UplinkHealthStateName} a closed union, which
 * you can key a `Record` on.
 *
 * @category Host and runtime
 */
export const HEALTH_STATE_NAMES = [
  "healthy",
  "degraded",
  "unavailable",
] as const;

/**
 * An Uplink's health, as a widget reads it: `"healthy"`, `"degraded"` (running
 * with a problem its `detail` names) or `"unavailable"` (not running, with a
 * reason). Useful for showing the operator whether an Uplink is working. Used by
 * the Uplink status in the settings panel.
 *
 * @category Host and runtime
 */
export type UplinkHealthStateName = (typeof HEALTH_STATE_NAMES)[number];

/**
 * One labelled detail an Uplink reports about what it depends on: a file, a
 * build, a hash. Useful for showing the operator what an Uplink is running
 * against. Listed on an {@link UplinkHealthEntry}. The Uplink writes both the
 * label and the value, so a client lists them as they are.
 *
 * @category Host and runtime
 */
export interface UplinkHealthFact {
  /** What the detail is, in the Uplink's own words, such as "Mod build". */
  label: string;
  /** The detail itself, or `null` when the Uplink could not read it. */
  value: string | null;
}

/**
 * A contract version, as a major and a minor that can be compared. Useful for
 * telling the operator when an Uplink and the app disagree about the wire
 * contract. Used by the first-run Uplink readiness check.
 *
 * @category Host and runtime
 */
export interface ContractVersionReading {
  /** Moves when the wire contract changes in a way an older client cannot read. */
  major: number;
  /** Moves when the wire contract gains something an older client simply does not use. */
  minor: number;
}

/**
 * One Uplink's report on its own health, as a widget reads it. Useful for
 * showing the operator whether an Uplink is working and why not. Used by the
 * Uplink status and Uplinks settings in the settings panel and by the first-run
 * Uplink readiness check.
 *
 * @category Host and runtime
 */
export interface UplinkHealthEntry {
  /** The Uplink's id. */
  id: string;
  /** The name the Uplink gives itself, or `null` when it gave none; `id` is then the name to show. */
  name: string | null;
  /** The Uplink's version. */
  version: string;
  /** Whether the Uplink is usable. */
  available: boolean;
  /** Why the Uplink is unavailable. `null` while it is available. */
  reason: string | null;
  /**
   * The contract version the Uplink was built against. An Uplink refused for a
   * different major still reports it, so compare it with
   * {@link SystemUplinkHealth.coreContract} to tell a version refusal from any
   * other reason it is unavailable. `null` when the Uplink declared none, or
   * the mod is too old to report it.
   */
  contract: ContractVersionReading | null;
  /**
   * The Topics, and prefixes of Topics, the Uplink serves. A Topic belongs to
   * the Uplink with the longest prefix that matches it. Empty, never absent,
   * when the mod is too old to report it.
   */
  ownedPrefixes: string[];
  /**
   * Whether the Uplink reports its host mod's own settings on `settings.<id>`,
   * read with {@link useModSettings}. `false` when the mod is too old to
   * report it.
   */
  modSettings: boolean;
  /** How the Uplink says it is doing. */
  health: {
    /** Its state, as a name. The `system.uplinks` Topic carries it as a number, which is decoded here. */
    state: UplinkHealthStateName;
    /** What the Uplink says about its state, to show as it is. */
    detail: string | null;
    /**
     * Details the Uplink reports, in the order it wants them read. Empty, never
     * absent, when it has none.
     */
    facts: UplinkHealthFact[];
  };
}

/**
 * Every Uplink's health: the value of `system.uplinkHealth`. Useful for listing
 * which Uplinks are working. Used by the Uplinks settings in the settings panel.
 * It is a derived channel, one of {@link DERIVED_CHANNEL_IDS}, which the app works
 * out from the `system.uplinks` Topic, so it is not in the list of Topics. Read it
 * with `useStream("system.uplinkHealth")`.
 *
 * @category Host and runtime
 */
export interface SystemUplinkHealth {
  /** Every Uplink the mod knows of. */
  uplinks: UplinkHealthEntry[];
  /**
   * The contract version the running mod speaks, to compare with each
   * Uplink's `contract`. `null` when the mod is too old to report it.
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
 * Derives `system.uplinkHealth` from `system.uplinks`. Useful for turning the
 * mod's health report into a list a widget can read. Used by
 * {@link systemUplinkHealthChannel}. The result is `undefined` while
 * `system.uplinks` has not arrived (still resyncing), `null` when it is a
 * confirmed tombstone, and otherwise the decoded per-Uplink array. Never throws:
 * an out-of-range `health.state` ordinal (a health state added by a newer mod)
 * becomes `"unavailable"` rather than making the whole array `undefined`.
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
      name: entry.name ?? null,
      version: entry.version,
      available: entry.available,
      reason: entry.reason ?? null,
      contract: readContractVersion(entry.contractMajor, entry.contractMinor),
      ownedPrefixes: entry.ownedPrefixes ?? [],
      modSettings: entry.modSettings === true,
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
 * The derived channel definition for `system.uplinkHealth`, ready to register with
 * `store.registerDerivedChannel(systemUplinkHealthChannel)`. Useful for making
 * Uplink health readable by widgets. Registered by the telemetry context provider.
 * `fields: true` exposes `system.uplinkHealth.uplinks`. Its status is its single
 * `system.uplinks` input's.
 */
export const systemUplinkHealthChannel: DerivedChannelDefinition<SystemUplinkHealth> =
  {
    topic: "system.uplinkHealth",
    inputs: ["system.uplinks"],
    derive: deriveSystemUplinkHealth,
    fields: true,
  };
