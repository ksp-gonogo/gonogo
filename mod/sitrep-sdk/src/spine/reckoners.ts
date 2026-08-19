import type { ReckonerFor } from "./client-reading";

/**
 * Per-topic forward models, registered at module load the same way components
 * and themes are: a module that owns a model calls `registerReckoner` and the
 * store picks it up, with no wiring in between.
 *
 * A module-level registry rather than a `TimelineStore` method because the model
 * belongs to whoever owns the topic (a widget, an Uplink), and that module is
 * imported long before any store exists.
 *
 * ## Keyed by (topic, owner), and contested topics answer with nothing
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
 * answer is to serve NEITHER. A reading with no model presents as `stale`,
 * which is a true statement; a reading carrying whichever model happened to
 * load second is a confident picture assembled by accident, and `Reading`'s own
 * doc is explicit that a wrong reckoner is worse than none. Same resolution
 * `getResolvedComponents` uses for two widgets claiming one replacement target:
 * withhold both, surface the conflict, never silently merge.
 *
 * Re-registration under the SAME owner is last-write-wins and deliberately not
 * an error, matching `defineUplinkClient`: a module re-evaluating under HMR or
 * a test re-importing after `resetModules` is a benign single-owner case, and
 * there is no cross-package collision to guard against within one owner.
 */
const reckoners = new Map<string, Map<string, ReckonerFor<unknown>>>();

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
export function registerReckoner<T>(
  topic: string,
  owner: string,
  reckoner: ReckonerFor<T>,
): void {
  const byOwner =
    reckoners.get(topic) ?? new Map<string, ReckonerFor<unknown>>();
  byOwner.set(owner, reckoner as ReckonerFor<unknown>);
  reckoners.set(topic, byOwner);
}

/**
 * The model to actually use for `topic`: the sole registered one, or nothing.
 *
 * `undefined` for a contested topic as well as an unmodelled one, and the
 * caller cannot tell the two apart on purpose. Both mean "nothing trustworthy
 * can be said", which is exactly what the `stale` arm says. A host that wants
 * to prompt the operator reads {@link getReckonerConflicts}.
 */
export function getReckoner<T>(topic: string): ReckonerFor<T> | undefined {
  const byOwner = reckoners.get(topic);
  if (!byOwner || byOwner.size !== 1) return undefined;
  const [only] = byOwner.values();
  return only as ReckonerFor<T>;
}

/** A topic two or more owners have both registered a model for. */
export interface ReckonerConflict {
  topic: string;
  /** The competing owners, sorted, all of them withheld. */
  owners: string[];
}

/**
 * Every contested topic in the registry, for a host that wants to tell the
 * operator which Uplinks disagree. Mirrors `getReplacementConflicts`, and its
 * emptiness is the normal case.
 */
export function getReckonerConflicts(): ReckonerConflict[] {
  const conflicts: ReckonerConflict[] = [];
  for (const [topic, byOwner] of reckoners) {
    if (byOwner.size >= 2) {
      conflicts.push({ topic, owners: [...byOwner.keys()].sort() });
    }
  }
  return conflicts;
}

/** Test-only: reset the registry to empty. */
export function clearReckoners(): void {
  reckoners.clear();
}
