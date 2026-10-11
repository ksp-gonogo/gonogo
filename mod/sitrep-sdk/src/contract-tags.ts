// The value tags each contract declares, registered by the client that owns it.
//
// A tag is a fact about a published value that a reader acts on: how it relates
// in time (`kind`), whether it identifies its list entry (`entryKey`), and which
// models carry it forward (`reckonable`). Each contract's codegen writes them
// into one table, `GENERATED_CONTRACT_TAGS` in its generated `units.ts`, and the
// owning client registers that table here under its own id. Core's is
// registered when this module loads, so every reader asks the same registry
// whichever contract a value came from.

import type {
  GeneratedReckonableInput,
  GeneratedReckonableValue,
  GeneratedReckoningBasis,
} from "./__generated__/reckonability";
import { GENERATED_CONTRACT_TAGS } from "./__generated__/units";

/**
 * The owner core's own contract registers its tags under, and core's own
 * forward models register under.
 *
 * @category Reckoners
 */
export const CORE_CONTRACT_OWNER = "core";

/**
 * How a channel's samples relate in time: `continuous` moves between samples
 * and may be drawn as a line, `discrete` stands until the next sample and is
 * drawn as a step, `event` is one occurrence per sample and is drawn as points.
 *
 * @category Registering
 */
export type SampleKind = "continuous" | "discrete" | "event";

/**
 * The tags a contract declares on one value. A kind declared here overrides
 * the channel's own for the value and everything beneath it; `event` is never
 * one, since whether a sample is an occurrence is a fact about the whole sample.
 *
 * @category Registering
 */
export interface ValueTags {
  /** How this value and everything beneath it relate in time, where it differs from the channel's own kind. */
  readonly kind?: Exclude<SampleKind, "event">;
  /** Present when this value identifies its entry of a list across samples. */
  readonly entryKey?: true;
}

/**
 * One value a contract declares a model carries forward, as its codegen writes
 * it. `field` is the path from the payload root, `*` for each list or
 * dictionary it crosses.
 *
 * @category Reckoners
 */
export interface ContractReckonableRow {
  /** The Topic the value is published on. */
  readonly topic: string;
  /** The value's path from the payload root, `*` for each list or dictionary it crosses. */
  readonly field: string;
  /** The model that carries it forward, one of the reckoning bases. */
  readonly basis: string;
  /** The published inputs the model needs beyond the value itself. */
  readonly inputs: readonly GeneratedReckonableInput[];
}

/**
 * The table a contract's codegen writes into its generated units file: value
 * tags by Topic then path, and the values its models carry forward.
 *
 * @category Registering
 */
export interface ContractTagTable {
  /** The tags declared on each Topic's values, by Topic then path. */
  readonly topics?: Readonly<
    Record<string, Readonly<Record<string, ValueTags>>>
  >;
  /** Every value a declared model carries forward. */
  readonly reckonable?: readonly ContractReckonableRow[];
}

/**
 * A reckonable value and the owner whose contract declared it.
 *
 * @category Reckoners
 */
export interface OwnedReckonableValue extends GeneratedReckonableValue {
  /** The id of the Uplink, or `"core"`, whose contract declared the model. */
  readonly owner: string;
}

const KNOWN_BASES = {
  combination: true,
  "kepler-propagation": true,
  "linear-dead-reckoning": true,
  "powered-integration": true,
  "rate-integration": true,
} as const satisfies Record<GeneratedReckoningBasis, true>;

function isKnownBasis(basis: string): basis is GeneratedReckoningBasis {
  return basis in KNOWN_BASES;
}

/**
 * The value tags of each Topic and the one owner that declared them. Keyed by
 * Topic because a Topic's values are facts about a wire one owner produces:
 * only the contract that publishes it may say how its values behave.
 */
const topicTags = new Map<
  string,
  { readonly owner: string; readonly paths: ReadonlyMap<string, ValueTags> }
>();

/**
 * Reckonable rows by the owner that declared them. Unlike value tags these
 * may name another owner's Topic: a model belongs to whoever supplies it, so
 * an Uplink declares the core values it carries forward in its own contract.
 */
const reckonableByOwner = new Map<string, readonly OwnedReckonableValue[]>();

