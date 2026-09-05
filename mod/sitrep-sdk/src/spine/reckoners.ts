import type { AnyReckonerDefinition, ReckonerDefinition } from "../reading";
import type { Dep } from "./processors";

/**
 * Per-topic forward models, registered at module load the same way components
 * and themes are: a module that owns a model calls `registerReckoner` and the
 * store picks it up, with no wiring in between.
 *
 * A module-level registry rather than a `TimelineStore` method because the model
 * belongs to whoever owns the topic (a widget, an Uplink), and that module is
 * imported long before any store exists.
 *
 * ## Keyed by (topic, owner), and a contest falls back to core
 *
 * This was a bare `Map<topic, reckoner>` with last-registration-wins, which is
 * the design `units.ts` considered and rejected for the same shape of problem,
 * in its own words: "the maps are whole-Topic, so last-write-wins between two
 * installed providers would clobber core's own units for that Topic". Its
 * answer, a registry keyed by owner so two providers write two entries and
 * never collide, is the one here.
 *
 * Last-write-wins is also not election, whatever it is called: the winner is
 * decided by module import order, which is a fact about the bundler. A real
 * conflict is two Uplinks both claiming to model one topic, and the honest
 * answer is to serve NEITHER OF THEM: a reading carrying whichever model
 * happened to load second is a confident picture assembled by accident, and
 * `Reading`'s own doc is explicit that a wrong reckoner is worse than none. Same
 * resolution `getResolvedComponents` uses for two widgets claiming one
 * replacement target: withhold both, surface the conflict, never silently merge.
 *
 * What withholding both must NOT mean is serving nothing while core holds a
 * working vanilla for the same topic. See {@link getReckoner}: the contest
 * withdraws the contenders and core's own model answers.
 *
 * Re-registration under the SAME owner is last-write-wins and deliberately not
 * an error, matching `defineUplinkClient`: a module re-evaluating under HMR or
 * a test re-importing after `resetModules` is a benign single-owner case, and
 * there is no cross-package collision to guard against within one owner.
 */
const reckoners = new Map<string, Map<string, AnyReckonerDefinition>>();

/**
 * The owner core's own vanilla models register under. An Uplink cannot use it:
 * `defineUplinkClient` stamps the client's own id, and `CORE_UPLINK_CLIENT` is
 * the one handle carrying this one.
 */
export const CORE_RECKONER_OWNER = "core";

/**
 * Register `owner`'s forward model for `topic`.
 *
 * `owner` is a required argument rather than a convention because ownership has
 * to be readable by something other than a person: the boundary ratchet and any
 * health surface both want to know which Uplink is modelling what, and this was
 * the one registration seam in the repo taking neither an owner nor a topic
 * type. An Uplink client should call its handle's bound `registerReckoner`
 * instead of naming itself here.
 */
export function registerReckoner<
  T,
  R = T,
  const Deps extends readonly Dep[] = readonly Dep[],
>(
  topic: string,
  owner: string,
  reckoner: ReckonerDefinition<T, R, Deps>,
): void {
  const byOwner =
    reckoners.get(topic) ?? new Map<string, AnyReckonerDefinition>();
  byOwner.set(owner, reckoner);
  reckoners.set(topic, byOwner);
}

/** The elected model for a topic, and which owner it belongs to. */
export interface ElectedReckoner {
  readonly owner: string;
  readonly definition: AnyReckonerDefinition;
}

/**
 * The model to actually use for `topic`, and who owns it.
 *
 * ## The election, and why withholding everything stopped being right
 *
 * This used to answer `undefined` for a contested topic as well as an
 * unmodelled one, on the reasoning that two Uplinks claiming one topic should
 * be served by neither. That reasoning holds for the two Uplinks and stops
 * holding once CORE ships a vanilla: withholding then serves nothing while a
 * working model sits registered, which is a silent outage rather than a
 * withheld opinion, and on a value the CONTRACT declares reckonable the type
 * has already promised a model is on offer.
 *
 * So the ladder is: the sole non-core owner (an Uplink that owns the physics
 * beats the vanilla), else core's own registration (which is what a contest
 * falls back to, and what an uncontested core-only topic uses), else nothing.
 * A contest that core cannot cover still answers with nothing, and
 * `TimelineStore` turns that into `declined: { reason: "contested" }` rather
 * than a silence.
 *
 * {@link getReckonerConflicts} is unchanged and still names every contested
 * topic, because "these two Uplinks disagree" is worth telling an operator
 * whether or not core covered for them.
 */
export function getReckoner(topic: string): ElectedReckoner | undefined {
  const byOwner = reckoners.get(topic);
  if (!byOwner || byOwner.size === 0) return undefined;
  const contenders = [...byOwner.entries()].filter(
    ([owner]) => owner !== CORE_RECKONER_OWNER,
  );
  if (contenders.length === 1) {
    const [owner, definition] = contenders[0];
    return { owner, definition };
  }
  const core = byOwner.get(CORE_RECKONER_OWNER);
  return core ? { owner: CORE_RECKONER_OWNER, definition: core } : undefined;
}

/** A topic two or more NON-CORE owners have both registered a model for. */
export interface ReckonerConflict {
  topic: string;
  /**
   * The competing owners, sorted, core included where it also registered. Every
   * CONTENDER is withheld; core is not a contender and covers where it has a
   * model. See {@link getReckoner}.
   */
  owners: string[];
}

/**
 * Every contested topic in the registry, for a host that wants to tell the
 * operator which Uplinks disagree. Mirrors `getReplacementConflicts`, and its
 * emptiness is the normal case.
 *
 * Core is not counted as a party to the contest. Core ships a vanilla for every
 * marked Topic, so counting it would make one Uplink electing itself over the
 * vanilla read as a disagreement, which is the normal and intended case and the
 * one {@link getReckoner} serves without hesitating. A contest is two owners who
 * both think they own the physics.
 */
export function getReckonerConflicts(): ReckonerConflict[] {
  const conflicts: ReckonerConflict[] = [];
  for (const [topic, byOwner] of reckoners) {
    const contenders = [...byOwner.keys()].filter(
      (owner) => owner !== CORE_RECKONER_OWNER,
    );
    if (contenders.length >= 2) {
      conflicts.push({ topic, owners: [...byOwner.keys()].sort() });
    }
  }
  return conflicts;
}

/**
 * Every topic anyone has registered a model for, with its owners.
 *
 * `getReckoner` answers with the model and `getReckonerConflicts` with the
 * contested subset, and neither can tell you that one owner models six topics,
 * which is what a docs surface enumerating an Uplink's contributions needs.
 * Sorted by topic so a generated page's ordering does not depend on module
 * import order.
 */
export function getReckonedTopics(): { topic: string; owners: string[] }[] {
  return [...reckoners.entries()]
    .map(([topic, byOwner]) => ({ topic, owners: [...byOwner.keys()].sort() }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Test-only: reset the registry to empty. */
export function clearReckoners(): void {
  reckoners.clear();
}
