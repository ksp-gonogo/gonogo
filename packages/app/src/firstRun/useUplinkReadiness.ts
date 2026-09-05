/*
 * The reading a new operator needs on first boot: for every Uplink the running
 * mod says is installed, did a client for it actually load.
 *
 * It is a join of two things the app already has and never puts side by side.
 * `system.uplinkHealth` is the mod's own roster of what is installed; the
 * loader's outcome store is what the browser managed to do about it. Neither
 * alone answers the question, because an id present in one and absent from the
 * other is exactly the case worth surfacing.
 *
 * There is no fetch here. An earlier version of this hook read a central index
 * over the network to offer a download; that index is gone and so is the
 * download, so both inputs are already-live subscriptions and nothing can fail
 * to arrive except the roster itself.
 */

import type {
  ContractVersionReading,
  SystemUplinkHealth,
} from "@ksp-gonogo/sitrep-client";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { useSyncExternalStore } from "react";
import {
  getUplinkOutcomes,
  subscribeUplinkOutcomes,
  type UplinkLoadOutcome,
} from "../uplinks/loaderState";

/**
 * One Uplink's resolved client state.
 *
 * `no-client` and `quarantined` are deliberately separate. A quarantine is a
 * client that was found and refused, and it carries the refusal reason;
 * `no-client` is nothing having been attempted at all, which the app cannot
 * explain further from here and does not pretend to.
 */
export type UplinkReadinessState =
  | "loaded"
  | "loading"
  | "quarantined"
  | "contract-mismatch"
  | "no-client"
  | "unavailable";

export interface UplinkReadinessEntry {
  /** The mod-reported id, and the join key. */
  id: string;
  /** The loader's resolved name where it recorded one, else the id. */
  name: string;
  /** The version one of the two sides reported, or null when neither did. */
  version: string | null;
  /** Present in the mod's roster. False for a client loaded from an earlier session. */
  installed: boolean;
  /** The mod's own `available` flag, meaningful only when `installed`. */
  modAvailable: boolean;
  /** The mod's own reason, carried verbatim and never reworded. */
  modReason: string | null;
  /** The contract version this Uplink was built against, as the mod reports it. */
  declaredContract: ContractVersionReading | null;
  /** The contract version the running mod speaks, repeated per row so a row renders alone. */
  coreContract: ContractVersionReading | null;
  /** The recorded load outcome, or null when nothing was attempted for this id. */
  outcome: UplinkLoadOutcome | null;
  state: UplinkReadinessState;
}

/**
 * A contract-major refusal, recognised by applying the mod's OWN rule to the
 * mod's OWN two numbers rather than by re-adjudicating anything: the host
 * refused it (`available: false`) and the majors differ. Both versions have to
 * have arrived, so an older mod that reports neither reads as a plain
 * unavailability, which is what it was before the numbers existed.
 */
function isContractRefusal(
  modAvailable: boolean,
  declared: ContractVersionReading | null,
  core: ContractVersionReading | null,
): boolean {
  return (
    !modAvailable &&
    declared !== null &&
    core !== null &&
    declared.major !== core.major
  );
}

/**
 * A contract refusal outranks every load outcome, `loaded` included. The mod
 * never ran that Uplink's `Register`, so nothing it declares is being served
 * whatever the browser managed to do with its client, and a row reading "client
 * loaded" over a dead mod half is the same silence in a friendlier font.
 */
function stateOf(
  outcome: UplinkLoadOutcome | null,
  installed: boolean,
  modAvailable: boolean,
  contractRefused: boolean,
): UplinkReadinessState {
  if (installed && contractRefused) return "contract-mismatch";
  if (outcome?.status === "loaded") return "loaded";
  if (outcome?.status === "loading") return "loading";
  if (outcome?.status === "quarantined") return "quarantined";
  if (installed && !modAvailable) return "unavailable";
  return "no-client";
}

/**
 * The pure join. One row per id in either input, roster order first so the rows
 * read in the order the mod lists them, then any id that loaded but is no
 * longer in the roster: an operator's running widget must not vanish from this
 * list because the mod stopped reporting it mid-session.
 *
 * `roster` is tri-state. `undefined` means the mod has not answered yet and
 * `null` means it answered with a tombstone; both contribute no roster rows,
 * and only the hook's `loading` flag tells them apart.
 */
export function computeUplinkReadiness(
  roster: SystemUplinkHealth | null | undefined,
  outcomes: readonly UplinkLoadOutcome[],
): UplinkReadinessEntry[] {
  const rosterById = new Map(
    (roster?.uplinks ?? []).map((entry) => [entry.id, entry]),
  );
  const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const ids = new Set<string>([...rosterById.keys(), ...outcomeById.keys()]);

  const coreContract = roster?.coreContract ?? null;

  return [...ids].map((id) => {
    const rosterEntry = rosterById.get(id);
    const outcome = outcomeById.get(id) ?? null;
    const installed = rosterEntry !== undefined;
    const modAvailable = rosterEntry?.available ?? false;
    const declaredContract = rosterEntry?.contract ?? null;
    return {
      id,
      name: outcome?.name ?? id,
      version: rosterEntry?.version ?? outcome?.version ?? null,
      installed,
      modAvailable,
      modReason: rosterEntry?.reason ?? null,
      declaredContract,
      coreContract,
      outcome,
      state: stateOf(
        outcome,
        installed,
        modAvailable,
        isContractRefusal(modAvailable, declaredContract, coreContract),
      ),
    };
  });
}

export interface UseUplinkReadinessResult {
  entries: UplinkReadinessEntry[];
  /** True only while the mod has said nothing at all yet. */
  waitingForMod: boolean;
}

/**
 * Live wrapper over {@link computeUplinkReadiness}: the `system.uplinkHealth`
 * stream and the loader's outcome store, re-derived whenever either moves.
 */
export function useUplinkReadiness(): UseUplinkReadinessResult {
  const roster = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
  );

  return {
    entries: computeUplinkReadiness(roster, outcomes),
    waitingForMod: roster === undefined,
  };
}