let generation = 0;

/**
 * Register the tags `owner`'s contract declares. An Uplink passes its
 * generated table to `defineUplinkClient` instead of calling this.
 *
 * Throws when another owner has already described one of the same Topics,
 * naming both, and when a row names a model outside the closed vocabulary.
 * Registering again under the same owner replaces what it registered before.
 *
 * @category Registering
 */
export function registerContractTags(
  owner: string,
  table: ContractTagTable,
): void {
  for (const topic of Object.keys(table.topics ?? {})) {
    const existing = topicTags.get(topic);
    if (existing && existing.owner !== owner) {
      throw new Error(
        `registerContractTags("${owner}"): the values of ${topic} are already described by "${existing.owner}". ` +
          "Only the contract that publishes a Topic says how its values behave. To declare a model on " +
          "another owner's value, use [assembly: SitrepReckonableOn] in your own contract.",
      );
    }
  }
  const rows: OwnedReckonableValue[] = [];
  for (const row of table.reckonable ?? []) {
    if (!isKnownBasis(row.basis)) {
      throw new Error(
        `registerContractTags("${owner}"): ${row.topic} ${row.field} names the model "${row.basis}", ` +
          `which is not one of ${Object.keys(KNOWN_BASES).join(", ")}.`,
      );
    }
    rows.push({ ...row, basis: row.basis, owner });
  }

  for (const [topic, entry] of topicTags) {
    if (entry.owner === owner) topicTags.delete(topic);
  }
  for (const [topic, paths] of Object.entries(table.topics ?? {})) {
    topicTags.set(topic, { owner, paths: new Map(Object.entries(paths)) });
  }
  reckonableByOwner.set(owner, rows);
  generation += 1;
}

/**
 * Every value a declared model carries forward on `topic`, from every owner,
 * or only `owner`'s when one is named. A value with two models appears twice.
 *
 * @category Reckoners
 */
export function reckonableRowsOf(
  topic: string,
  owner?: string,
): readonly OwnedReckonableValue[] {
  const rows: OwnedReckonableValue[] = [];
  for (const [rowOwner, owned] of reckonableByOwner) {
    if (owner !== undefined && rowOwner !== owner) continue;
    for (const row of owned) if (row.topic === topic) rows.push(row);
  }
  return rows;
}

/**
 * The value tags declared on `topic`, by path (`*` for a list or dictionary
 * level), with the owner that declared them, or `undefined` when no contract
 * declares any.
 *
 * @category Registering
 */
export function valueTagsOf(
  topic: string,
):
  | { readonly owner: string; readonly paths: ReadonlyMap<string, ValueTags> }
  | undefined {
  return topicTags.get(topic);
}

/**
 * A number that changes whenever a contract's tags are registered, so a cache
 * built from them knows when it is stale.
 */
export function contractTagsGeneration(): number {
  return generation;
}

/**
 * Adds rows to `owner`'s declared marks rather than replacing them, for a test
 * that models a Topic no contract publishes. Reached through
 * `@ksp-gonogo/sitrep-sdk/testing`.
 */
export function appendReckonableRows(
  owner: string,
  rows: readonly ContractReckonableRow[],
): void {
  const added: OwnedReckonableValue[] = rows.map((row) => {
    if (!isKnownBasis(row.basis)) {
      throw new Error(
        `appendReckonableRows("${owner}"): "${row.basis}" is not a model`,
      );
    }
    return { ...row, basis: row.basis, owner };
  });
  reckonableByOwner.set(owner, [
    ...(reckonableByOwner.get(owner) ?? []),
    ...added,
  ]);
  generation += 1;
}

/** Test-only: forget every owner's tags but core's. */
export function clearRegisteredContractTags(): void {
  for (const [topic, entry] of topicTags) {
    if (entry.owner !== CORE_CONTRACT_OWNER) topicTags.delete(topic);
  }
  for (const owner of reckonableByOwner.keys()) {
    if (owner !== CORE_CONTRACT_OWNER) reckonableByOwner.delete(owner);
  }
  generation += 1;
}

registerContractTags(CORE_CONTRACT_OWNER, GENERATED_CONTRACT_TAGS);
